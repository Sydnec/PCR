// Le message public d'une offre d'échange, tel que la base le dit au moment de
// l'écrire. Le bouton qui conclut une offre réécrit lui-même son message ; tout
// le reste passe ici : le menu du destinataire (un éphémère, qui n'a pas la main
// sur le message public), une offre expirée, une fin que Discord a refusée.
import db from "../points-db.js";
import { getConfig } from "../config.js";
import { syncMessage } from "../message-sync.js";
import { handleException, log } from "../utils.js";
import { expireTrade, getTrade, reopenCountered, resolveTradeAs, setTradeMessage } from "./collection.js";
import { buildTradeEmbed, buildTradeRow, tradeRowOptions } from "./embeds.js";

const read = (run) => new Promise((resolve, reject) => run((err, value) => (err ? reject(err) : resolve(value))));

// Le message d'une offre conclue : son résultat, et plus aucun bouton actif.
// `note` : ce que le dresseur doit lire en plus (la raison d'un échec).
// Une offre contrée n'a plus de boutons du tout : elle a une suite, ailleurs. Une offre
// ouverte conclue par une contre-offre non plus : la suite est le message de celle-ci.
export const tradeOutcome = (trade, status, note = null) => ({
  content: note ?? null,
  embeds: [buildTradeEmbed(trade, status)],
  components:
    status === "COUNTERED" || status === "SETTLED"
      ? []
      : [buildTradeRow(trade.id, { disabled: true, ...tradeRowOptions(trade) })],
});

export function markTradeMessageClosed(tradeId) {
  return new Promise((resolve) =>
    db.run(
      "UPDATE pokemon_trades SET message_closed_at = ? WHERE id = ? AND message_closed_at IS NULL",
      [Date.now(), tradeId],
      (err) => {
        if (err) handleException("Marque de fin du message d'un échange :", err);
        resolve();
      }
    )
  );
}

// Réécrit le message d'une offre conclue d'après son statut en base. Une offre
// encore ouverte n'a rien à changer : ses boutons sont les bons. `repair` : ne
// rien écrire d'une fin déjà posée, qui portait peut-être la raison d'un échec.
//
// `restore` : l'offre vient d'être rouverte (contre-offre perdue, voir recoverCounterOffers) ;
// son message, peut-être déjà réécrit en « contre-offre », retrouve ses boutons.
export async function syncTradeMessage(client, tradeId, { note = null, repair = false, restore = false } = {}) {
  let trade;
  try {
    trade = await read((cb) => getTrade(tradeId, cb));
  } catch (error) {
    handleException("Lecture d'une offre à afficher :", error);
    return "failed";
  }
  if (!trade?.channel_id || !trade.message_id) return "skipped";

  let final = false;
  const result = await syncMessage(client, `trade:${tradeId}`, {
    channelId: trade.channel_id,
    messageId: trade.message_id,
    label: `de l'échange #${tradeId}`,
    build: async () => {
      const fresh = await read((cb) => getTrade(tradeId, cb));
      if (restore && fresh?.status === "PENDING") {
        return {
          embeds: [buildTradeEmbed(fresh, "PENDING")],
          components: [buildTradeRow(fresh.id, tradeRowOptions(fresh))],
        };
      }
      final = Boolean(fresh) && fresh.status !== "PENDING";
      if (!final || (repair && fresh.message_closed_at)) return null;
      // La raison d'un échec ne vaut que pour l'échec qui l'a produite.
      return tradeOutcome(fresh, fresh.status, fresh.status === "FAILED" ? note : null);
    },
  });
  // Un salon ou un message introuvable se constate parfois avant toute relecture :
  // la base dit alors si l'offre était à conclure.
  if (result === "gone") {
    const now = await read((cb) => getTrade(tradeId, cb)).catch(() => null);
    if (now && now.status !== "PENDING") await markTradeMessageClosed(tradeId);
  } else if (final && result === "edited") {
    await markTradeMessageClosed(tradeId);
  }
  return result;
}

// Retient le message d'une offre qu'on vient de publier. Le message existe avant
// que la base le connaisse : si l'offre s'est conclue entre les deux (un clic
// très rapide sur le menu du destinataire), personne n'a pu réécrire son message
// public — on le fait maintenant.
export async function linkTradeMessage(client, tradeId, messageId) {
  const failed = await new Promise((resolve) => setTradeMessage(tradeId, messageId, resolve));
  if (failed) return;
  const trade = await read((cb) => getTrade(tradeId, cb)).catch(() => null);
  if (trade && trade.status !== "PENDING") await syncTradeMessage(client, tradeId);
}

// Les offres arrivées à échéance sans réponse passent en EXPIRED, et leur message
// perd ses boutons. Celles qui ont expiré avant la fenêtre du rattrapage (des
// offres oubliées depuis des semaines) changent de statut sans que leur message
// soit retouché : les réécrire toutes d'un coup ne servirait à personne.
export async function expireTrades(client) {
  const now = Date.now();
  const windowStart = now - getConfig().publicMessages.repairWindowHours * 3600 * 1000;
  let rows;
  try {
    rows = await read((cb) =>
      db.all(
        "SELECT id, expires_at FROM pokemon_trades WHERE status = 'PENDING' AND expires_at <= ?",
        [now],
        cb
      )
    );
  } catch (error) {
    handleException("Recherche des offres expirées :", error);
    return 0;
  }
  let expired = 0;
  for (const row of rows) {
    const done = await read((cb) => expireTrade(row.id, cb)).catch((error) => {
      handleException("Expiration d'une offre :", error);
      return false;
    });
    if (!done) continue;
    expired++;
    if (row.expires_at > windowStart) await syncTradeMessage(client, row.id);
    else await markTradeMessageClosed(row.id);
  }
  if (expired) log(`${expired} offre(s) d'échange expirée(s)`);
  return expired;
}

// Les offres conclues dont le message n'a jamais reçu sa fin.
export async function repairTradeMessages(client) {
  const { repairGraceSeconds, repairWindowHours } = getConfig().publicMessages;
  const now = Date.now();
  let rows;
  try {
    rows = await read((cb) =>
      db.all(
        `SELECT id FROM pokemon_trades
          WHERE status != 'PENDING' AND message_id IS NOT NULL AND message_closed_at IS NULL
            AND resolved_at <= ? AND resolved_at > ?`,
        [now - repairGraceSeconds * 1000, now - repairWindowHours * 3600 * 1000],
        cb
      )
    );
  } catch (error) {
    handleException("Recherche des messages d'échange à conclure :", error);
    return 0;
  }
  let repaired = 0;
  for (const { id } of rows) {
    if ((await syncTradeMessage(client, id, { repair: true })) === "edited") repaired++;
  }
  if (repaired) log(`${repaired} message(s) d'échange conclu(s) après coup`);
  return repaired;
}

// Une contre-offre se fait en deux temps en base (l'original se ferme, la nouvelle se crée)
// puis un troisième sur Discord (publication). Un redémarrage entre deux laisse :
// (a) une contre-offre PENDING que personne n'a jamais vue (sans message) — c'est nous qui
// l'annulons, et l'original, resté fermé, se rouvre ; (b) un original COUNTERED sans aucune
// contre-offre. Une contre-offre qui a existé puis été refusée, expirée, acceptée ou
// annulée par quelqu'un est une réponse : son original ne se rouvre jamais. Le délai de
// grâce laisse finir une contre-offre en cours de publication.
export async function recoverCounterOffers(client) {
  const { repairGraceSeconds } = getConfig().publicMessages;
  const cutoff = Date.now() - repairGraceSeconds * 1000;
  let orphans;
  let lost;
  try {
    orphans = await read((cb) =>
      db.all(
        `SELECT id, from_user_id, counter_of FROM pokemon_trades
          WHERE status = 'PENDING' AND counter_of IS NOT NULL AND message_id IS NULL AND created_at <= ?`,
        [cutoff],
        cb
      )
    );
    lost = await read((cb) =>
      db.all(
        `SELECT id FROM pokemon_trades AS original
          WHERE status = 'COUNTERED' AND resolved_at <= ?
            AND NOT EXISTS (SELECT 1 FROM pokemon_trades WHERE counter_of = original.id)`,
        [cutoff],
        cb
      )
    );
  } catch (error) {
    handleException("Recherche des contre-offres perdues :", error);
    return 0;
  }
  const originals = new Set(lost.map((row) => row.id));
  for (const orphan of orphans) {
    const cancelled = await read((cb) => resolveTradeAs(orphan.id, orphan.from_user_id, "CANCELLED", cb)).catch(
      (error) => {
        handleException("Annulation d'une contre-offre sans message :", error);
        return false;
      }
    );
    if (cancelled) originals.add(orphan.counter_of);
  }
  let recovered = 0;
  for (const id of originals) {
    const reopened = await read((cb) => reopenCountered(id, cb)).catch((error) => {
      handleException("Réouverture d'une offre contrée :", error);
      return false;
    });
    if (!reopened) continue;
    recovered++;
    await syncTradeMessage(client, id, { restore: true });
  }
  if (recovered) log(`${recovered} offre(s) d'échange rouverte(s) faute de contre-offre`);
  return recovered;
}
