// La lignée d'une espèce, stade par stade, avec ce que le dresseur possède de
// chaque maillon : la fiche du bouton « Infos du Pokémon » de Discord. Un seul
// rendu pour l'onglet Capture, la boîte et le Pokédex, qui ne peuvent donc pas
// se contredire.
import { icon } from "./icons.js";
import { OBTENTION_LEGENDS, api, fmt, h, obtentionMark, richText } from "./lib.js";

// La lignée et la possession, lues par l'API avec les fonctions de la fiche
// Discord : `{ lineage, forms }`, `forms` étant null pour une espèce sans
// formes.
export const loadLineage = (speciesId) => api(`/api/me/lineage/${speciesId}`);

// `shiny` : la variante regardée. Une entrée de Pokédex est une espèce, shiny
// ou non : « je l'ai » veut dire qu'on en a un — sauf sur un shiny, où il veut
// dire « je l'ai en shiny », puisqu'un premier shiny se signale. Les deux
// compteurs restent affichés. `currentId` : le maillon consulté, mis en avant.
export function lineageView(ctx, lineage, { currentId = null, shiny = false, forms = null } = {}) {
  const stages = new Map();
  for (const link of lineage) {
    const species = ctx.species.get(link.speciesId);
    if (!species) continue;
    const list = stages.get(link.stage) ?? [];
    list.push({ ...link, species });
    stages.set(link.stage, list);
  }
  const kinds = new Set([...stages.values()].flat().map((link) => link.species.obtention));
  const columns = [...stages].sort((a, b) => a[0] - b[0]);

  return h(
    "section",
    { class: "lineage" },
    h(
      "div",
      { class: "lineage-stages" },
      columns.map(([, links], index) => [
        // Un chevron entre deux stades : la lignée se lit de gauche à droite.
        index ? h("span", { class: "lineage-arrow", "aria-hidden": "true" }, "›") : null,
        h(
          "div",
          { class: "lineage-stage" },
          links.map((link) => linkView(link, { current: link.speciesId === currentId, shiny }))
        ),
      ])
    ),
    ["evolution", "egg"]
      .filter((kind) => kinds.has(kind))
      .map((kind) =>
        h("p", { class: "lineage-legend muted small" }, richText(OBTENTION_LEGENDS[kind]))
      ),
    forms ? formsView(forms) : null
  );
}

// Les formes d'une espèce qui en a — les lettres de Zarbi —, comme la ligne
// « Formes » de la fiche Discord : celles qu'on possède, en couleur, les
// autres en silhouette.
function formsView(forms) {
  const owned = forms.filter((form) => form.owned).length;
  return h(
    "div",
    { class: "forms" },
    h("p", { class: "muted small" }, `Formes : ${fmt(owned)}/${fmt(forms.length)}`),
    h(
      "div",
      { class: "forms-grid" },
      forms.map((form) =>
        h("img", {
          class: `forms-icon${form.owned ? "" : " artwork-missing"}`,
          src: form.icon,
          alt: form.name,
          title: `${form.name}${form.owned ? "" : " (pas encore)"}`,
          loading: "lazy",
        })
      )
    )
  );
}

function linkView(link, { current, shiny }) {
  const { normal, shiny: shinies } = link.owned;
  const has = shiny ? shinies > 0 : normal + shinies > 0;
  const counts = [
    normal ? `×${fmt(normal)}` : null,
    shinies ? [icon("sparkle", { label: "Shiny" }), `×${fmt(shinies)}`] : null,
  ].filter(Boolean);
  return h(
    "div",
    {
      class: `lineage-link${has ? " has" : ""}${current ? " current" : ""}`,
      title: has ? "Dans ta boîte" : "Pas encore dans ta boîte",
    },
    h("img", {
      class: "sprite",
      src: shiny ? link.species.iconShiny : link.species.icon,
      alt: "",
      width: 64,
      height: 64,
      loading: "lazy",
    }),
    h(
      "span",
      { class: "lineage-name" },
      has ? icon("check", { label: "Possédé" }) : null,
      link.species.name,
      obtentionMark(link.species.obtention)
    ),
    h(
      "span",
      { class: "lineage-counts" },
      counts.length ? counts.flatMap((part, index) => (index ? [" · ", part] : [part])) : "—"
    )
  );
}
