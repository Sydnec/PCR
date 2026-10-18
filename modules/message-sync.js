// Les messages publics que le jeu réécrit au fil de la partie : l'annonce d'une
// apparition, une offre d'échange, un parc safari, un objet au sol, un direct.
//
// Trois pièges, une seule porte :
// - deux réécritures d'un même message se croisent : celle partie la première
//   peut arriver la dernière, et reposer un état périmé par-dessus l'état final
//   (un Pokémon capturé qui redevient « actif ») ;
// - le contenu est préparé trop tôt : entre la lecture de la base et l'envoi à
//   Discord, la partie a pu avancer ;
// - Discord refuse une fois (coupure, limite de débit, 5xx) et le message reste
//   figé pour toujours.
// D'où : une écriture à la fois par message, le contenu construit au dernier
// moment par `build` (qui relit la base), et quelques réessais, chacun relisant
// la base à son tour. Ce qui échoue encore se rattrape plus tard : c'est à
// l'appelant de retenir en base que le message a reçu sa fin.
import { getConfig } from "./config.js";
import { handleException } from "./utils.js";

// Codes Discord qui prouvent que ce message ne se réécrira plus jamais :
// réessayer ne servirait à rien, et le rattrapage tournerait en boucle.
export const MESSAGE_GONE = new Set([
  10003, // Unknown Channel
  10008, // Unknown Message
  50001, // Missing Access
  50005, // Cannot edit a message authored by another user
  50013, // Missing Permissions
  50083, // Thread is archived
]);

const queues = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Réécrit le message `messageId` du salon `channelId`, après les réécritures
// déjà en file pour la même clé. `build(message)` rend le contenu à poser, ou
// null pour ne rien écrire ; il reçoit le message tel qu'il est quand `read`
// est demandé (pour en garder une partie), sinon rien — une requête de moins.
//
// Rend « edited », « skipped » (build a rendu null), « gone » (le message ne
// se réécrira plus — parfois avant même que `build` ait été appelé : c'est à
// l'appelant de relire la base pour savoir ce qui était à conclure) ou
// « failed » (les réessais sont épuisés). Ne lève jamais.
export function syncMessage(client, key, { channelId, messageId, build, read = false, label = key }) {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(() => write(client, { channelId, messageId, build, read, label }));
  queues.set(key, next);
  next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  return next;
}

async function write(client, { channelId, messageId, build, read, label }) {
  if (!client || !channelId || !messageId) return "skipped";
  const { retries, retryDelayMs } = getConfig().publicMessages;
  for (let attempt = 0; ; attempt++) {
    try {
      const channel = await client.channels.fetch(channelId);
      const message = read ? await channel.messages.fetch(messageId) : null;
      const payload = await build(message);
      if (!payload) return "skipped";
      if (message) await message.edit(payload);
      else await channel.messages.edit(messageId, payload);
      return "edited";
    } catch (error) {
      if (MESSAGE_GONE.has(error?.code)) return "gone";
      // Un autre refus 4xx (un embed que Discord juge invalide, par exemple) ne
      // passera pas mieux au deuxième essai : c'est un bug à voir, pas une panne
      // à attendre. Seule la limite de débit (429) vaut d'être réessayée.
      const permanent = error?.status >= 400 && error?.status < 500 && error?.status !== 429;
      if (permanent || attempt >= retries) {
        handleException(`Réécriture du message ${label} impossible :`, error);
        return "failed";
      }
      await sleep(retryDelayMs * 2 ** attempt);
    }
  }
}
