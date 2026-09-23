// La boîte : chaque Pokémon un par un, avec son numéro. Cliquer sur l'un ouvre
// sa fiche, d'où il se revend ou évolue — comme /pk revendre et /pk evolution
// avec un `#id`.
import { icon } from "../icons.js";
import { lineageView, loadLineage } from "../lineage.js";
import {
  api,
  confirmButton,
  dateFr,
  fmt,
  h,
  itemIcon,
  openDialog,
  pokemonName,
  richText,
  speciesChips,
  toast,
} from "../lib.js";

const PAGE_SIZE = 30;

const ORIGINS = {
  capture: "Capturé",
  safari: "Capturé au parc safari",
  echange: "Reçu en échange",
  oeuf: "Éclos d'un œuf",
  evolution: "Né d'une fusion",
  migration: "Arrivé avant le suivi des balls",
};

// Les filtres vivent dans l'adresse : un rechargement ou un lien les garde, et
// le Pokédex peut ouvrir la boîte sur une espèce (/boite?species=25).
const FILTERS = ["species", "sex", "fertile", "shiny", "page"];

function readFilters() {
  const params = new URLSearchParams(location.search);
  return Object.fromEntries(FILTERS.map((key) => [key, params.get(key) ?? ""]));
}

function writeFilters(filters) {
  const params = new URLSearchParams();
  for (const key of FILTERS)
    if (filters[key] && filters[key] !== "0") params.set(key, filters[key]);
  const query = params.toString();
  history.replaceState(null, "", `/boite${query ? `?${query}` : ""}`);
}

export async function render(ctx) {
  const filters = readFilters();
  const dex = await api("/api/users/me/pokedex");
  const ownedSpecies = [...new Set(dex.entries.map((entry) => entry.speciesId))]
    .map((id) => ctx.species.get(id))
    .filter(Boolean)
    .sort((a, b) => a.id - b.id);

  const title = h("h1", {}, "Ma boîte");
  const summary = h("p", { class: "muted" });
  const grid = h("div", { class: "grid" });
  const pager = h("div", { class: "pager" });

  const select = (key, options) =>
    h(
      "select",
      {
        onchange: (event) => {
          filters[key] = event.target.value;
          filters.page = "";
          load();
        },
      },
      options.map(([value, label]) =>
        h("option", { value, selected: filters[key] === value }, label)
      )
    );

  const toolbar = h(
    "div",
    { class: "toolbar" },
    select("species", [
      ["", "Toutes les espèces"],
      ...ownedSpecies.map((species) => [
        String(species.id),
        `${String(species.id).padStart(3, "0")} · ${species.name}`,
      ]),
    ]),
    select("sex", [
      ["", "Tous les sexes"],
      ["M", "Mâles ♂"],
      ["F", "Femelles ♀"],
      ["none", "Asexués"],
    ]),
    select("fertile", [
      ["", "Fertiles et stériles"],
      ["true", "Fertiles"],
      ["false", "Stériles"],
    ]),
    select("shiny", [
      ["", "Shiny ou non"],
      ["true", "Shiny ✨"],
      ["false", "Normaux"],
    ])
  );

  async function load() {
    writeFilters(filters);
    const params = new URLSearchParams({ pageSize: PAGE_SIZE, page: filters.page || 0 });
    for (const key of ["species", "sex", "fertile", "shiny"])
      if (filters[key]) params.set(key, filters[key]);
    let box;
    try {
      box = await api(`/api/users/me/box?${params}`);
    } catch (error) {
      toast(error.message, "error");
      return;
    }
    summary.textContent = `${fmt(box.total)} Pokémon`;
    grid.replaceChildren(
      ...(box.items.length
        ? box.items.map((item) => card(ctx, item, load))
        : [h("p", { class: "muted empty-grid" }, "Aucun Pokémon ne correspond à ces filtres.")])
    );
    pager.replaceChildren(
      h(
        "button",
        {
          class: "button ghost",
          disabled: box.page <= 0,
          onclick: () => {
            filters.page = String(box.page - 1);
            load();
          },
        },
        "← Précédente"
      ),
      h("span", { class: "muted" }, `Page ${box.page + 1} / ${box.pages}`),
      h(
        "button",
        {
          class: "button ghost",
          disabled: box.page >= box.pages - 1,
          onclick: () => {
            filters.page = String(box.page + 1);
            load();
          },
        },
        "Suivante →"
      )
    );
  }

  await load();
  return h(
    "section",
    { class: "view" },
    h("div", { class: "view-head" }, title, summary),
    toolbar,
    grid,
    pager
  );
}

function ballOf(ctx, item) {
  const ball = item.ball ? ctx.balls.get(item.ball) : null;
  return ball ? itemIcon(ball) : null;
}

function card(ctx, item, reload) {
  const species = ctx.species.get(item.speciesId);
  return h(
    "button",
    {
      class: `card${item.shiny ? " card-shiny" : ""}`,
      onclick: () => openPokemon(ctx, item, reload),
    },
    h("img", {
      class: "sprite",
      src: item.shiny ? species?.iconShiny : species?.icon,
      alt: "",
      loading: "lazy",
      width: 96,
      height: 96,
    }),
    h("span", { class: "card-name" }, pokemonName(species, item.shiny, item.sex)),
    h(
      "span",
      { class: "card-meta" },
      h("span", { class: "card-id" }, `#${item.id}`),
      ballOf(ctx, item),
      item.last ? icon("pin", { label: "Ton dernier : il reste dans la boîte" }) : null,
      item.fertile ? null : h("span", { class: "tag" }, "stérile")
    )
  );
}

function openPokemon(ctx, item, reload) {
  const species = ctx.species.get(item.speciesId);
  if (!species) return;
  const ball = item.ball ? ctx.balls.get(item.ball) : null;
  const done = async () => {
    dialog.close();
    await Promise.all([ctx.refreshMe(), reload()]);
  };

  const value = item.shiny ? species.sellValueShiny : species.sellValue;
  const facts = h(
    "dl",
    { class: "facts" },
    h("dt", {}, "Provenance"),
    h(
      "dd",
      {},
      ball ? [itemIcon(ball), " ", ball.label, " · "] : null,
      ORIGINS[item.origin] ?? item.origin
    ),
    h("dt", {}, "Arrivé le"),
    h("dd", {}, dateFr(item.obtainedAt)),
    h("dt", {}, "Fertilité"),
    h("dd", {}, item.fertile ? "Fertile" : "Stérile (a déjà pondu)"),
    h("dt", {}, "Capture"),
    h("dd", {}, `Taux ${species.catchRate} / 255`),
    h("dt", {}, "Revente"),
    h("dd", {}, value ? `${fmt(value)} pts` : "Ne se revend pas")
  );

  // La lignée arrive après la fiche : elle demande une lecture de plus, et la
  // fiche est lisible sans elle.
  const lineage = h("div", { class: "lineage-slot" });
  loadLineage(species.id)
    .then((links) =>
      lineage.replaceWith(lineageView(ctx, links, { currentId: species.id, shiny: item.shiny }))
    )
    .catch(() => lineage.remove());

  const dialog = openDialog(
    h(
      "div",
      { class: "dialog-head" },
      h("img", {
        class: "artwork",
        src: item.shiny ? species.spriteShiny : species.sprite,
        alt: "",
      }),
      h("h2", {}, pokemonName(species, item.shiny, item.sex)),
      h("p", { class: "muted" }, `#${item.id} · n° ${String(species.id).padStart(3, "0")}`),
      speciesChips(ctx, species)
    ),
    facts,
    lineage,
    item.last
      ? h(
          "p",
          { class: "notice" },
          icon("pin"),
          ` C'est ton dernier ${species.name}${item.shiny ? " shiny" : ""} : il garde ton entrée du Pokédex, donc il ne peut ni partir ni évoluer.`
        )
      : h(
          "div",
          { class: "actions" },
          sellAction(item, species, done),
          evolveAction(ctx, item, species, done)
        )
  );
}

function sellAction(item, species, done) {
  const value = item.shiny ? species.sellValueShiny : species.sellValue;
  if (!value)
    return h(
      "p",
      { class: "muted small" },
      `${species.name}${item.shiny ? " shiny" : ""} ne se revend pas.`
    );
  return h(
    "div",
    { class: "action" },
    h("h3", {}, "Revendre"),
    confirmButton(
      `Revendre · ${fmt(value)} pts`,
      `Confirmer la revente · ${fmt(value)} pts`,
      async () => {
        try {
          const result = await api("/api/me/sell", {
            method: "POST",
            body: { pokemonId: item.id },
          });
          toast(`#${item.id} revendu pour ${fmt(result.points)} pts.`, "success");
          await done();
        } catch (error) {
          toast(error.message, "error");
        }
      }
    )
  );
}

function evolveAction(ctx, item, species, done) {
  const targets = species.evolvesInto.map((id) => ctx.species.get(id)).filter(Boolean);
  if (!targets.length) return null;
  let targetId = null;
  const cost = h("p", { class: "muted small" }, "Calcul du coût…");
  const button = h("button", { class: "button primary", disabled: true }, "Évoluer");

  // Le coût vient de l'API, qui le calcule comme la commande : une forme
  // choisie sur une lignée à embranchement coûte plus cher que le hasard.
  async function refresh() {
    button.disabled = true;
    try {
      const plan = await api(
        `/api/species/${species.id}/evolution${targetId ? `?targetId=${targetId}` : ""}`
      );
      const into = plan.target ? ctx.species.get(plan.target)?.name : "une forme tirée au hasard";
      const others = plan.duplicates - 1;
      cost.textContent =
        `Devient ${into}. Il faut ${plan.required} ${species.name}${item.shiny ? " shiny" : ""} : ` +
        `celui-ci évolue, ${others > 0 ? `${others} autre${others > 1 ? "s partent" : " part"}, ` : ""}` +
        `et un reste. Coût : ${fmt(plan.points)} pts.`;
      button.disabled = false;
    } catch (error) {
      cost.replaceChildren(...richText(error.message));
    }
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const body = { pokemonId: item.id, ...(targetId ? { targetId } : {}) };
      const result = await api("/api/me/evolve", { method: "POST", body });
      toast(
        `#${item.id} a évolué en ${ctx.species.get(result.pokemon.speciesId)?.name ?? "?"} !`,
        "success"
      );
      await done();
    } catch (error) {
      toast(error.message, "error");
      button.disabled = false;
    }
  });

  const choice =
    targets.length > 1
      ? h(
          "select",
          {
            onchange: (event) => {
              targetId = event.target.value ? Number(event.target.value) : null;
              refresh();
            },
          },
          h("option", { value: "" }, "Forme au hasard"),
          targets.map((target) => h("option", { value: target.id }, `Choisir ${target.name}`))
        )
      : null;

  refresh();
  return h("div", { class: "action" }, h("h3", {}, "Faire évoluer"), choice, cost, button);
}
