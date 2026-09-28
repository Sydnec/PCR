// La vitrine : les Pokémon qu'on expose aux autres, comme /pk vitrine. La page
// ne montre que la sienne — celles des autres se regardent dans Dresseurs — et
// la range : glisser un Pokémon sur un autre, ou « Déplacer » puis un clic sur
// sa nouvelle place, au doigt. On y expose un Pokémon depuis sa fiche dans la
// boîte (l'étoile). C'est l'API qui range : la page redessine la vitrine
// qu'elle lui renvoie.
import { icon } from "../icons.js";
import { api, dateFr, fmt, h, itemIcon, pokemonName, toast } from "../lib.js";

// Un Pokémon exposé : son image, son nom, sa ball et sa date d'arrivée. La
// page Dresseurs montre les vitrines avec le même rendu.
export function showcaseMon(ctx, mon) {
  const species = ctx.species.get(mon.speciesId);
  const ball = mon.ball ? ctx.balls.get(mon.ball) : null;
  return [
    h("img", {
      class: "showcase-sprite",
      src: mon.form?.sprite ?? (mon.shiny ? species?.spriteShiny : species?.sprite),
      alt: "",
      loading: "lazy",
    }),
    h(
      "strong",
      { class: "showcase-name" },
      pokemonName(species, mon.shiny, mon.sex, mon.nickname, mon.form)
    ),
    mon.nickname
      ? h(
          "span",
          { class: "muted small" },
          `${species?.name ?? "?"}${mon.form ? ` ${mon.form.name}` : ""}`
        )
      : null,
    h(
      "span",
      { class: "muted small" },
      ball ? [itemIcon(ball), " "] : null,
      dateFr(mon.obtainedAt)
    ),
  ];
}

// Une vitrine en lecture seule, ou la phrase qui dit qu'elle est vide.
export function showcaseGrid(ctx, pokemon, empty = "Rien d'exposé pour le moment.") {
  return pokemon.length
    ? h(
        "ol",
        { class: "showcase-grid" },
        pokemon.map((mon) => h("li", { class: "showcase-mon" }, ...showcaseMon(ctx, mon)))
      )
    : h("p", { class: "muted" }, empty);
}

export async function render(ctx) {
  let mine = await api("/api/users/me/showcase");
  let moving = null;
  let dragging = null;

  const own = h("section", { class: "showcase-section" });

  async function save(request) {
    try {
      mine = await request;
    } catch (error) {
      toast(error.message, "error");
      mine = await api("/api/users/me/showcase").catch(() => mine);
    }
    moving = null;
    drawOwn();
  }

  // Met `id` à la place de `targetId`, les autres se décalant.
  function moveTo(id, targetId) {
    const order = mine.pokemon.map((mon) => mon.id).filter((other) => other !== id);
    order.splice(order.indexOf(targetId) + (indexOf(id) < indexOf(targetId) ? 1 : 0), 0, id);
    save(api("/api/me/showcase/order", { method: "POST", body: { order } }));
  }
  const indexOf = (id) => mine.pokemon.findIndex((mon) => mon.id === id);

  function ownTile(mon) {
    const tile = h(
      "li",
      {
        class: `showcase-mon${moving === mon.id ? " showcase-moving" : ""}`,
        draggable: "true",
        ondragstart: (event) => {
          dragging = mon.id;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", `#${mon.id}`);
        },
        ondragend: () => {
          dragging = null;
        },
        ondragover: (event) => {
          if (dragging && dragging !== mon.id) event.preventDefault();
        },
        ondrop: (event) => {
          event.preventDefault();
          if (dragging && dragging !== mon.id) moveTo(dragging, mon.id);
        },
        onclick: () => {
          if (moving && moving !== mon.id) moveTo(moving, mon.id);
        },
      },
      ...showcaseMon(ctx, mon),
      h(
        "span",
        { class: "showcase-tools" },
        tool("move", moving === mon.id ? "Annuler le déplacement" : "Déplacer", (event) => {
          event.stopPropagation();
          moving = moving === mon.id ? null : mon.id;
          drawOwn();
        }),
        tool("cross", "Retirer de la vitrine", (event) => {
          event.stopPropagation();
          save(
            api("/api/me/showcase", { method: "POST", body: { pokemonId: mon.id, shown: false } })
          );
        })
      )
    );
    if (moving === mon.id) tile.setAttribute("aria-current", "true");
    return tile;
  }

  function tool(name, label, onclick) {
    return h(
      "button",
      { type: "button", class: "button icon-button", title: label, "aria-label": label, onclick },
      icon(name)
    );
  }

  function drawOwn() {
    const free = Math.max(0, mine.slots - mine.pokemon.length);
    own.replaceChildren(
      h("h2", {}, `Ta vitrine · ${fmt(mine.pokemon.length)}/${fmt(mine.slots)}`),
      h(
        "p",
        { class: "muted small" },
        moving
          ? "Touche la place où le mettre, ou « Annuler le déplacement »."
          : "Glisse un Pokémon sur un autre pour changer sa place (au doigt : « Déplacer »). " +
              "Expose-en un depuis sa fiche dans la boîte (l'étoile), ou avec /pk vitrine " +
              "ajouter. Pour la montrer dans un salon : /pk vitrine voir, puis « Montrer à tout " +
              "le monde »."
      ),
      h(
        "ol",
        { class: "showcase-grid" },
        mine.pokemon.map(ownTile),
        Array.from({ length: free }, () =>
          h("li", { class: "showcase-empty muted small" }, "Place libre")
        )
      )
    );
  }

  drawOwn();

  return h(
    "section",
    { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "Vitrine")),
    own
  );
}
