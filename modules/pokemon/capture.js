// Lancer de ball : la partie la plus délicate du système.
//
// Course à un seul vainqueur avec débit direct des points. Deux invariants à
// tenir absolument :
//   1. aucun solde ne passe sous zéro, même sur des clics simultanés ;
//   2. deux personnes ne capturent jamais le même Pokémon.
//
// Les deux reposent sur des UPDATE gardés dont on inspecte this.changes, et non
// sur un enchaînement de SELECT puis UPDATE, qui laisserait une fenêtre entre
// les deux. À noter : db.serialize(async () => {...}) ne protège rien après le
// premier await — d'où le chaînage explicite en callbacks ci-dessous.
import { MessageFlags } from "discord.js";
import db from "../points-db.js";
import { addPoints, getBalance, spendPoints } from "../economy.js";
import { handleException, log } from "../utils.js";
import { getBall, getPokemonConfig } from "./config.js";
import { creditSpecies } from "./collection.js";
import { catchProbability, getSpecies } from "./data.js";
import { buildBallRow, displayName } from "./embeds.js";
import { finalizeCaughtSpawn, refreshSpawnEmbed } from "./spawn.js";
import { recordSpawnEnd, recordThrow } from "./stats.js";

// Anti-spam. Entièrement synchrone, donc atomique dans la boucle d'événements :
// l'écriture a lieu avant le moindre await, aucun entrelacement possible.
// En mémoire, donc remis à zéro au redémarrage — sans incidence sur la
// correction, le débit et la réclamation restant gardés.
const lastThrowAt = new Map();

// Le panneau de lancer ouvert par chaque dresseur. Un joueur n'en a qu'un à la
// fois, donc une entrée par dresseur suffit — et cette clé borne la table à
// l'effectif du serveur, comme lastThrowAt juste au-dessus. Perdue au
// redémarrage : au pire un panneau de trop survit une fois, ce qui est le
// comportement d'avant.
const openPanels = new Map();

// Discord n'autorise à toucher un éphémère que par le token de l'interaction qui
// l'a créé, d'où la conservation du webhook (id d'application + token) plutôt que
// de l'interaction entière.
//
// `replacing` distingue les deux origines d'un clic : depuis l'annonce publique,
// il vient d'ouvrir un NOUVEL éphémère et l'ancien doit disparaître ; depuis le
// panneau, c'est le même message qu'on réécrit, on se contente de rafraîchir le
// token — ce qui fait glisser sa fenêtre de 15 minutes tant que le joueur joue.
export function trackPanel(interaction, spawnId, { replacing = false } = {}) {
  const userId = interaction.user.id;
  const previous = openPanels.get(userId);
  const key = String(spawnId);

  // Clic sur un VIEUX panneau alors que le joueur en a un plus récent ailleurs :
  // celui-ci n'est plus sa référence. On n'y touche pas, et surtout on ne
  // supprime pas le plus récent — il se contentera d'annoncer que le Pokémon
  // n'est plus là et de retirer ses boutons.
  if (!replacing && previous && previous.spawnId !== key) return;

  openPanels.set(userId, { webhook: interaction.webhook, spawnId: key });
  if (!replacing || !previous) return;

  // Best-effort : token expiré ou éphémère déjà fermé par le joueur, on retombe
  // simplement sur deux messages — le comportement d'avant, jamais pire.
  previous.webhook?.deleteMessage("@original").catch(() => {});
}

function tryConsumeCooldown(userId, cooldownMs) {
  if (cooldownMs <= 0) return 0;
  const now = Date.now();
  const previous = lastThrowAt.get(userId) || 0;
  if (now - previous < cooldownMs) {
    return Math.ceil((cooldownMs - (now - previous)) / 1000);
  }
  lastThrowAt.set(userId, now);
  return 0;
}

function logThrow(spawnId, userId, ballKey, cost, probability, result) {
  db.run(
    `INSERT INTO pokemon_throws (spawn_id, user_id, ball, cost, probability, result, thrown_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [spawnId, userId, ballKey, cost, probability, result, Date.now()],
    (err) => {
      if (err) handleException("Enregistrement du lancer :", err);
    }
  );
}

// Chemin de remboursement unique et journalisé. Le crédit est inconditionnel et
// sûr : on ne rembourse qu'après un débit réussi, donc la ligne existe.
function refundThrow(interaction, spawnId, ball, probability, view) {
  const userId = interaction.user.id;
  addPoints(userId, ball.price, (err) => {
    if (err) handleException("Remboursement impossible :", err);
    logThrow(spawnId, userId, ball.key, ball.price, probability, "VOID");
    log(`Remboursement de ${ball.price} pts à ${userId} (spawn #${spawnId} déjà résolu)`);
    interaction
      .editReply(
        view(
          `💨 Trop tard, quelqu'un a été plus rapide ! Tes **${ball.price}** points ont été remboursés.`,
          { done: true }
        )
      )
      .catch(() => {});
  });
}

// `panel` distingue les deux origines d'un clic : l'annonce publique, où l'on
// ouvre un éphémère, et le panneau de relance, où l'on réécrit celui d'où vient
// le clic. Sans ça, dix lancers laissaient dix messages empilés.
export async function throwBall(interaction, spawnId, ballKey, { panel = false } = {}) {
  const config = getPokemonConfig();
  const ball = getBall(ballKey);
  const userId = interaction.user.id;

  // Un lancer a dix issues ; ce point de sortie unique décide une fois pour
  // toutes de la forme de la réponse, aucune branche n'a à s'en soucier.
  // `done` retire les boutons quand il n'y a plus rien à relancer.
  const view = (content, { done = false } = {}) => ({
    content,
    components: done ? [] : [buildBallRow(spawnId, { panel: true })],
  });

  // Sorties qui précèdent le defer (cooldown, ball inconnue). Les deux origines
  // demandent un traitement opposé.
  //
  // Depuis le PANNEAU : on réécrit son texte sans transmettre `components`. La
  // clé absente est exclue du corps JSON, donc Discord laisse les boutons tels
  // quels — indispensable, car ces sorties sont concurrentes de la réponse au
  // lancer précédent et rien n'ordonne les deux interactions : sinon un
  // « attends 5s » arrivant après un « Bravo » ressusciterait les boutons d'un
  // Pokémon déjà capturé.
  //
  // Depuis l'ANNONCE : c'est un message neuf, il n'y a donc aucun état à
  // préserver. Il porte la rangée de balls — sans quoi le joueur se retrouve
  // devant un cul-de-sac sans rien à cliquer — et devient son panneau, ce qui
  // fait disparaître le précédent.
  const answerInPlace = (content) =>
    (panel
      ? interaction.update({ content })
      : interaction.reply({ ...view(content), flags: MessageFlags.Ephemeral })
    )
      // Uniquement en cas de succès : si la réponse échoue, supprimer le panneau
      // précédent laisserait le dresseur sans rien du tout.
      .then(() => trackPanel(interaction, spawnId, { replacing: !panel }))
      .catch(() => {});

  if (!ball) return answerInPlace("❌ Ball inconnue.");

  const remaining = tryConsumeCooldown(userId, config.capture.throwCooldownSeconds * 1000);
  if (remaining > 0) {
    return answerInPlace(`⏳ Doucement ! Attends encore **${remaining}s** avant de relancer.`);
  }

  if (panel) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Le nouveau panneau existe déjà (le defer l'a rendu visible) : on peut retirer
  // le précédent sans jamais laisser le joueur sans rien sous les yeux.
  trackPanel(interaction, spawnId, { replacing: !panel });

  db.get("SELECT * FROM pokemon_spawns WHERE id = ?", [spawnId], (err, spawn) => {
    if (err) {
      handleException("Lecture du spawn :", err);
      return interaction.editReply(view("❌ Erreur base de données.")).catch(() => {});
    }
    // Sortie anticipée AVANT tout débit : un Pokémon déjà parti ne coûte rien.
    if (!spawn || spawn.status !== "ACTIVE") {
      return interaction
        .editReply(view("💨 Ce Pokémon n'est plus là !", { done: true }))
        .catch(() => {});
    }

    const species = getSpecies(spawn.species_id);
    if (!species) {
      return interaction.editReply(view("❌ Espèce inconnue.", { done: true })).catch(() => {});
    }

    const probability = ball.guaranteed
      ? 1
      : catchProbability(
          spawn.catch_rate,
          ball.multiplier,
          config.capture.globalMultiplier
        );

    // 1. Débit atomique : refusé sans rien prélever si le solde ne suffit pas.
    spendPoints(userId, ball.price, (err, debited) => {
      if (err) {
        handleException("Débit du lancer :", err);
        return interaction.editReply(view("❌ Erreur base de données.")).catch(() => {});
      }

      if (!debited) {
        return getBalance(userId, (err, balance) => {
          interaction
            .editReply(
              view(
                `❌ Solde insuffisant : une **${ball.label}** coûte **${ball.price}** points, tu en as **${balance}**.`
              )
            )
            .catch(() => {});
        });
      }

      // 2. Tirage.
      const success = ball.guaranteed || Math.random() < probability;

      if (!success) {
        // 3a. Un seul UPDATE sert à la fois de compteur et de garde « encore
        // actif » : si le Pokémon a été capturé entre le débit et le tirage,
        // on rend les points au lieu de les brûler pour rien.
        return db.run(
          "UPDATE pokemon_spawns SET throw_count = throw_count + 1 WHERE id = ? AND status = 'ACTIVE'",
          [spawnId],
          function (err) {
            if (err) {
              handleException("Comptabilisation du raté :", err);
              return refundThrow(interaction, spawnId, ball, probability, view);
            }
            if (this.changes === 0) {
              return refundThrow(interaction, spawnId, ball, probability, view);
            }

            logThrow(spawnId, userId, ball.key, ball.price, probability, "MISS");
            recordThrow({
              userId,
              speciesId: spawn.species_id,
              ball: ball.key,
              cost: ball.price,
              probability,
              result: "MISS",
            });
            refreshSpawnEmbed(interaction.client, spawnId);
            interaction
              .editReply(
                view(
                  `❌ Raté ! **${displayName(species, spawn.is_shiny)}** s'est dégagé de ta ${ball.label}. (**-${ball.price}** points, ${(probability * 100).toFixed(1)} % de réussite)`
                )
              )
              .catch(() => {});
          }
        );
      }

      // 3b. Réclamation atomique : exactement un appelant obtient changes === 1.
      const now = Date.now();
      db.run(
        `UPDATE pokemon_spawns
            SET status = 'CAUGHT', caught_by = ?, caught_at = ?, caught_ball = ?,
                ended_at = ?, throw_count = throw_count + 1
          WHERE id = ? AND status = 'ACTIVE'`,
        [userId, now, ball.key, now, spawnId],
        function (err) {
          if (err) {
            handleException("Réclamation du spawn :", err);
            return refundThrow(interaction, spawnId, ball, probability, view);
          }
          if (this.changes === 0) {
            // Battu à la milliseconde près.
            return refundThrow(interaction, spawnId, ball, probability, view);
          }

          logThrow(spawnId, userId, ball.key, ball.price, probability, "CATCH");
          recordThrow({
            userId,
            speciesId: spawn.species_id,
            ball: ball.key,
            cost: ball.price,
            probability,
            result: "CATCH",
          });
          recordSpawnEnd(spawn, species, {
            caughtBy: userId,
            ball: ball.label,
            probability,
          });
          creditSpecies(userId, spawn.species_id, spawn.is_shiny, (err) => {
            if (err) handleException("Crédit de la collection :", err);
            finalizeCaughtSpawn(interaction.client, spawnId, userId, ball.key);
            log(
              `Capture : ${userId} attrape ${species.name}${spawn.is_shiny ? " ✨" : ""} (spawn #${spawnId}, ${ball.key})`
            );
            interaction
              .editReply(
                view(
                  `🎉 Bravo ! **${displayName(species, spawn.is_shiny)}** rejoint ton Pokédex ! (**-${ball.price}** points)`,
                  { done: true }
                )
              )
              .catch(() => {});
          });
        }
      );
    });
  });
}
