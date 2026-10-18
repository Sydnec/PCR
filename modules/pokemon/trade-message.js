// Le message public d'une offre d'échange, tel que la base le dit au moment de
// l'écrire. Le bouton qui conclut une offre réécrit lui-même son message ; tout
// le reste passe ici : le menu du destinataire (un éphémère, qui n'a pas la main
// sur le message public), une offre expirée, une fin que Discord a refusée.
import db from "../points-db.js";
import { getConfig } from "../config.js";
import { syncMessage } from "../message-sync.js";
import { handleException, log } from "../utils.js";
import { expireTrade, getTrade, setTradeMessage } from "./collection.js";
import { buildTradeEmbed, buildTradeRow } from "./embeds.js";

const read = (run) => new Promise((resolve, reject) => run((err, value) => (err ? reject(err) : resolve(value))));

// Le message d'une offre conclue : son résultat, et plus aucun bouton actif.
// `note` : ce que le dresseur doit lire en plus (la raison d'un échec).
export const tradeOutcome = (trade, status, note = null) => ({
  content: note ?? null,
  embeds: [buildTradeEmbed(trade, status)],
  components: [buildTradeRow(trade.id, { disabled: true })],
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
// encore ouverte n'a rien à changer : ses boutons sont les bons.
export async function syncTradeMessage(client, tradeId, { note = null } = {}) {
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
      final = Boolean(fresh) && fresh.status !== "PENDING";
      // La raison d'un échec ne vaut que pour l'échec qui l'a produite.
      return final ? tradeOutcome(fresh, fresh.status, fresh.status === "FAILED" ? note : null) : null;
    },
  });
  if (final && (result === "edited" || result === "gone")) await markTradeMessageClosed(tradeId);
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
    if ((await syncTradeMessage(client, id)) === "edited") repaired++;
  }
  if (repaired) log(`${repaired} message(s) d'échange conclu(s) après coup`);
  return repaired;
}
