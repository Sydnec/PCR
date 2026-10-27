// Ce qu'un côté d'un échange peut contenir — un Pokémon, un objet ou des points — et
// comment on le valide. /pk echange (options) et son brouillon (menus) passent tous deux
// par ici : un côté ne se contrôle qu'à un endroit, pour que le solde, le stock, les
// charmes, le verrou et le dernier exemplaire se vérifient pareil des deux façons.
import { getBalance } from "../economy.js";
import {
  countBySpecies,
  getIndividuals,
  resolveIndividual,
  resolveSpecies,
  selectorOf,
  tradeCandidate,
} from "./collection.js";
import { allSpecies, getSpecies, isAvailable, tradeEvolutionTarget } from "./data.js";
import { getInventory, getItem, getItemCount, getItems, isTradable, itemCap, itemOpen } from "./items.js";
import { describeGroup } from "./embeds.js";

const promisify = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (err, value) => (err ? reject(err) : resolve(value))));

// Ce qu'une option de côté (`je_donne`, `je_recois`) peut valoir : une espèce, un
// objet ou des points. Le préfixe dit de quoi il s'agit, pour que l'autocomplétion
// mêle les trois sans qu'une clé d'objet se prenne pour un numéro d'espèce. Un nombre
// tapé à la main vaut des points (« 3000 », « 3 000 points »), sans passer par la liste :
// c'est ce qui évite une option de plus pour le montant.
export const speciesValue = (id) => `pk:${id}`;
export const pointsValue = (amount) => `pts:${amount}`;
// « À son choix » : le côté demandé laissé ouvert, au destinataire de dire ce qu'il donne.
export const OPEN_VALUE = "open";
export const itemValue = (key, quantity = null) =>
  quantity === null ? `item:${key}` : `item:${key}:${quantity}`;

export function parseChoice(value) {
  const text = String(value ?? "").trim();
  const amount = text.match(/^(?:pts:)?(\d[\d\s]*?)\s*(?:pts?|points?)?$/i);
  if (amount) {
    const points = Number(amount[1].replace(/\s/g, ""));
    return Number.isSafeInteger(points) ? { kind: "points", amount: points } : null;
  }
  if (/^rien$/i.test(text)) return { kind: "points", amount: 0 };
  if (text === OPEN_VALUE) return { kind: "open" };
  const species = text.match(/^pk:(\d+)$/);
  if (species) return { kind: "pk", id: species[1] };
  const item = text.match(/^item:([^:]+)(?::(\d+))?$/);
  if (item) {
    const quantity = item[2] ? Number(item[2]) : 1;
    return Number.isSafeInteger(quantity) ? { kind: "item", id: item[1], quantity } : null;
  }
  return null;
}

// Ce que l'autocomplétion lit d'une saisie qui commence par un nombre : « 3000 » (ou
// « 3 000 », « 3000 points ») est un montant, « 3 bonbon » ou « 3x bonbon » une quantité
// d'un objet. null quand la saisie ne commence pas par un nombre.
export function readNumberQuery(query) {
  const text = String(query ?? "").trim();
  const digits = text.replace(/\s*(?:pts?|points?)$/i, "");
  if (/^\d[\d\s]*$/.test(digits)) return { amount: Number(digits.replace(/\s/g, "")), rest: "" };
  const found = text.match(/^(\d+)(?:[x×]|\s)\s*(\S.*)$/i);
  return found ? { amount: Number(found[1]), rest: found[2].trim() } : null;
}

// Premier temps : les espèces dont `userId` a des Pokémon en trop, shiny ou
// non — jamais le dernier de l'espèce, jamais un verrouillé.
export function speciesChoices(userId, needle) {
  return promisify(getIndividuals, userId).then((rows) =>
    [...countBySpecies(rows)]
      .map(([speciesId, { spare }]) => {
        const species = getSpecies(speciesId);
        if (!species || spare < 1) return null;
        // Les quatre évolutions par échange se disent ici plutôt que dans un
        // message d'aide que personne ne lit : c'est l'instant exact où on choisit
        // ce qu'on donne. Le filtre portant sur le libellé, taper « mackogneur »
        // remonte le Machopeur qui y mène.
        const evolved = tradeEvolutionTarget(species);
        return {
          name:
            `${species.name} ×${spare} en trop` +
            (evolved ? ` — évoluera gratuitement en ${evolved.name} chez l'autre` : ""),
          value: speciesValue(speciesId),
        };
      })
      .filter((choice) => choice && choice.name.toLowerCase().includes(needle))
  );
}

// Les objets de `userId` qui s'échangent. Tous le sont, sauf les charmes
// (isTradable). Avec `quantity` (« 3 bonbon »), chaque choix porte cette quantité, et dit
// combien en a `userId` : le refus, lui, donne les chiffres.
export function itemChoices(userId, needle, quantity = null) {
  return promisify(getInventory, userId).then((rows) =>
    rows
      .map((row) => ({ row, item: getItem(row.item_key) }))
      .filter(({ item }) => item && isTradable(item) && item.label.toLowerCase().includes(needle))
      .map(({ row, item }) => ({
        // Pas d'emoji : ceux du serveur ne se rendent pas dans une proposition.
        name: quantity !== null
          ? `${quantity.toLocaleString("fr-FR")}× ${item.label} (sur ${row.count.toLocaleString("fr-FR")})`
          : `${item.label} ×${row.count.toLocaleString("fr-FR")} (objet)`,
        value: itemValue(item.key, quantity),
      }))
  );
}

// Ce qu'une offre ouverte à tous peut demander, sans destinataire dont lire la
// collection : les espèces du Pokédex ouvert et les objets qui s'échangent. Celui qui
// acceptera devra l'avoir : acceptTrade le vérifie.
export function anySpeciesChoices(needle) {
  return allSpecies()
    .filter((species) => species.name.toLowerCase().includes(needle))
    .map((species) => ({ name: species.name, value: speciesValue(species.id) }));
}

export function anyItemChoices(needle, quantity = null) {
  return getItems()
    .filter((item) => isTradable(item) && itemOpen(item) && item.label.toLowerCase().includes(needle))
    .map((item) => ({
      name: quantity !== null ? `${quantity.toLocaleString("fr-FR")}× ${item.label}` : `${item.label} (objet)`,
      value: itemValue(item.key, quantity),
    }));
}

// Valide un côté et le range comme proposeTrade l'attend : `{ side }`, ou `{ error }`
// rédigé pour celui qui propose. `choice` vient de parseChoice (ou d'un brouillon),
// `individual` désigne l'individu qu'on donne ("#123", sinon le moins précieux), `owner`
// est le dresseur chez qui le côté se retire et `own` dit si c'est celui qui propose :
// « tu » ou « <@id> ». `receiver` reçoit le côté : un objet plafonné (la Master Ball)
// ne s'offre pas à qui en a déjà le maximum. Tout se relit en base : une valeur a pu
// vieillir depuis le menu.
//
// Sans `owner` — ce que demande une offre ouverte à tous —, rien ne se lit chez personne :
// le côté doit seulement exister, et celui qui acceptera devra l'avoir.
export async function checkSide(choice, individual, owner, own, receiver = null) {
  const who = own ? "Tu" : `<@${owner}>`;
  const anyone = !owner;
  // « À son choix » ne se dit que de ce qu'on demande : on ne promet pas « ce que je
  // voudrai » en retour, l'offre doit être concrète.
  if (choice.kind === "open") {
    return own
      ? { error: "« À son choix » ne vaut que pour ce que tu demandes : dis ce que tu donnes." }
      : { side: { open: true } };
  }
  if (choice.kind === "points") {
    const amount = choice.amount;
    if (anyone) return { side: { points: amount } };
    const balance = await promisify(getBalance, owner);
    if (amount > balance) {
      return {
        error:
          `${who} ${own ? "n'as" : "n'a"} que **${balance.toLocaleString("fr-FR")}** points : ` +
          `${own ? "il t'en faut" : "il lui en faut"} **${amount.toLocaleString("fr-FR")}**.`,
      };
    }
    return { side: { points: amount } };
  }

  if (choice.kind === "item") {
    const key = choice.id;
    const item = getItem(key);
    if (!item) return { error: "Objet inconnu : choisis-le dans la liste d'autocomplétion." };
    if (!isTradable(item)) {
      return { error: `**${item.label}** ne s'échange pas : un charme se gagne, il ne se transmet pas.` };
    }
    const quantity = choice.quantity;
    if (quantity < 1) return { error: "La quantité doit être d'au moins 1." };
    const held = anyone ? quantity : await promisify(getItemCount, owner, key);
    if (quantity > held) {
      return {
        error:
          `${who} ${own ? "n'as" : "n'a"} que **${held.toLocaleString("fr-FR")}** ${item.label} : ` +
          `${own ? "il t'en faut" : "il lui en faut"} **${quantity.toLocaleString("fr-FR")}**.`,
      };
    }
    const cap = itemCap(item);
    if (cap && receiver) {
      const theirs = await promisify(getItemCount, receiver, key);
      if (theirs + quantity > cap) {
        // Le receveur est l'autre partie : la cible quand on donne, soi quand on demande.
        const them = own ? `<@${receiver}> a` : "Tu as";
        return {
          error:
            `${them} déjà **${theirs.toLocaleString("fr-FR")}** ${item.label}, et on n'en garde ` +
            `pas plus de **${cap.toLocaleString("fr-FR")}** : l'échange ne passerait pas.`,
        };
      }
    }
    return { side: { item: key, quantity } };
  }

  // Un Pokémon. Celui qu'on donne se désigne (mon_individu), faute de quoi c'est le
  // moins précieux, le plus récent à égalité (tradeCandidate) ; celui qu'on demande
  // se choisit chez le destinataire, en acceptant : il faut seulement qu'il en ait un
  // libre.
  const { species: found, error } = resolveSpecies(choice.id);
  if (error) return { error };
  if (anyone) {
    if (individual) return { error: "Un individu ne se désigne que chez un dresseur précis." };
    if (!isAvailable(found)) return { error: `**${found.name}** n'est pas encore dans le Pokédex.` };
    return { side: { speciesId: found.id } };
  }
  // Un individu désigné se contrôle des deux côtés : celui qu'on donne, et celui qu'une
  // contre-offre redemande tel que l'offre d'origine le désignait (il a pu partir).
  if (individual) {
    const selector = await promisify(resolveIndividual, owner, choice.id, individual);
    if (selector.error) return { error: selector.error };
    if (selector.row.locked) {
      return {
        error: own
          ? `**${describeGroup(found, selector)}** est verrouillé 🛡️ : déverrouille-le avec ` +
            `/pk verrou pour l'échanger.`
          : `**${describeGroup(found, selector)}** est verrouillé chez <@${owner}> : il ne peut pas l'échanger.`,
      };
    }
    if (selector.row.last) {
      return {
        error: own
          ? `**${describeGroup(found, selector)}** est ton dernier ${found.name} : il reste ` +
            `toujours au moins un Pokémon de chaque espèce.`
          : `**${describeGroup(found, selector)}** est le dernier ${found.name} de <@${owner}> : il ` +
            `reste toujours au moins un Pokémon de chaque espèce.`,
      };
    }
    return { side: selector };
  }
  const candidate = await promisify(tradeCandidate, owner, found.id);
  if (!candidate) {
    return {
      error:
        `${who} ${own ? "n'as" : "n'a"} aucun ${found.name} à donner : ` +
        `ils sont verrouillés, ou il ${own ? "ne t'en reste" : "ne lui en reste"} qu'un.`,
    };
  }
  return { side: own ? selectorOf(candidate) : { speciesId: found.id } };
}

// Ce qui rend une offre sans objet, une fois ses deux côtés validés : deux côtés à zéro
// point, ou un cadeau « à son choix » (rien offert, rien demandé de précis). null si elle tient.
export function emptyTradeProblem(offer, request) {
  if (offer.points === 0 && request.open) {
    return "Rien à échanger : tu n'offres rien, et « à son choix » ne demande rien de précis.";
  }
  if (offer.points === 0 && request.points === 0) {
    return "Rien à échanger : les deux côtés sont à 0 point.";
  }
  return null;
}

// Un côté d'une offre en base, redit comme un choix de brouillon : c'est ce qui préremplit
// une contre-offre. Un individu désigné le reste ; un côté ouvert reste ouvert.
export function choiceOfTradeSide(trade, prefix) {
  if (prefix === "request" && trade.request_open) return { kind: "open" };
  const points = trade[`${prefix}_points`];
  if (points !== null && points !== undefined) return { kind: "points", amount: points };
  const item = trade[`${prefix}_item`];
  if (item) return { kind: "item", id: item, quantity: trade[`${prefix}_item_qty`] };
  const pokemonId = trade[`${prefix}_pokemon_id`];
  return {
    kind: "pk",
    id: String(trade[`${prefix}_species_id`]),
    // L'individu désigné reste désigné, des deux côtés : une contre-offre qui redemande
    // le Pokémon offert redemande celui-là, pas un autre de l'espèce.
    individual: pokemonId ? `#${pokemonId}` : null,
  };
}
