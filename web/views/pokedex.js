// Le Pokédex : toutes les espèces des générations ouvertes, celles qu'on
// possède en couleur, les autres en silhouette. Comme /pk pokedex, ne compte
// que ce qui est physiquement dans la boîte.
import { filterBar, speciesFilters } from "../filters.js";
import { icon } from "../icons.js";
import { lineageView, loadLineage } from "../lineage.js";
import {
  api,
  fmt,
  h,
  normalize,
  obtentionMark,
  openDialog,
  progressBar,
  sexMark,
  speciesChips,
} from "../lib.js";

// Comment on obtient une espèce qu'on ne croise pas dans la nature — les mêmes
// repères que sur Discord.
const OBTENTION = {
  wild: "Se capture à l'état sauvage.",
  evolution: "Ne s'obtient qu'en évoluant.",
  egg: "Ne sort que d'un œuf.",
};

export async function render(ctx) {
  const dex = await api("/api/users/me/pokedex");
  const panel = pokedexPanel(ctx, dex, { url: "/pokedex" });
  return h(
    "section",
    { class: "view" },
    h(
      "div",
      { class: "view-head" },
      h("h1", {}, "Pokédex"),
      h("p", { class: "muted" }, panel.summary)
    ),
    panel.nodes
  );
}

// Le Pokédex d'un dresseur (`dex` : la réponse de /api/users/:id/pokedex) : le
// décompte, la barre, les filtres et la grille. Le sien et celui d'un autre
// dresseur (page Dresseurs) se dessinent pareil ; seule la fiche d'une espèce,
// qui montre ce que *tu* en possèdes, ne s'ouvre que sur le sien. `url` : la page
// dont l'adresse garde les filtres (le sien) ; ailleurs, ils ne survivent pas à la page.
export function pokedexPanel(ctx, dex, { mine = true, url = null } = {}) {
  const owned = new Map();
  for (const entry of dex.entries) {
    const counts = owned.get(entry.speciesId) ?? { normal: 0, shiny: 0 };
    counts[entry.shiny ? "shiny" : "normal"] += entry.count;
    owned.set(entry.speciesId, counts);
  }
  const all = [...ctx.species.values()];
  const shinies = dex.entries.filter((entry) => entry.shiny).length;
  const percent = Math.floor((owned.size / dex.dexSize) * 100);

  const params = new URLSearchParams(url ? location.search : "");
  const VIEWS = ["all", "owned", "missing"];
  let show = VIEWS.includes(params.get("vue")) ? params.get("vue") : "all";
  const grid = h("div", { class: "grid" });
  const filters = filterBar({
    filters: [
      ...speciesFilters(ctx),
      {
        key: "shiny",
        all: "Shiny ou non",
        options: [
          ["oui", "Shiny possédé"],
          ["non", "Pas encore shiny"],
        ],
        test: ({ counts }, value) => (value === "oui") === Boolean(counts?.shiny),
      },
    ],
    // Le nom, ou le numéro tel quel (« 25 ») : chercher « 2 » ne doit pas sortir
    // tous les numéros qui en contiennent un.
    search: ({ species }, needle) =>
      normalize(species.name).includes(needle) || String(species.id) === needle,
    placeholder: "Chercher un Pokémon…",
    params,
    onchange: () => draw(),
  });

  function draw() {
    if (url) {
      const query = new URLSearchParams();
      if (show !== "all") query.set("vue", show);
      filters.write(query);
      const text = query.toString();
      history.replaceState(null, "", `${url}${text ? `?${text}` : ""}`);
    }
    const visible = all.filter((species) => {
      if (show === "owned" && !owned.has(species.id)) return false;
      if (show === "missing" && owned.has(species.id)) return false;
      return filters.matches({ species, counts: owned.get(species.id) });
    });
    grid.replaceChildren(
      ...(visible.length
        ? visible.map((species) => card(ctx, species, owned.get(species.id), mine))
        : [h("p", { class: "muted empty-grid" }, "Aucune espèce ne correspond.")])
    );
  }

  const tabs = h(
    "div",
    { class: "segmented", role: "tablist" },
    [
      ["all", "Toutes"],
      ["owned", "Possédées"],
      ["missing", "Manquantes"],
    ].map(([value, label]) =>
      h(
        "button",
        {
          class: value === show ? "active" : null,
          onclick: (event) => {
            show = value;
            for (const button of tabs.children)
              button.classList.toggle("active", button === event.currentTarget);
            draw();
          },
        },
        label
      )
    )
  );

  draw();
  return {
    summary: `${fmt(owned.size)} / ${fmt(dex.dexSize)} espèces (${percent} %) · ${fmt(shinies)} shiny`,
    nodes: [progressBar(percent), h("div", { class: "toolbar" }, tabs), filters.element, grid],
  };
}

function card(ctx, species, counts, mine = true) {
  const has = Boolean(counts);
  return h(
    mine ? "button" : "div",
    {
      class: `card${has ? "" : " card-missing"}`,
      onclick: mine ? () => openSpecies(ctx, species, counts) : null,
    },
    h("img", {
      class: "sprite",
      src: species.icon,
      alt: "",
      loading: "lazy",
      width: 96,
      height: 96,
    }),
    h("span", { class: "card-name" }, species.name),
    h(
      "span",
      { class: "card-meta" },
      h("span", { class: "card-id" }, `n° ${String(species.id).padStart(3, "0")}`),
      has ? h("span", { class: "tag" }, `×${counts.normal + counts.shiny}`) : null,
      counts?.shiny ? icon("sparkle", { label: "Shiny possédé" }) : null,
      has ? null : obtentionMark(species.obtention)
    )
  );
}

// « Tu as : ♂ ✓ · ♀ ? », comme la fiche Discord : le sexe qu'il reste à chercher.
function ownedSexesView(sexes) {
  return h(
    "span",
    { class: "muted small sexes-owned" },
    "Tu as : ",
    sexes.flatMap(({ sex, owned }, index) => [
      index ? " · " : null,
      sexMark(sex),
      " ",
      icon(owned ? "check" : "question", { label: owned ? "Possédé" : "Pas encore" }),
    ])
  );
}

function openSpecies(ctx, species, counts) {
  const gender = species.genderless
    ? "Asexué"
    : `♂ ${Math.round((1 - species.femaleShare) * 100)} % · ♀ ${Math.round(species.femaleShare * 100)} %`;

  // La lignée arrive après la fiche, avec ce qu'on possède de chaque maillon :
  // le même rendu que sur l'onglet Capture.
  const lineage = h("div", { class: "lineage-slot" });
  // Les sexes qu'on en a déjà arrivent avec la lignée, sous la répartition.
  const sexes = h("span");
  loadLineage(species.id)
    .then(({ lineage: links, forms, sexes: owned }) => {
      lineage.replaceWith(lineageView(ctx, links, { currentId: species.id, forms }));
      if (owned) sexes.replaceWith(ownedSexesView(owned));
    })
    .catch(() => lineage.remove());

  const dialog = openDialog(
    h(
      "div",
      { class: "dialog-head" },
      h("img", {
        class: `artwork${counts ? "" : " artwork-missing"}`,
        src: species.sprite,
        alt: "",
      }),
      h("h2", {}, species.name, obtentionMark(species.obtention)),
      h("p", { class: "muted" }, `n° ${String(species.id).padStart(3, "0")}`),
      speciesChips(ctx, species)
    ),
    h(
      "dl",
      { class: "facts" },
      h("dt", {}, "Obtention"),
      h("dd", {}, OBTENTION[species.obtention]),
      h("dt", {}, "Sexe"),
      h("dd", {}, gender, sexes),
      h("dt", {}, "Capture"),
      h("dd", {}, `Taux ${species.catchRate} / 255`),
      h("dt", {}, "Revente"),
      h(
        "dd",
        {},
        species.sellValue ? `${fmt(species.sellValue)} pts l'exemplaire` : "Ne se revend pas"
      )
    ),
    lineage,
    counts
      ? h(
          "a",
          {
            class: "button primary",
            href: `/boite?species=${species.id}`,
            "data-link": true,
            onclick: () => dialog.close(),
          },
          "Voir dans ma boîte"
        )
      : null
  );
}
