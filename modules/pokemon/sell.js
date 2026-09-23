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
import { getSpecies, rarityOf, sexSymbol } from "./data.js";
import { countGroup, reserveDuplicates, restoreDuplicates } from "./collection.js";
import { consumeItem, getItem, grantItem, itemSellValue } from "./items.js";

// Ce que vaut un exemplaire. Un tarif absent vaut zéro, donc invendable : mieux
// vaut une espèce qu'on ne peut pas revendre qu'un prix inventé. C'est ce qui
// met les légendaires hors commerce — leur rareté n'a pas de ligne au barème —
// et les shinies avec, via un multiplicateur nul.
export function pokemonSellValue(species, isShiny) {
  if (!species) return 0;
  const config = getPokemonConfig().sell ?? {};
  const base = Math.round(Number(config.byRarity?.[rarityOf(species)]) || 0);
  if (base <= 0) return 0;
  // `|| 1` serait faux ici : shinyMultiplier vaut 0 quand les shinies ne se
  // revendent pas, et 0 || 1 rendrait justement le tarif qu'on refuse.
  const raw = Number(config.shinyMultiplier);
  const multiplier = isShiny ? (Number.isFinite(raw) ? raw : 0) : 1;
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

// `sex` restreint la vente à un sexe, NULL à n'importe lequel. Parmi les
// candidats, reserveDuplicates prend les stériles puis les plus récents : on
// revend ce qui vaut le moins, et jamais le dernier d'une espèce. `pokemonId`
// désigne un individu précis, qui se vend seul.
export function sellPokemon(userId, { speciesId, isShiny, sex = null, pokemonId = null }, quantity, cb) {
  const species = getSpecies(speciesId);
  if (!species) return cb(null, { ok: false, reason: "Espèce inconnue." });
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return cb(null, { ok: false, reason: "Il faut revendre au moins un exemplaire." });
  }

  if (pokemonId && quantity !== 1) {
    return cb(null, { ok: false, reason: `Le Pokémon #${pokemonId} se revend seul : quantité 1.` });
  }

  const unit = pokemonSellValue(species, isShiny);
  if (unit <= 0) {
    return cb(null, { ok: false, reason: `**${species.name}** ne se revend pas.` });
  }
  const points = unit * quantity;

  const name = `${species.name}${isShiny ? " ✨" : ""}${sex ? ` ${sexSymbol(sex)}` : ""}`;
  reserveDuplicates(userId, { speciesId, isShiny, sex, pokemonId }, quantity, (err, reserved) => {
    if (err) return cb(err);
    if (!reserved.length && pokemonId) {
      return cb(null, {
        ok: false,
        reason:
          `Le Pokémon #${pokemonId} ne peut pas être revendu : c'est ton dernier de son ` +
          `espèce, ou il n'est plus à toi.`,
      });
    }
    if (!reserved.length) {
      // Le refus est le même quelle qu'en soit la cause — pas assez
      // d'exemplaires, ou juste celui qu'on garde — donc on relit pour le dire
      // avec les bons chiffres plutôt qu'avec une formule passe-partout.
      return countGroup(userId, { speciesId, isShiny, sex }, (err, { owned, spare }) =>
        cb(err, {
          ok: false,
          reason:
            `Tu as **${owned}** ${name}, dont **${spare}** revendable${spare > 1 ? "s" : ""} : ` +
            `impossible d'en revendre **${quantity}**. Il reste toujours au moins un ` +
            `exemplaire de chaque Pokémon.`,
        })
      );
    }

    addPoints(userId, points, (err) => {
      if (err) {
        // Compensation : les exemplaires réservés reviennent, à l'identique.
        // Sans elle, un crédit raté détruirait des Pokémon sans rien rendre.
        restoreDuplicates(reserved, (restoreError) => {
          if (restoreError) {
            handleException("Restitution de doublons revendus :", restoreError);
          }
        });
        return cb(err);
      }

      journal(userId, speciesId, isShiny, quantity, points);
      log(
        `Revente : ${userId} vend ${quantity}× ${name} pour ${points} pts`
      );
      cb(null, { ok: true, species, isShiny, sex, quantity, unit, points });
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
