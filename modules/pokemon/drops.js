// Ce qu'un Pokémon laisse tomber en partant.
//
// Un Pokémon sur quelques-uns tient un objet. En temps normal il part avec celui
// qui l'attrape ; une fois sur cinq il le lâche par terre, et là c'est une
// seconde course — ouverte à tous les autres, y compris à ceux qui n'ont pas
// lancé une seule ball, mais pas à celui qui vient de gagner la première. C'est
// aussi la seule chose qu'un Pokémon enfui laisse derrière lui, ce qui donne une
// raison de suivre une apparition qu'on sait perdue.
//
// Même doctrine que le reste : l'objet au sol est une ligne en base, sa
// revendication un UPDATE gardé dont on inspecte this.changes. Deux clics
// simultanés, un seul ramasseur — et le bouton répond encore après un
// redémarrage du bot.
import db from "../points-db.js";
import { getConfig } from "../config.js";
import { syncMessage } from "../message-sync.js";
import { handleException, log } from "../utils.js";
import { pseudo } from "../pseudo.js";
import { getPokemonConfig } from "./config.js";
import { getItem, grantItem } from "./items.js";
import { buildDropEmbed, buildDropRow } from "./embeds.js";

// Le tirage, et lui seul : les appelants décident quoi en faire. Sortir le
// hasard de la décision rend le reste testable et lisible.
export function leavesItemBehind() {
  const chance = Number(getPokemonConfig().spawn?.itemDropChance) || 0;
  return chance > 0 && Math.random() < chance;
}

export function getDrop(dropId, cb) {
  db.get("SELECT * FROM pokemon_drops WHERE id = ?", [dropId], cb);
}

// Vrai quand `?` a capturé le Pokémon qui a lâché l'objet : ce qu'un Pokémon
// capturé lâche revient aux autres, il a déjà gagné la première course. Écrit
// une fois, pour la garde de claimDrop comme pour la liste que lit le site.
const CAPTOR = `EXISTS (
  SELECT 1 FROM pokemon_spawns s
   WHERE s.id = pokemon_drops.spawn_id AND s.caught_by = ?)`;

// Les objets qui attendent encore d'être ramassés, les plus récents d'abord.
// `captor` dit, pour `userId`, que celui-là n'est pas pour lui.
export function getOpenDrops(userId, cb) {
  db.all(
    `SELECT *, ${CAPTOR} AS captor FROM pokemon_drops WHERE status = 'OPEN' ORDER BY id DESC`,
    [String(userId)],
    (err, rows) => cb(err, rows ?? [])
  );
}

// Pose l'objet par terre et l'annonce. L'annonce est best-effort : un salon
// injoignable ne doit pas empêcher la ligne d'exister, mais un objet dont
// personne ne voit le message n'a aucun intérêt — on le referme donc plutôt que
// de le laisser ouvert pour l'éternité. Le rappel reçoit l'identifiant de
// l'objet, ou null quand il n'est pas au sol : personne ne pourra le ramasser.
export function dropItem(client, { spawn, itemKey }, cb = () => {}) {
  const item = getItem(itemKey);
  if (!item) return cb(null, null);

  db.run(
    `INSERT INTO pokemon_drops (spawn_id, item_key, species_id, channel_id, dropped_at)
     VALUES (?, ?, ?, ?, ?)`,
    [spawn?.id ?? null, itemKey, spawn?.species_id ?? null, spawn?.channel_id ?? null, Date.now()],
    async function (err) {
      if (err) {
        handleException("Dépôt d'un objet au sol :", err);
        return cb(err, null);
      }
      const dropId = this.lastID;

      // Sans salon où l'annoncer, l'objet n'a aucun bouton derrière lui : le
      // laisser OUVERT en base, c'est une ligne que personne ne pourra jamais
      // réclamer. On le déclare perdu, comme pour un envoi qui échoue.
      if (!client || !spawn?.channel_id) {
        // Le rappel attend l'écriture : quand il part, la ligne est close. Sans
        // cela l'appelant reprend la main pendant que l'UPDATE est encore en vol
        // et peut relire un statut qui n'est pas encore le bon.
        return abandon(dropId, (lost) => cb(null, lost ? null : dropId));
      }
      try {
        const channel = await client.channels.fetch(spawn.channel_id);
        const message = await channel.send({
          embeds: [buildDropEmbed(item)],
          components: [buildDropRow(dropId)],
        });
        // Le message existe avant que la base le connaisse : un ramassage depuis
        // le site, dans l'intervalle, n'a pas pu en retirer le bouton. Une fois
        // le message retenu, on le réécrit si l'objet n'est déjà plus au sol.
        db.run(
          "UPDATE pokemon_drops SET message_id = ? WHERE id = ?",
          [message.id, dropId],
          (err) => {
            if (err) return handleException("Enregistrement du message d'objet au sol :", err);
            getDrop(dropId, (err, row) => {
              if (!err && row && row.status !== "OPEN") syncDropMessage(client, dropId);
            });
          }
        );
        log(`Objet au sol #${dropId} : ${item.label} (spawn #${spawn.id ?? "—"})`);
      } catch (error) {
        handleException("Annonce d'un objet au sol :", error);
        return abandon(dropId, (lost) => cb(lost ? error : null, lost ? null : dropId));
      }
      cb(null, dropId);
    }
  );
}

// Déclare perdu un objet que rien n'annonce. Gardé par le statut : le site liste
// les objets OUVERTS dès leur dépôt, et un ramassage passé entre-temps ne doit
// pas être effacé. `lost` dit si l'objet est vraiment perdu — l'appelant peut
// alors le rendre ailleurs sans risque de le dupliquer.
function abandon(dropId, cb) {
  db.run(
    "UPDATE pokemon_drops SET status = 'LOST' WHERE id = ? AND status = 'OPEN'",
    [dropId],
    function (err) {
      if (err) handleException("Abandon d'un objet au sol :", err);
      cb(!err && this.changes === 1);
    }
  );
}

// Repose l'objet par terre après une revendication qui n'a pas abouti. Les trois
// colonnes repartent ensemble : un statut OUVERT qui garderait un ramasseur ou
// une heure de ramassage serait un état que rien ne sait plus lire.
function reopen(dropId, cb) {
  db.run(
    `UPDATE pokemon_drops SET status = 'OPEN', claimed_by = NULL, claimed_at = NULL
      WHERE id = ?`,
    [dropId],
    (err) => {
      if (err) handleException("Réouverture d'un objet au sol :", err);
      cb();
    }
  );
}

// Revendication atomique, par un UPDATE gardé : un seul ramasseur, jamais le
// capteur. Rend { ok, reason } comme les autres actions du jeu — `captor` quand
// le refus tient à la règle et non à la course —, et au vainqueur l'objet au sol
// avec sa définition.
export function claimDrop(userId, dropId, cb) {
  db.run(
    `UPDATE pokemon_drops SET status = 'CLAIMED', claimed_by = ?, claimed_at = ?
      WHERE id = ? AND status = 'OPEN' AND NOT ${CAPTOR}`,
    [userId, Date.now(), dropId, String(userId)],
    function (err) {
      if (err) return cb(err, null);
      if (this.changes !== 1) {
        // Relu seulement pour dire pourquoi. Une relecture ratée ne change rien
        // au refus : elle dit « trop tard » plutôt qu'une erreur.
        return db.get(
          `SELECT status, ${CAPTOR} AS captor FROM pokemon_drops WHERE id = ?`,
          [String(userId), dropId],
          (err, row) => {
            if (err) handleException("Relecture d'un objet au sol :", err);
            if (row?.status === "OPEN" && row.captor) {
              return cb(null, {
                ok: false,
                captor: true,
                reason: "🙅 Tu viens de le capturer : ce qu'il a lâché revient aux autres.",
              });
            }
            // Encore au sol : un ramassage raté vient de l'y reposer.
            if (row?.status === "OPEN") {
              return cb(null, { ok: false, reason: "Il vient de retomber par terre : réessaie !" });
            }
            cb(null, { ok: false, reason: "💨 Trop tard, quelqu'un a été plus rapide !" });
          }
        );
      }

      getDrop(dropId, (err, drop) => {
        if (err || !drop) return cb(err ?? new Error(`Objet au sol introuvable : ${dropId}`), null);
        const item = getItem(drop.item_key);
        if (!item) {
          // Clé disparue du catalogue entre le dépôt et le ramassage : on rouvre
          // plutôt que de faire disparaître l'objet dans le vide. claimed_at
          // part avec claimed_by — une ligne OUVERTE qui garde l'heure d'une
          // revendication annulée ferait mentir n'importe quelle relecture.
          return reopen(dropId, () =>
            cb(new Error(`Objet au sol inconnu : ${drop.item_key}`), null)
          );
        }

        grantItem(userId, drop.item_key, 1, { source: `sol:${dropId}` }, (err, granted) => {
          if (err) {
            // Le crédit a échoué : l'objet retourne par terre, sans quoi il
            // serait perdu pour tout le monde.
            return reopen(dropId, () => cb(err, null));
          }
          pseudo(userId).then((name) =>
            log(`Objet au sol #${dropId} ramassé par ${name} (${item.label})`)
          );
          cb(null, { ok: true, drop, item, granted });
        });
      });
    }
  );
}

const read = (run) => new Promise((resolve, reject) => run((err, value) => (err ? reject(err) : resolve(value))));

export function markDropMessageClosed(dropId) {
  return new Promise((resolve) =>
    db.run(
      "UPDATE pokemon_drops SET message_closed_at = ? WHERE id = ? AND message_closed_at IS NULL",
      [Date.now(), dropId],
      (err) => {
        if (err) handleException("Marque de fin du message d'un objet au sol :", err);
        resolve();
      }
    )
  );
}

// Le message d'un objet au sol, tel que la base le dit au moment de l'écrire :
// ramassé, il dit par qui et perd son bouton. Encore au sol (un ramassage raté
// l'y a reposé), il n'a rien à changer.
export async function syncDropMessage(client, dropId) {
  const drop = await read((cb) => getDrop(dropId, cb)).catch((error) => {
    handleException("Lecture d'un objet au sol à afficher :", error);
    return null;
  });
  if (!drop?.channel_id || !drop.message_id) return "skipped";

  let final = false;
  const result = await syncMessage(client, `drop:${dropId}`, {
    channelId: drop.channel_id,
    messageId: drop.message_id,
    label: `de l'objet au sol #${dropId}`,
    build: async () => {
      const fresh = await read((cb) => getDrop(dropId, cb));
      const item = fresh && getItem(fresh.item_key);
      final = fresh?.status === "CLAIMED" && Boolean(item);
      return final ? { embeds: [buildDropEmbed(item, { claimedBy: fresh.claimed_by })], components: [] } : null;
    },
  });
  if (final && (result === "edited" || result === "gone")) {
    if (result === "gone") log(`Message de l'objet au sol #${dropId} introuvable, ramassage non affiché`);
    await markDropMessageClosed(dropId);
  }
  return result;
}

// Un objet ramassé ailleurs que par son bouton — depuis le site — doit quand
// même disparaître du salon : sinon le bouton resterait là, et le premier qui
// cliquerait apprendrait qu'il n'y a plus rien. Sur Discord, le clic réécrit
// lui-même le message. Un message supprimé n'annule pas le ramassage.
export function announceDropClaim(client, drop) {
  if (!client || !drop?.id) return Promise.resolve("skipped");
  return syncDropMessage(client, drop.id);
}

// Les objets ramassés dont le message montre encore le bouton.
export async function repairDropMessages(client) {
  const { repairGraceSeconds, repairWindowHours } = getConfig().publicMessages;
  const now = Date.now();
  const rows = await read((cb) =>
    db.all(
      `SELECT id FROM pokemon_drops
        WHERE status = 'CLAIMED' AND message_id IS NOT NULL AND message_closed_at IS NULL
          AND claimed_at <= ? AND claimed_at > ?`,
      [now - repairGraceSeconds * 1000, now - repairWindowHours * 3600 * 1000],
      cb
    )
  ).catch((error) => {
    handleException("Recherche des messages d'objet au sol à conclure :", error);
    return [];
  });
  let repaired = 0;
  for (const { id } of rows) {
    if ((await syncDropMessage(client, id)) === "edited") repaired++;
  }
  if (repaired) log(`${repaired} message(s) d'objet au sol conclu(s) après coup`);
  return repaired;
}
