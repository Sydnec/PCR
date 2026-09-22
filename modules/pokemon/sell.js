// La revente : convertir en points ce qu'on a en trop.
//
// Deux marchandises, une seule idée. Un doublon de Pokémon se revend selon sa
// rareté, un objet selon la valeur que lui donne le catalogue — et dans les deux
// cas la séquence est la même : on retire d'abord, on crédite ensuite, et on
// rend ce qu'on a retiré si le crédit échoue. Jamais l'inverse : créditer avant
// de retirer, c'est payer deux fois celui qui clique deux fois.
//
// Le barème vit dans la configuration, pas ici. La seule règle en dur est celle
// qui ne se négocie pas : on ne vend que des doublons, l'entrée de Pokédex est
// toujours conservée.
import { addPoints } from "../economy.js";
import db from "../points-db.js";
import { handleException, log } from "../utils.js";
import { getPokemonConfig } from "./config.js";
import { getSpecies, rarityOf } from "./data.js";
import { getOwned, reserveDuplicates, restoreDuplicates } from "./collection.js";
import { consumeItem, getItem, grantItem, itemSellValue } from "./items.js";

// Ce que vaut un exemplaire. Un tarif absent vaut zéro, donc invendable : mieux
// vaut une espèce qu'on ne peut pas revendre qu'un prix inventé.
export function pokemonSellValue(species, isShiny) {
  if (!species) return 0;
  const config = getPokemonConfig().sell ?? {};
  const base = Math.round(Number(config.byRarity?.[rarityOf(species)]) || 0);
  if (base <= 0) return 0;
  const multiplier = isShiny ? Number(config.shinyMultiplier) || 1 : 1;
  return Math.max(0, Math.round(base * multiplier));
}

function journal(userId, speciesId, isShiny, quantity, points) {
  db.run(
    `INSERT INTO pokemon_sales (user_id, species_id, is_shiny, quantity, points, sold_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, speciesId, isShiny ? 1 : 0, quantity, points, Date.now()],
    (err) => {
      if (err) handleException("Journal des reventes :", err);
    }
  );
}

// ====================== POKÉMON ======================

export function sellPokemon(userId, speciesId, isShiny, quantity, cb) {
  const species = getSpecies(speciesId);
  if (!species) return cb(null, { ok: false, reason: "Espèce inconnue." });
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return cb(null, { ok: false, reason: "Il faut revendre au moins un exemplaire." });
  }

  const unit = pokemonSellValue(species, isShiny);
  if (unit <= 0) {
    return cb(null, { ok: false, reason: `**${species.name}** ne se revend pas.` });
  }
  const points = unit * quantity;

  reserveDuplicates(userId, speciesId, isShiny, quantity, (err, reserved) => {
    if (err) return cb(err);
    if (!reserved) {
      // Le refus est le même quelle qu'en soit la cause — pas assez
      // d'exemplaires, ou juste celui qu'on garde — donc on relit pour le dire
      // avec le bon chiffre plutôt qu'avec une formule passe-partout.
      return getOwned(userId, speciesId, isShiny, (err, owned) =>
        cb(err, {
          ok: false,
          reason:
            `Tu as **${owned}** ${species.name}${isShiny ? " ✨" : ""} et il t'en faut ` +
            `**${quantity + 1}** pour en revendre **${quantity}** : un exemplaire est ` +
            `toujours conservé.`,
        })
      );
    }

    addPoints(userId, points, (err) => {
      if (err) {
        // Compensation : les exemplaires réservés reviennent. Sans elle, un
        // crédit raté détruirait des Pokémon sans rien rendre.
        restoreDuplicates(userId, speciesId, isShiny, quantity, (restoreError) => {
          if (restoreError) {
            handleException("Restitution de doublons revendus :", restoreError);
          }
        });
        return cb(err);
      }

      journal(userId, speciesId, isShiny, quantity, points);
      log(
        `Revente : ${userId} vend ${quantity}× ${species.name}${isShiny ? " ✨" : ""} pour ${points} pts`
      );
      cb(null, { ok: true, species, isShiny, quantity, unit, points });
    });
  });
}

// ====================== OBJETS ======================

export function sellItem(userId, key, quantity, cb) {
  const item = getItem(key);
  if (!item) return cb(null, { ok: false, reason: "Objet inconnu." });
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return cb(null, { ok: false, reason: "Il faut revendre au moins un objet." });
  }

  const unit = itemSellValue(item);
  if (unit <= 0) {
    return cb(null, { ok: false, reason: `**${item.label}** ne se revend pas.` });
  }
  const points = unit * quantity;

  // consumeItem porte déjà la garde et le journal : un objet manquant rend
  // false, jamais une erreur.
  consumeItem(userId, key, quantity, { source: "vente" }, (err, consumed) => {
    if (err) return cb(err);
    if (!consumed) {
      return cb(null, {
        ok: false,
        reason: `Tu n'as pas **${quantity}** ${item.emoji} ${item.label} à revendre.`,
      });
    }

    addPoints(userId, points, (err) => {
      if (err) {
        grantItem(userId, key, quantity, { source: "vente-annulee" }, (restoreError) => {
          if (restoreError) handleException("Restitution d'objets revendus :", restoreError);
        });
        return cb(err);
      }

      log(`Revente : ${userId} vend ${quantity}× ${item.label} pour ${points} pts`);
      cb(null, { ok: true, item, quantity, unit, points });
    });
  });
}
