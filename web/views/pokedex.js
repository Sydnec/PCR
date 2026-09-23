// Le Pokédex : toutes les espèces des générations ouvertes, celles qu'on
// possède en couleur, les autres en silhouette. Comme /pk pokedex, ne compte
// que ce qui est physiquement dans la boîte.
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
  const owned = new Map();
  for (const entry of dex.entries) {
    const counts = owned.get(entry.speciesId) ?? { normal: 0, shiny: 0 };
    counts[entry.shiny ? "shiny" : "normal"] += entry.count;
    owned.set(entry.speciesId, counts);
  }
  const all = [...ctx.species.values()];
  const shinies = dex.entries.filter((entry) => entry.shiny).length;
  const percent = Math.floor((owned.size / dex.dexSize) * 100);

  let show = "all";
  let search = "";
  const grid = h("div", { class: "grid" });

  function draw() {
    const needle = normalize(search.trim());
    const visible = all.filter((species) => {
      if (show === "owned" && !owned.has(species.id)) return false;
      if (show === "missing" && owned.has(species.id)) return false;
      return !needle || normalize(species.name).includes(needle) || String(species.id) === needle;
    });
    grid.replaceChildren(
      ...(visible.length
        ? visible.map((species) => card(ctx, species, owned.get(species.id)))
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
  return h(
    "section",
    { class: "view" },
    h(
      "div",
      { class: "view-head" },
      h("h1", {}, "Pokédex"),
      h(
        "p",
        { class: "muted" },
        `${fmt(owned.size)} / ${fmt(dex.dexSize)} espèces (${percent} %) · ${fmt(shinies)} shiny`
      )
    ),
    progressBar(percent),
    h(
      "div",
      { class: "toolbar" },
      tabs,
      h("input", {
        type: "search",
        placeholder: "Chercher un Pokémon…",
        "aria-label": "Chercher un Pokémon",
        oninput: (event) => {
          search = event.target.value;
          draw();
        },
      })
    ),
    grid
  );
}

function card(ctx, species, counts) {
  const has = Boolean(counts);
  return h(
    "button",
    {
      class: `card${has ? "" : " card-missing"}`,
      onclick: () => openSpecies(ctx, species, counts),
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

function openSpecies(ctx, species, counts) {
  const gender = species.genderless
    ? "Asexué"
    : `♂ ${Math.round((1 - species.femaleShare) * 100)} % · ♀ ${Math.round(species.femaleShare * 100)} %`;

  // La lignée arrive après la fiche, avec ce qu'on possède de chaque maillon :
  // le même rendu que sur l'onglet Capture.
  const lineage = h("div", { class: "lineage-slot" });
  loadLineage(species.id)
    .then((links) => lineage.replaceWith(lineageView(ctx, links, { currentId: species.id })))
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
      h("dd", {}, gender),
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
