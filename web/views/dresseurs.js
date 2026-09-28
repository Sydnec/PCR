// Les dresseurs : tous ceux qui ont au moins un Pokémon, et le profil de
// chacun — son Pokédex, sa vitrine, sa boîte et son sac — à explorer sans
// quitter la page. Rien que de la lecture, que Discord montre aussi avec un
// membre (/pk pokedex, /pk vitrine voir, /pk boite, /pk inventaire). Le
// dresseur et l'onglet ouverts vivent dans l'adresse, pour qu'un lien les
// rouvre.
import { api, dateFr, fmt, h, itemIcon, normalize, pokemonName } from "../lib.js";
import { pokedexPanel } from "./pokedex.js";
import { itemsList } from "./sac.js";
import { showcaseGrid } from "./vitrine.js";

const TABS = [
  ["pokedex", "Pokédex"],
  ["vitrine", "Vitrine"],
  ["boite", "Boîte"],
  ["sac", "Sac"],
];

export async function render(ctx) {
  const params = new URLSearchParams(location.search);
  const { dexSize, trainers } = await api("/api/trainers");
  let selected = trainers.find((trainer) => trainer.id === params.get("user")) ?? null;
  let tab = TABS.some(([key]) => key === params.get("onglet")) ? params.get("onglet") : "pokedex";
  let search = "";
  // Un chargement lent ne doit pas écraser l'onglet ouvert entre-temps.
  let loading = 0;

  const list = h("div", { class: "trainer-list" });
  const profile = h("section", { class: "trainer-profile" });

  const avatar = (trainer, size) =>
    trainer.avatar
      ? h("img", { class: "avatar", src: trainer.avatar, alt: "", width: size, height: size })
      : null;

  function drawList() {
    const needle = normalize(search.trim());
    const visible = trainers.filter(
      (trainer) => !needle || normalize(trainer.name).includes(needle)
    );
    list.replaceChildren(
      ...(visible.length
        ? visible.map((trainer) =>
            h(
              "button",
              {
                type: "button",
                class: "button trainer",
                "aria-pressed": String(trainer.id === selected?.id),
                onclick: () => select(trainer),
              },
              avatar(trainer, 32),
              h(
                "span",
                { class: "trainer-text" },
                h("strong", {}, trainer.name),
                h(
                  "span",
                  { class: "muted small" },
                  `${fmt(trainer.species)}/${fmt(dexSize)} espèces · ${fmt(trainer.shinies)} shiny`
                )
              )
            )
          )
        : [h("p", { class: "muted" }, "Aucun dresseur ne correspond.")])
    );
  }

  function select(trainer) {
    selected = trainer;
    drawList();
    drawProfile();
    // Sur un écran étroit, le profil est sous la liste : on y descend.
    if (window.matchMedia("(max-width: 800px)").matches) {
      profile.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function drawProfile() {
    if (!selected) {
      profile.replaceChildren(
        h("p", { class: "muted" }, "Choisis un dresseur pour explorer son profil.")
      );
      return;
    }
    const trainer = selected;
    const url = new URL(location.href);
    url.searchParams.set("user", trainer.id);
    url.searchParams.set("onglet", tab);
    history.replaceState(null, "", url);

    const body = h("div", { class: "trainer-body" }, h("p", { class: "muted" }, "Chargement…"));
    profile.replaceChildren(
      h(
        "div",
        { class: "trainer-head" },
        avatar(trainer, 56),
        h(
          "div",
          {},
          h("h2", {}, trainer.name),
          h(
            "p",
            { class: "muted" },
            `${fmt(trainer.species)}/${fmt(dexSize)} espèces · ${fmt(trainer.shinies)} shiny · ` +
              `${fmt(trainer.total)} Pokémon · vitrine ${fmt(trainer.showcase)}`
          )
        )
      ),
      h(
        "div",
        { class: "segmented", role: "tablist" },
        TABS.map(([key, label]) =>
          h(
            "button",
            {
              class: key === tab ? "active" : null,
              role: "tab",
              "aria-selected": String(key === tab),
              onclick: () => {
                tab = key;
                drawProfile();
              },
            },
            label
          )
        )
      ),
      body
    );

    const id = ++loading;
    try {
      const content = await loadTab(trainer, tab);
      if (id === loading) body.replaceChildren(...[content].flat());
    } catch (error) {
      if (id === loading) body.replaceChildren(h("p", { class: "notice error" }, error.message));
    }
  }

  async function loadTab(trainer, key) {
    if (key === "pokedex") {
      const dex = await api(`/api/users/${trainer.id}/pokedex`);
      // La fiche d'une espèce dit ce que *tu* en possèdes : elle ne s'ouvre
      // que sur son propre profil.
      const panel = pokedexPanel(ctx, dex, { mine: trainer.id === ctx.me.user.id });
      return [h("p", { class: "muted" }, panel.summary), ...panel.nodes];
    }
    if (key === "vitrine") {
      const showcase = await api(`/api/users/${trainer.id}/showcase`);
      return showcaseGrid(ctx, showcase.pokemon);
    }
    if (key === "sac") {
      const { items } = await api(`/api/users/${trainer.id}/inventory`);
      return itemsList(items, "Son sac est vide.");
    }
    return boxView(trainer, 0);
  }

  // Sa boîte, les plus récents d'abord, page par page.
  async function boxView(trainer, page) {
    const box = await api(`/api/users/${trainer.id}/box?page=${page}`);
    const container = h("div", {});
    const turn = async (next) => {
      container.replaceChildren(h("p", { class: "muted" }, "Chargement…"));
      container.replaceWith(await boxView(trainer, next));
    };
    // replaceChildren écrirait « null » en toutes lettres : h() filtre les
    // absents, lui non.
    container.replaceChildren(
      ...[
        h("p", { class: "muted" }, `${fmt(box.total)} Pokémon, les plus récents d'abord.`),
        h(
          "ol",
          { class: "trainer-box" },
          box.items.map((mon) => {
            const species = ctx.species.get(mon.speciesId);
            const ball = mon.ball ? ctx.balls.get(mon.ball) : null;
            return h(
              "li",
              { class: "trainer-mon", title: `#${mon.id} · ${dateFr(mon.obtainedAt)}` },
              h("img", {
                src: mon.form?.icon ?? (mon.shiny ? species?.iconShiny : species?.icon),
                alt: "",
                loading: "lazy",
                width: 64,
                height: 64,
              }),
              h(
                "span",
                { class: "small" },
                pokemonName(species, mon.shiny, mon.sex, mon.nickname, mon.form)
              ),
              h("span", { class: "muted small" }, ball ? [itemIcon(ball), " "] : null, `#${mon.id}`)
            );
          })
        ),
        box.pages > 1
          ? h(
              "div",
              { class: "pager" },
              h(
                "button",
                {
                  type: "button",
                  class: "button",
                  disabled: box.page === 0,
                  onclick: () => turn(box.page - 1),
                },
                "Précédents"
              ),
              h("span", { class: "muted small" }, `Page ${fmt(box.page + 1)}/${fmt(box.pages)}`),
              h(
                "button",
                {
                  type: "button",
                  class: "button",
                  disabled: box.page >= box.pages - 1,
                  onclick: () => turn(box.page + 1),
                },
                "Suivants"
              )
            )
          : null,
      ].filter(Boolean)
    );
    return container;
  }

  drawList();
  drawProfile();

  return h(
    "section",
    { class: "view" },
    h(
      "div",
      { class: "view-head" },
      h("h1", {}, "Dresseurs"),
      h(
        "p",
        { class: "muted" },
        `${fmt(trainers.length)} dresseurs, du plus grand Pokédex au plus petit`
      )
    ),
    h(
      "div",
      { class: "trainers-layout" },
      h(
        "div",
        { class: "trainer-column" },
        h("input", {
          type: "search",
          placeholder: "Chercher un dresseur…",
          "aria-label": "Chercher un dresseur",
          oninput: (event) => {
            search = event.target.value;
            drawList();
          },
        }),
        list
      ),
      profile
    )
  );
}
