// La vitrine : les Pokémon que chacun expose aux autres, comme /pk vitrine. La
// sienne se range ici — glisser un Pokémon sur un autre, ou « Déplacer » puis
// un clic sur sa nouvelle place, au doigt — et celles des autres se regardent.
// On y expose un Pokémon depuis sa fiche dans la boîte (l'étoile). C'est l'API
// qui range : la page redessine la vitrine qu'elle lui renvoie.
import { icon } from "../icons.js";
import { api, dateFr, fmt, h, itemIcon, pokemonName, toast } from "../lib.js";

// « de Sacha », « d'Ondine ».
const ofName = (name) => (/^[aeiouyàâäéèêëîïôöûüù]/i.test(name) ? `d'${name}` : `de ${name}`);

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
  const params = new URLSearchParams(location.search);
  let viewing = /^\d{5,25}$/.test(params.get("user") ?? "") ? params.get("user") : null;
  let [mine, list] = await Promise.all([api("/api/users/me/showcase"), api("/api/showcases")]);
  let moving = null;
  let dragging = null;

  const own = h("section", { class: "showcase-section" });
  const others = h("section", { class: "showcase-section" });
  const viewer = h("section", { class: "showcase-section", hidden: true });

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
          : "Expose un Pokémon depuis sa fiche dans la boîte (l'étoile), ou avec /pk vitrine " +
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

  async function show(userId) {
    viewing = userId;
    const url = new URL(location.href);
    url.searchParams.set("user", userId);
    history.replaceState(null, "", url);
    drawOthers();
    viewer.hidden = false;
    viewer.replaceChildren(h("p", { class: "muted" }, "Chargement…"));
    try {
      const showcase = await api(`/api/users/${userId}/showcase`);
      if (viewing !== userId) return;
      viewer.replaceChildren(
        h("h2", {}, `Vitrine ${ofName(showcase.trainer.name ?? "?")}`),
        showcaseGrid(ctx, showcase.pokemon)
      );
    } catch (error) {
      viewer.replaceChildren(h("p", { class: "notice error" }, error.message));
    }
  }

  function drawOthers() {
    const trainers = list.trainers.filter((trainer) => trainer.id !== ctx.me.user.id);
    others.replaceChildren(
      h("h2", {}, "Les vitrines des dresseurs"),
      trainers.length
        ? h(
            "div",
            { class: "showcase-trainers" },
            trainers.map((trainer) =>
              h(
                "button",
                {
                  type: "button",
                  class: "button",
                  "aria-pressed": String(trainer.id === viewing),
                  onclick: () => show(trainer.id),
                },
                trainer.avatar
                  ? h("img", {
                      class: "avatar",
                      src: trainer.avatar,
                      alt: "",
                      width: 24,
                      height: 24,
                    })
                  : null,
                ` ${trainer.name} · ${fmt(trainer.count)}/${fmt(list.slots)}`
              )
            )
          )
        : h("p", { class: "muted" }, "Personne d'autre n'expose encore de Pokémon.")
    );
  }

  drawOwn();
  drawOthers();
  if (viewing && viewing !== ctx.me.user.id) show(viewing);

  return h(
    "section",
    { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "Vitrine")),
    own,
    others,
    viewer
  );
}
