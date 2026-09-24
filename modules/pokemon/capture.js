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
import { pseudo } from "../pseudo.js";
import { getBall, getPokemonConfig } from "./config.js";
import { creditSpecies } from "./collection.js";
import { consumeItem, getBallItem, getItem, grantItem } from "./items.js";
import { dropItem, leavesItemBehind } from "./drops.js";
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
// Rend { item } pour une ball offerte, { points } pour un achat, ou null si rien
// n'a pu payer.
//
// `requireItem` interdit la bascule vers les points. Il sert au seul chemin qui
// en a besoin : la confirmation Master Ball, qui annonce « ta Master Ball
// offerte » sans montrer le moindre prix ni regarder le solde. Si l'objet a
// disparu entre l'ouverture de la confirmation et le clic — un second panneau
// ouvert ailleurs suffit — payer 22 500 points en silence serait exactement le
// mésclic irrattrapable que cette confirmation existe pour empêcher.
function payThrow(userId, ball, { requireItem = false } = {}, cb) {
  const item = getBallItem(ball.key);
  const tryPoints = () =>
    requireItem
      ? cb(null, null)
      : spendPoints(userId, ball.price, (err, debited) =>
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
function refundThrow(userId, spawnId, ball, probability, payment, cb) {
  const gratuit = Boolean(payment?.item);

  const done = (err) => {
    if (err) handleException("Remboursement impossible :", err);
    logThrow(spawnId, userId, ball.key, gratuit ? 0 : ball.price, probability, "VOID");
    pseudo(userId).then((name) =>
      log(
        `Remboursement à ${name} (spawn #${spawnId} déjà résolu) : ` +
          (gratuit ? payment.label : `${ball.price} pts`)
      )
    );
    cb(null, { status: "void", ball, payment });
  };

  if (gratuit) return grantItem(userId, payment.item, 1, { source: "lancer-annule" }, done);
  addPoints(userId, ball.price, done);
}

// ====================== LE LANCER ======================
//
// Discord et le site lancent par le même chemin : startThrow puis resolveThrow,
// et throwMessage pour dire ce qui s'est passé. Rien ici ne connaît une
// interaction ni une requête HTTP — seulement un dresseur, un spawn et une ball.
// Le client Discord ne sert qu'à mettre à jour l'annonce publique, que le
// lancer vienne du salon ou du site.

// Premier temps, synchrone : la ball existe-t-elle, et le dresseur a-t-il fini
// d'attendre ? Rend null quand le lancer peut partir — le cooldown est alors
// consommé —, ou le refus. À part parce que Discord doit répondre à ces refus
// AVANT de différer sa réponse. Le cooldown est le même pour les deux portes :
// alterner Discord et le site ne fait pas lancer plus vite.
export function startThrow(userId, ballKey) {
  if (!getBall(ballKey)) return { status: "unknown-ball" };
  const cooldownMs = getPokemonConfig().capture.throwCooldownSeconds * 1000;
  const remaining = tryConsumeCooldown(userId, cooldownMs);
  return remaining > 0 ? { status: "cooldown", remaining } : null;
}

// Second temps : paiement, tirage, réclamation, crédit. Rend toujours une
// issue — { status, … } — et jamais d'erreur : une panne de base est
// journalisée ici et devient l'issue « error », qu'il reste à afficher.
export function resolveThrow(client, userId, spawnId, ballKey, { requireItem = false } = {}, cb) {
  const config = getPokemonConfig();
  const ball = getBall(ballKey);
  if (!ball) return cb(null, { status: "unknown-ball" });

  db.get("SELECT * FROM pokemon_spawns WHERE id = ?", [spawnId], (err, spawn) => {
    if (err) {
      handleException("Lecture du spawn :", err);
      return cb(null, { status: "error" });
    }
    // Sortie anticipée AVANT tout débit : un Pokémon déjà parti ne coûte rien.
    if (!spawn || spawn.status !== "ACTIVE") return cb(null, { status: "gone" });

    const species = getSpecies(spawn.species_id);
    if (!species) return cb(null, { status: "unknown-species" });

    const probability = ball.guaranteed
      ? 1
      : catchProbability(spawn.catch_rate, ball.multiplier, config.capture.globalMultiplier);

    // 1. Paiement atomique : une ball offerte d'abord, le solde ensuite, et
    // refusé sans rien prélever si ni l'un ni l'autre ne suffit.
    payThrow(userId, ball, { requireItem }, (err, payment) => {
      if (err) {
        handleException("Paiement du lancer :", err);
        return cb(null, { status: "error" });
      }

      if (!payment) {
        // Promis gratuit, et l'objet n'y est plus : on le dit, on ne débite pas.
        if (requireItem) return cb(null, { status: "no-item", ball });
        return getBalance(userId, (err, balance) =>
          cb(null, { status: "insufficient", ball, balance })
        );
      }

      // Ce que le lancer a réellement coûté : zéro quand la ball était offerte,
      // ce qui garde honnête le classement des points brûlés.
      const cost = payment.points ?? 0;
      const refund = () => refundThrow(userId, spawnId, ball, probability, payment, cb);

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
              return refund();
            }
            if (this.changes === 0) return refund();

            logThrow(spawnId, userId, ball.key, cost, probability, "MISS");
            recordThrow({
              userId,
              speciesId: spawn.species_id,
              ball: ball.key,
              cost,
              probability,
              result: "MISS",
            });
            refreshSpawnEmbed(client, spawnId);
            cb(null, { status: "miss", ball, payment, species, spawn, probability });
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
            return refund();
          }
          // Battu à la milliseconde près.
          if (this.changes === 0) return refund();

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
          // La ball qui l'a emportée reste attachée à l'individu, pour de bon,
          // et il a le sexe que l'annonce montrait.
          const options = { ball: ball.key, origin: "capture", sex: spawn.sex };
          // S'il lâche son objet, c'est tiré AVANT d'annoncer la capture : le
          // message public doit dire « il lâche » et non « il tenait » quand un
          // bouton « Ramasser » apparaît juste en dessous.
          const held = getItem(spawn.held_item);
          const dropped = Boolean(held) && leavesItemBehind();
          creditSpecies(userId, spawn.species_id, spawn.is_shiny, options, (err, caught) => {
            if (err) handleException("Crédit de la collection :", err);
            finalizeCaughtSpawn(client, spawnId, userId, ball.key, { dropped });
            pseudo(userId).then((name) =>
              log(
                `Capture : ${name} attrape ${species.name}${spawn.is_shiny ? " ✨" : ""} ` +
                  `(spawn #${spawnId}, ${ball.key})`
              )
            );

            // L'objet tenu suit le Pokémon dans le sac de celui qui l'attrape.
            // Le crédit est au mieux : une capture réussie ne se défait pas
            // parce qu'un objet n'a pas pu être rangé, et l'échec est bruyant
            // dans les logs plutôt que silencieux pour le dresseur.
            const caughtOutcome = (heldOutcome) =>
              cb(null, {
                status: "catch",
                ball,
                payment,
                species,
                spawn,
                probability,
                caught,
                held: heldOutcome,
              });

            if (!held) return caughtOutcome(null);

            // Il le lâche parfois au lieu de le céder : l'objet tombe alors au
            // sol, et c'est une seconde course — ouverte à tous les autres, pas
            // à celui qui vient de gagner la première (claimDrop).
            if (dropped) {
              // Posé au sol, il n'est plus pour le capteur : si le dépôt échoue,
              // l'objet lui revient plutôt que de se perdre pour tout le monde.
              dropItem(client, { spawn, itemKey: held.key }, (err, dropId) => {
                if (dropId) return;
                grantItem(userId, held.key, 1, { source: `capture:${spawnId}` }, (err) => {
                  if (err) handleException("Remise d'un objet qui n'a pas pu tomber :", err);
                });
              });
              return caughtOutcome({ item: held, dropped: true });
            }

            grantItem(userId, held.key, 1, { source: `capture:${spawnId}` }, (err) => {
              if (err) {
                handleException("Remise de l'objet tenu :", err);
                return caughtOutcome(null);
              }
              pseudo(userId).then((name) =>
                log(`Butin : ${name} récupère ${held.label} (spawn #${spawnId})`)
              );
              caughtOutcome({ item: held, dropped: false });
            });
          });
        }
      );
    });
  });
}

// Les issues qui terminent le panneau : il n'y a plus rien à relancer.
const FINAL = new Set(["gone", "unknown-species", "void", "catch"]);
export const isFinalThrow = (outcome) => FINAL.has(outcome.status);

// Ce qu'un lancer a donné, en toutes lettres. La seule rédaction de ces
// messages : le panneau Discord et le site affichent la même phrase.
export function throwMessage(outcome) {
  const { ball, payment } = outcome;
  // Ce que le lancer a coûté, dit comme le dresseur l'a vécu.
  const mention = payment?.item ? `${payment.label} offerte` : `**-${ball?.price}** points`;

  switch (outcome.status) {
    case "unknown-ball":
      return "❌ Ball inconnue.";
    case "cooldown":
      return `⏳ Doucement ! Attends encore **${outcome.remaining}s** avant de relancer.`;
    case "gone":
      return "💨 Ce Pokémon n'est plus là !";
    case "unknown-species":
      return "❌ Espèce inconnue.";
    case "no-item":
      return `❌ Tu n'as plus de **${ball.label}** dans ton inventaire. Rien n'a été débité.`;
    case "insufficient":
      return (
        `❌ Solde insuffisant : une **${ball.label}** coûte **${ball.price}** points, ` +
        `tu en as **${outcome.balance}**.`
      );
    case "void":
      return (
        "💨 Trop tard, quelqu'un a été plus rapide ! " +
        (payment?.item
          ? `Ta **${payment.label}** t'a été rendue.`
          : `Tes **${ball.price}** points ont été remboursés.`)
      );
    case "miss":
      return (
        `❌ Raté ! **${displayName(outcome.species, outcome.spawn.is_shiny, outcome.spawn.sex)}** s'est dégagé de ` +
        `ta ${ball.label}. (${mention}, ${(outcome.probability * 100).toFixed(1)} % de réussite)`
      );
    case "catch": {
      const { item, dropped } = outcome.held ?? {};
      const butin = !item
        ? ""
        : dropped
          ? `\n${item.emoji} Il a lâché **${item.label}** en partant : il revient aux autres.`
          : `\n${item.emoji} Il tenait **${item.label}** !`;
      return (
        `🎉 Bravo ! **${displayName(outcome.species, outcome.spawn.is_shiny, outcome.caught?.sex)}** ` +
        `rejoint ton Pokédex ! (${mention})` +
        butin
      );
    }
    default:
      return "❌ Erreur base de données.";
  }
}

// ====================== CÔTÉ DISCORD ======================

// `panel` distingue les deux origines d'un clic : l'annonce publique, où l'on
// ouvre un éphémère, et le panneau de relance, où l'on réécrit celui d'où vient
// le clic. Sans ça, dix lancers laissaient dix messages empilés.
export async function throwBall(
  interaction,
  spawnId,
  ballKey,
  { panel = false, requireItem = false } = {}
) {
  const userId = interaction.user.id;

  const refusal = startThrow(userId, ballKey);
  if (refusal) return answerThrow(interaction, spawnId, throwMessage(refusal), { panel });

  // L'acquittement et le tirage partent ensemble. Attendre l'accusé de Discord
  // avant de tirer ajoutait un aller-retour à son API que le site n'a pas : dans
  // une course au même Pokémon, le clic Discord partait perdant de quelques
  // centaines de millisecondes. Si l'acquittement échoue (délai de Discord
  // dépassé), le lancer est joué quand même : l'annonce publique le montre, seul
  // l'éphémère manque — comme un lancer du site dont la réponse se perd.
  const acknowledged = (
    panel ? interaction.deferUpdate() : interaction.deferReply({ flags: MessageFlags.Ephemeral })
  ).then(
    () => {
      // Le nouveau panneau existe déjà (le defer l'a rendu visible) : on peut
      // retirer le précédent sans jamais laisser le joueur sans rien sous les yeux.
      trackPanel(interaction, spawnId, { replacing: !panel });
      return true;
    },
    (error) => {
      handleException("Acquittement d'un lancer :", error);
      return false;
    }
  );

  resolveThrow(interaction.client, userId, spawnId, ballKey, { requireItem }, async (err, outcome) => {
    // La réponse attend l'acquittement : sans lui, Discord refuserait editReply.
    if (!(await acknowledged)) return;
    // Un seul point de sortie décide de la forme de la réponse : les boutons
    // disparaissent quand il n'y a plus rien à relancer.
    interaction
      .editReply({
        content: throwMessage(outcome),
        components: isFinalThrow(outcome) ? [] : [buildBallRow(spawnId, { panel: true })],
      })
      .catch(() => {});
  });
}
