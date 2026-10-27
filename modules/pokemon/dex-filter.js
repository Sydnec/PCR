// Les filtres du Pokédex sur Discord : ceux du site (web/filters.js), calculés avec les
// mêmes fonctions — rareté (rarityOf), obtention (obtentionOf), génération et types de
// l'espèce, possession et shiny d'après la collection.
//
// Ils se choisissent dans la réponse de /pk pokedex (menus et boutons), pas en options
// de commande : /pk frôle la limite de 8 000 caractères que Discord impose à une
// commande, et la dépasser ferait refuser toutes les commandes au démarrage. Ils
// voyagent dans le customId des boutons et des menus (encodeDexFilters) : rien n'est
// gardé en mémoire, et un clic répond encore après un redémarrage.
import { RARITIES, allSpecies, obtentionOf, rarityOf, typeColors } from "./data.js";

export const OBTENTIONS = { wild: "À l'état sauvage", evolution: "Par évolution", egg: "Dans un œuf" };
export const VIEWS = { owned: "Possédées", missing: "Manquantes" };
export const SHINY = { 1: "Shiny possédé", 0: "Pas encore shiny" };

const ordinal = (n) => (Number(n) === 1 ? "1ʳᵉ" : `${n}ᵉ`);

// Ce que chaque filtre propose, d'après les espèces des générations ouvertes : on ne
// propose pas une rareté ou un type que personne ne peut avoir. [valeur, libellé].
export function dexFilterOptions() {
  const species = allSpecies();
  const has = (test) => (value) => species.some((entry) => test(entry, value));
  return {
    r: Object.entries(RARITIES)
      .filter(([key]) => has((entry, value) => rarityOf(entry) === value)(key))
      .map(([key, { label }]) => [key, label]),
    g: [...new Set(species.map((entry) => entry.generation))]
      .sort((a, b) => a - b)
      .map((generation) => [String(generation), `${ordinal(generation)} génération`]),
    t: Object.keys(typeColors())
      .filter(has((entry, value) => entry.types.includes(value)))
      .map((type) => [type, type]),
    o: Object.entries(OBTENTIONS).filter(([key]) => has((entry, value) => obtentionOf(entry) === value)(key)),
    v: Object.entries(VIEWS),
    s: Object.entries(SHINY),
  };
}

// L'ordre d'écriture dans le customId, et de lecture dans la description.
const KEYS = ["r", "g", "t", "o", "v", "s"];

// « r:RARE,g:2 » → { r: "RARE", g: "2" }. Une valeur inconnue (un vieux bouton, une
// génération refermée, un customId abîmé) ne filtre pas, plutôt que de tout vider.
export function decodeDexFilters(code) {
  const options = dexFilterOptions();
  const filters = {};
  for (const part of String(code ?? "").split(",")) {
    const [key, value] = part.split(":");
    if (options[key]?.some(([allowed]) => allowed === value)) filters[key] = value;
  }
  return filters;
}

export const encodeDexFilters = (filters) =>
  KEYS.filter((key) => filters[key])
    .map((key) => `${key}:${filters[key]}`)
    .join(",");

export const hasDexFilters = (filters) => KEYS.some((key) => filters[key]);

// « Rare · 2ᵉ génération · Feu », dans l'ordre des menus.
export function describeDexFilters(filters) {
  const options = dexFilterOptions();
  return KEYS.filter((key) => filters[key])
    .map((key) => options[key].find(([value]) => value === filters[key])?.[1])
    .filter(Boolean)
    .join(" · ");
}

// Les espèces qui passent les filtres, dans l'ordre du Pokédex. `owned` : ce que le
// dresseur en possède, par espèce ({ normal, shiny }, comme collectionStats).
export function filterDexSpecies(filters, owned) {
  return allSpecies().filter((species) => {
    const entry = owned.get(species.id);
    const has = Boolean(entry && (entry.normal > 0 || entry.shiny > 0));
    if (filters.r && rarityOf(species) !== filters.r) return false;
    if (filters.g && String(species.generation) !== filters.g) return false;
    if (filters.t && !species.types.includes(filters.t)) return false;
    if (filters.o && obtentionOf(species) !== filters.o) return false;
    if (filters.v && (filters.v === "owned") !== has) return false;
    if (filters.s && (filters.s === "1") !== Boolean(entry?.shiny > 0)) return false;
    return true;
  });
}
