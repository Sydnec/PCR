// Les filtres du Pokédex et de la boîte PC : une recherche, puis des listes — rareté,
// génération, type, obtention, et ce que chaque page y ajoute. Une page dit lesquels
// elle montre et comment chercher dans une entrée ; les filtres disent si une entrée
// passe. Les valeurs vivent dans l'adresse (?rarete=RARE&gen=2), pour qu'un
// rechargement ou un lien les retrouve.
//
// La barre se construit une fois et reste en place : redessinée à chaque frappe, la
// recherche perdrait le curseur.
import { h, normalize } from "./lib.js";

const ordinal = (n) => (n === 1 ? "1ʳᵉ" : `${n}ᵉ`);

// Les filtres qui portent sur l'espèce, tirés de ce que /api/species dit de chacune :
// on ne propose que ce qui existe dans les générations ouvertes. Une entrée filtrée a
// son espèce dans `entry.species`.
export function speciesFilters(ctx) {
  const all = [...ctx.species.values()];
  const generations = [...new Set(all.map((species) => species.generation))].sort((a, b) => a - b);
  const types = new Set(all.flatMap((species) => species.types));
  const obtentions = new Set(all.map((species) => species.obtention));
  return [
    {
      key: "rarete",
      all: "Toutes les raretés",
      options: ctx.rarities
        .filter(({ key }) => all.some((species) => species.rarity === key))
        .map(({ key, label }) => [key, label]),
      test: ({ species }, value) => species.rarity === value,
    },
    // Une seule génération ouverte : rien à choisir.
    generations.length > 1 && {
      key: "gen",
      all: "Toutes les générations",
      options: generations.map((generation) => [
        String(generation),
        `${ordinal(generation)} génération`,
      ]),
      test: ({ species }, value) => String(species.generation) === value,
    },
    {
      key: "type",
      all: "Tous les types",
      options: Object.keys(ctx.types)
        .filter((type) => types.has(type))
        .map((type) => [type, type]),
      test: ({ species }, value) => species.types.includes(value),
    },
    {
      key: "obtention",
      all: "Toutes les obtentions",
      options: [
        ["wild", "À l'état sauvage"],
        ["evolution", "Par évolution"],
        ["egg", "Dans un œuf"],
      ].filter(([value]) => obtentions.has(value)),
      test: ({ species }, value) => species.obtention === value,
    },
  ].filter(Boolean);
}

// La barre : `filters` (speciesFilters et ceux de la page), `search(entry, needle)` dit
// si une entrée répond à la recherche (déjà sans accents ni majuscules), `params` les
// valeurs lues dans l'adresse, `onchange` redessine la page.
export function filterBar({ filters, search, placeholder, params, onchange }) {
  const state = { q: params.get("q") ?? "", values: {} };
  for (const filter of filters) {
    const value = params.get(filter.key);
    // Une valeur d'adresse inconnue (un lien ancien, une génération refermée) ne filtre pas.
    state.values[filter.key] = filter.options.some(([option]) => option === value) ? value : "";
  }

  const active = () => Boolean(state.q.trim()) || Object.values(state.values).some(Boolean);
  const changed = () => {
    clear.hidden = !active();
    onchange();
  };

  const input = h("input", {
    type: "search",
    value: state.q,
    placeholder,
    "aria-label": placeholder,
    oninput: (event) => {
      state.q = event.target.value;
      changed();
    },
  });
  const selects = filters.map((filter) =>
    h(
      "select",
      {
        "aria-label": filter.all,
        onchange: (event) => {
          state.values[filter.key] = event.target.value;
          event.target.classList.toggle("active", Boolean(event.target.value));
          changed();
        },
        class: state.values[filter.key] ? "active" : null,
      },
      h("option", { value: "" }, filter.all),
      filter.options.map(([value, label]) =>
        h("option", { value, selected: state.values[filter.key] === value }, label)
      )
    )
  );
  const clear = h(
    "button",
    { class: "button small ghost", type: "button", hidden: !active(), onclick: () => reset() },
    "Effacer les filtres"
  );

  function reset() {
    state.q = "";
    input.value = "";
    for (const filter of filters) state.values[filter.key] = "";
    for (const select of selects) {
      select.value = "";
      select.classList.remove("active");
    }
    changed();
  }

  return {
    element: h("div", { class: "toolbar filters" }, input, selects, clear),
    active,
    reset,
    matches(entry) {
      const needle = normalize(state.q.trim());
      if (needle && !search(entry, needle)) return false;
      return filters.every(
        (filter) => !state.values[filter.key] || filter.test(entry, state.values[filter.key])
      );
    },
    // Écrit les filtres choisis dans `query` (URLSearchParams).
    write(query) {
      if (state.q.trim()) query.set("q", state.q.trim());
      for (const filter of filters)
        if (state.values[filter.key]) query.set(filter.key, state.values[filter.key]);
    },
  };
}
