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
import { consumeItem, getBallItem, getItem, grantItem } from "./items.js";
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

// Réponse à un clic de lancer qui n'ira pas jusqu'au tirage : cooldown, ball
// inconnue, refus de la Master Ball. Les deux origines demandent l'inverse l'une
// de l'autre, et ceci en est la SEULE définition — la confirmation Master Ball,
// dans interactions.js, répond exactement de la même façon et s'en sert aussi.
//
// Depuis le PANNEAU : on réécrit son texte sans transmettre `components`. La clé
// absente est exclue du corps JSON, donc Discord laisse les boutons tels quels —
// indispensable, car ces réponses sont concurrentes de celle du lancer précédent
// et rien n'ordonne les deux interactions : sinon un « attends 5s » arrivant
// après un « Bravo » ressusciterait les boutons d'un Pokémon déjà capturé.
//
// Depuis l'ANNONCE : message neuf, aucun état à préserver. Il porte la rangée de
// balls — sans quoi le joueur fait face à un cul-de-sac — et devient son
// panneau, ce qui fait disparaître le précédent.
export function answerThrow(interaction, spawnId, content, { panel = false } = {}) {
  return (panel
    ? interaction.update({ content })
    : interaction.reply({
        content,
        components: [buildBallRow(spawnId, { panel: true })],
        flags: MessageFlags.Ephemeral,
      })
  )
    // Uniquement en cas de succès : si la réponse échoue, supprimer le panneau
    // précédent laisserait le dresseur sans rien du tout.
    .then(() => trackPanel(interaction, spawnId, { replacing: !panel }))
    .catch(() => {});
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

// Ce qu'a coûté un lancer, et de quoi le rendre. Une ball offerte passe AVANT
// les points : c'est ce que le dresseur veut, un objet posé dans son sac ne doit
// pas dormir pendant qu'on lui prend sa monnaie. Elle est consommée par le même
// UPDATE gardé que tout le reste, donc deux clics simultanés n'en dépensent
// jamais qu'une.
//
// Rend { item } pour une ball offerte, { points } pour un achat, ou null si le
// solde ne suffit pas.
function payThrow(userId, ball, cb) {
  const item = getBallItem(ball.key);
  const tryPoints = () =>
    spendPoints(userId, ball.price, (err, debited) =>
      cb(err, debited ? { points: ball.price } : null)
    );

  if (!item) return tryPoints();
  consumeItem(userId, item.key, 1, { source: "lancer" }, (err, consumed) => {
    // Une erreur de base n'autorise pas à faire payer : on la remonte plutôt que
    // de basculer en silence sur le solde du dresseur.
    if (err) return cb(err, null);
    if (consumed) return cb(null, { item: item.key, label: item.label });
    tryPoints();
  });
}

// Chemin de remboursement unique et journalisé. On ne rembourse qu'après un
// paiement réussi, donc il y a toujours quelque chose à rendre — et on rend ce
// qui a été pris : une ball offerte se rend en ball, jamais en points. La
// convertir en monnaie ferait d'un Pokémon disputé une petite imprimerie.
function refundThrow(interaction, spawnId, ball, probability, view, payment) {
  const userId = interaction.user.id;
  const gratuit = Boolean(payment?.item);
  const rendu = gratuit
    ? `Ta **${payment.label}** t'a été rendue.`
    : `Tes **${ball.price}** points ont été remboursés.`;

  const done = (err) => {
    if (err) handleException("Remboursement impossible :", err);
    logThrow(spawnId, userId, ball.key, gratuit ? 0 : ball.price, probability, "VOID");
    log(
      `Remboursement à ${userId} (spawn #${spawnId} déjà résolu) : ` +
        (gratuit ? payment.label : `${ball.price} pts`)
    );
    interaction
      .editReply(view(`💨 Trop tard, quelqu'un a été plus rapide ! ${rendu}`, { done: true }))
      .catch(() => {});
  };

  if (gratuit) return grantItem(userId, payment.item, 1, { source: "lancer-annule" }, done);
  addPoints(userId, ball.price, done);
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

  if (!ball) return answerThrow(interaction, spawnId, "❌ Ball inconnue.", { panel });

  const remaining = tryConsumeCooldown(userId, config.capture.throwCooldownSeconds * 1000);
  if (remaining > 0) {
    return answerThrow(
      interaction,
      spawnId,
      `⏳ Doucement ! Attends encore **${remaining}s** avant de relancer.`,
      { panel }
    );
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

    // 1. Paiement atomique : une ball offerte d'abord, le solde ensuite, et
    // refusé sans rien prélever si ni l'un ni l'autre ne suffit.
    payThrow(userId, ball, (err, payment) => {
      if (err) {
        handleException("Paiement du lancer :", err);
        return interaction.editReply(view("❌ Erreur base de données.")).catch(() => {});
      }

      if (!payment) {
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

      // Ce que le lancer a réellement coûté : zéro quand la ball était offerte,
      // ce qui garde honnête le classement des points brûlés.
      const cost = payment.points ?? 0;
      const gratuit = Boolean(payment.item);
      const mention = gratuit
        ? `${payment.label} offerte`
        : `**-${ball.price}** points`;

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
              return refundThrow(interaction, spawnId, ball, probability, view, payment);
            }
            if (this.changes === 0) {
              return refundThrow(interaction, spawnId, ball, probability, view, payment);
            }

            logThrow(spawnId, userId, ball.key, cost, probability, "MISS");
            recordThrow({
              userId,
              speciesId: spawn.species_id,
              ball: ball.key,
              cost,
              probability,
              result: "MISS",
            });
            refreshSpawnEmbed(interaction.client, spawnId);
            interaction
              .editReply(
                view(
                  `❌ Raté ! **${displayName(species, spawn.is_shiny)}** s'est dégagé de ta ${ball.label}. (${mention}, ${(probability * 100).toFixed(1)} % de réussite)`
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
            return refundThrow(interaction, spawnId, ball, probability, view, payment);
          }
          if (this.changes === 0) {
            // Battu à la milliseconde près.
            return refundThrow(interaction, spawnId, ball, probability, view, payment);
          }

          logThrow(spawnId, userId, ball.key, cost, probability, "CATCH");
          recordThrow({
            userId,
            speciesId: spawn.species_id,
            ball: ball.key,
            cost,
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

            // L'objet tenu suit le Pokémon dans le sac de celui qui l'attrape.
            // Le crédit est au mieux : une capture réussie ne se défait pas
            // parce qu'un objet n'a pas pu être rangé, et l'échec est bruyant
            // dans les logs plutôt que silencieux pour le dresseur.
            const held = getItem(spawn.held_item);
            const annonce = (butin) =>
              interaction
                .editReply(
                  view(
                    `🎉 Bravo ! **${displayName(species, spawn.is_shiny)}** rejoint ton Pokédex ! (${mention})` +
                      butin,
                    { done: true }
                  )
                )
                .catch(() => {});

            if (!held) return annonce("");
            grantItem(userId, held.key, 1, { source: `capture:${spawnId}` }, (err) => {
              if (err) {
                handleException("Remise de l'objet tenu :", err);
                return annonce("");
              }
              log(`Butin : ${userId} récupère ${held.label} (spawn #${spawnId})`);
              annonce(`\n${held.emoji} Il tenait **${held.label}** !`);
            });
          });
        }
      );
    });
  });
}
