// Le Pokédex : toutes les espèces des générations ouvertes, celles qu'on
// possède en couleur, les autres en silhouette. Comme /pk pokedex, ne compte
// que ce qui est physiquement dans la boîte.
import { api, fmt, h, normalize, openDialog, progressBar } from "../lib.js";

// Comment on obtient une espèce qu'on ne croise pas dans la nature — les mêmes
// repères que sur Discord.
const OBTENTION = {
  wild: "Se capture à l'état sauvage.",
  evolution: "Ne s'obtient qu'en évoluant (🔒).",
  egg: "Ne sort que d'un œuf (🥚).",
};
const MARKS = { evolution: "🔒", egg: "🥚" };

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
      counts?.shiny ? h("span", { title: "Shiny possédé" }, "✨") : null,
      !has && MARKS[species.obtention] ? h("span", {}, MARKS[species.obtention]) : null
    )
  );
}

async function openSpecies(ctx, species, counts) {
  const chain = h("div", { class: "chain" });
  const gender = species.genderless
    ? "Asexué"
    : `♂ ${Math.round((1 - species.femaleShare) * 100)} % · ♀ ${Math.round(species.femaleShare * 100)} %`;
  const dialog = openDialog(
    h(
      "div",
      { class: "dialog-head" },
      h("img", {
        class: `artwork${counts ? "" : " artwork-missing"}`,
        src: species.sprite,
        alt: "",
      }),
      h("h2", {}, species.name),
      h(
        "p",
        { class: "muted" },
        `n° ${String(species.id).padStart(3, "0")} · ${species.types.join(" / ")}`
      )
    ),
    h(
      "dl",
      { class: "facts" },
      h("dt", {}, "Rareté"),
      h("dd", {}, species.rarityLabel),
      h("dt", {}, "Obtention"),
      h("dd", {}, OBTENTION[species.obtention]),
      h("dt", {}, "Sexe"),
      h("dd", {}, gender),
      h("dt", {}, "Taux de capture"),
      h("dd", {}, `${species.catchRate} / 255`),
      h("dt", {}, "Revente"),
      h(
        "dd",
        {},
        species.sellValue ? `${fmt(species.sellValue)} pts l'exemplaire` : "Ne se revend pas"
      ),
      h("dt", {}, "Dans ta boîte"),
      h("dd", {}, counts ? `${fmt(counts.normal)} normal · ${fmt(counts.shiny)} shiny` : "Aucun")
    ),
    chain,
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

  // La lignée vient de l'API, qui sait quelles évolutions sont ouvertes.
  try {
    const detail = await api(`/api/species/${species.id}`);
    if (detail.chain.length < 2) return;
    chain.replaceChildren(
      h("h3", {}, "Lignée"),
      h(
        "div",
        { class: "chain-row" },
        detail.chain
          .map((id) => ctx.species.get(id))
          .filter(Boolean)
          .map((link) =>
            h(
              "span",
              { class: `chain-link${link.id === species.id ? " current" : ""}` },
              h("img", { src: link.icon, alt: "", width: 64, height: 64 }),
              link.name
            )
          )
      )
    );
  } catch {
    // Sans lignée, la fiche reste lisible : on n'affiche rien plutôt qu'une
    // erreur pour un détail.
  }
}
