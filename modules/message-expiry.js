// Suppression différée des messages programmés par /autodel.
//
// Deux défauts corrigés ici :
//   1. /autodel écrivait dans son propre fichier ./messages.db alors que le
//      balayage au démarrage lit botdata-<ANNÉE>.db. Les suppressions
//      programmées étaient donc perdues au premier redémarrage. Tout passe
//      désormais par modules/db.js, la base que lit le balayage.
//   2. setTimeout n'accepte pas de délai au-delà de 2^31-1 ms (~24,8 jours) :
//      au-delà, Node déclenche IMMÉDIATEMENT. Un `/autodel jours:30` supprimait
//      donc le message sur-le-champ. On réarme maintenant par tranches.
import db from "./db.js";
import { handleException, log } from "./utils.js";

const MAX_TIMEOUT_MS = 2_147_483_647;

// Un seul minuteur par message : reprogrammer un message déjà suivi remplace
// l'échéance précédente au lieu d'en accumuler une seconde.
const timers = new Map();

export function cancelScheduledDeletion(messageId) {
  const timer = timers.get(messageId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(messageId);
  }
}

// Découpe l'attente en tranches acceptées par setTimeout.
function armTimer(messageId, delayMs, onDue) {
  const slice = Math.min(delayMs, MAX_TIMEOUT_MS);
  const timer = setTimeout(() => {
    const remaining = delayMs - slice;
    if (remaining > 0) return armTimer(messageId, remaining, onDue);
    timers.delete(messageId);
    onDue();
  }, slice);
  // Ne pas retenir la boucle d'événements pour un rappel dans trois semaines.
  if (typeof timer.unref === "function") timer.unref();
  timers.set(messageId, timer);
}

function forget(messageId) {
  db.run("DELETE FROM messages WHERE id = ?", [messageId], (err) => {
    if (err) handleException("Nettoyage de la table messages :", err);
  });
}

// Programme (ou reprogramme) la suppression d'un message déjà résolu.
export function scheduleMessageDeletion(message, expireAt, link = message.url) {
  const messageId = message.id;
  cancelScheduledDeletion(messageId);

  const remove = () => {
    message
      .delete()
      .then(() => log(`Message supprimé : ${link}`))
      .catch((err) => handleException("Suppression programmée impossible :", err))
      .finally(() => forget(messageId));
  };

  const delay = expireAt - Date.now();
  if (delay <= 0) return remove();
  armTimer(messageId, delay, remove);
}

// Extrait guildId / channelId / messageId d'un lien de message Discord.
// Renvoie null si le lien n'est pas un lien de message Discord valide :
// `url.parse` (déprécié) acceptait n'importe quelle chaîne et laissait passer
// des identifiants fantaisistes jusqu'aux appels à l'API.
const MESSAGE_LINK =
  /^https?:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(\d{1,20}|@me)\/(\d{1,20})\/(\d{1,20})\/?$/;

export function parseMessageLink(link) {
  const match = MESSAGE_LINK.exec(String(link ?? "").trim());
  if (!match) return null;
  const [, guildId, channelId, messageId] = match;
  return { guildId, channelId, messageId };
}

// Résout un lien de message en objet Message, ou null.
export async function resolveMessageFromLink(bot, link) {
  const parts = parseMessageLink(link);
  if (!parts || parts.guildId === "@me") return null;
  const guild = await bot.guilds.fetch(parts.guildId).catch(() => null);
  if (!guild) return null;
  const channel = await guild.channels.fetch(parts.channelId).catch(() => null);
  if (!channel || !channel.isTextBased?.()) return null;
  return channel.messages.fetch(parts.messageId).catch(() => null);
}

export { MAX_TIMEOUT_MS };
