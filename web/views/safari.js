// Le parc safari : la visite du dresseur, la même que l'éphémère Discord. Chaque
// action part par le même chemin que ses boutons (playAction), avec le même
// jeton anti-double-clic : le nombre d'actions restantes. Une visite commencée
// ici se reprend sur Discord avec /pk safari, et inversement.
//
// Sans visite en cours, la page propose ce que propose l'onglet Capture :
// entrer dans un parc ouvert ou acheter une entrée.
import { icon } from "../icons.js";
import {
  api,
  colorChip,
  dateTimeFr,
  dexNumber,
  fmt,
  h,
  itemIcon,
  outcomePanel,
  ownedMark,
  percent,
  pokemonName,
  progressBar,
  toast,
} from "../lib.js";
import { safariOffer } from "../safari-offer.js";

// L'icône qui ouvre la réponse d'une action, à la place de l'emoji du message.
const PANEL_ICONS = {
  CATCH: "star",
  MISS: "cross",
  MISS_FLED: "wind",
  BAIT: "berry",
  BAIT_FLED: "wind",
  FLED: "wind",
  FLEE_FAILED: "cross",
};

export async function render(ctx) {
  let { offer, visit } = await api("/api/safari");
  let panel = null;
  let acting = false;
  let buying = false;

  const body = h("div", { class: "safari" });
  const draw = () => body.replaceChildren(visit ? visitView() : offerView());

  async function reload() {
    try {
      ({ offer, visit } = await api("/api/safari"));
    } catch (error) {
      toast(error.message, "error");
    }
    draw();
  }

  // `next` : la visite rendue par l'entrée ; null pour une reprise, relue ici.
  function enter(next) {
    panel = null;
    buying = false;
    if (!next) return reload();
    visit = next;
    draw();
  }

  async function act(action) {
    acting = true;
    draw();
    try {
      const result = await api("/api/safari/action", {
        method: "POST",
        body: { sessionId: visit.id, token: visit.token, action },
      });
      panel = { text: result.message, outcome: result.outcome };
      visit = result.visit;
      acting = false;
      draw();
    } catch (error) {
      // Refusée (visite expirée, action déjà jouée depuis Discord) : on relit la
      // visite telle que la base la voit.
      acting = false;
      toast(error.message, "error");
      await reload();
    }
  }

  // ---------------------- Sans visite ----------------------

  function offerView() {
    const button = safariOffer(ctx, offer, {
      onEnter: enter,
      redraw: draw,
      confirming: buying,
      setConfirming: (value) => {
        buying = value;
      },
    });
    return h(
      "div",
      { class: "safari-intro" },
      h("h1", {}, "Parc safari"),
      button
        ? [
            h(
              "p",
              { class: "muted" },
              `${fmt(offer.actions)} actions pour lancer des Safari Balls, appâter ou fuir, `,
              "face à des Pokémon plus rares qu'à l'ordinaire. Tes prises rejoignent ta boîte."
            ),
            button,
          ]
        : h("p", { class: "muted" }, "Le parc safari est fermé pour le moment.")
    );
  }

  // ---------------------- La visite ----------------------

  function visitView() {
    return h(
      "div",
      { class: "capture-layout safari-visit" },
      visit.encounter ? encounterView(visit.encounter) : recapView(),
      h("aside", { class: "capture-aside" }, progressSection(), catchesSection())
    );
  }

  function encounterView(encounter) {
    const species = ctx.species.get(encounter.speciesId);
    if (!species) return h("p", { class: "notice" }, "Un Pokémon inconnu vous observe…");
    const view = h(
      "div",
      { class: `spawn${encounter.shiny ? " spawn-shiny" : ""}` },
      h(
        "div",
        { class: "chips" },
        colorChip(encounter.rarityLabel, { className: `rarity-${encounter.rarity}` }),
        species.types.map((type) => colorChip(type, { color: ctx.types[type] }))
      ),
      h("img", {
        class: "spawn-art",
        src: encounter.shiny ? species.spriteShiny : species.sprite,
        alt: species.name,
      }),
      h(
        "h2",
        { class: "spawn-title" },
        encounter.shiny ? [icon("sparkle", { label: "Shiny" }), " "] : null,
        "Un ",
        pokemonName(species, false, encounter.sex),
        encounter.shiny ? " shiny vous observe !" : " sauvage vous observe…"
      ),
      h(
        "p",
        { class: "spawn-meta muted" },
        dexNumber(species),
        // Collection illisible : la rencontre s'affiche sans la pastille.
        encounter.owned ? [" · ", ownedMark(encounter.owned, encounter.shiny)] : null
      ),
      actions(encounter),
      panel ? actionPanel() : null
    );
    const glow = ctx.types[species.types[0]];
    if (glow) view.style.setProperty("--glow", glow);
    return view;
  }

  // Les trois boutons de l'éphémère Discord, avec ce qu'on gagne à chacun : les
  // chances de la ball, l'effet de l'appât, le risque qu'il détale.
  function actions(encounter) {
    const bait = encounter.bait ? ` · appât ×${fmt(encounter.baitFactor)}` : "";
    const button = (action, content, meta, { disabled = false, title = null } = {}) =>
      h(
        "button",
        { class: "ball", disabled: acting || disabled, title, onclick: () => act(action) },
        h("span", { class: "ball-icon" }, content),
        h(
          "span",
          { class: "ball-text" },
          h("span", { class: "ball-label" }, meta[0]),
          h("span", { class: "ball-meta" }, meta[1])
        )
      );
    return h(
      "div",
      { class: "balls safari-actions" },
      button("BALL", itemIcon(visit.ball), [
        visit.ball.label,
        `${percent(encounter.probability)}${bait}`,
      ]),
      // Au plafond, un appât de plus ne change rien : le bouton se ferme, comme
      // sur Discord, plutôt que de brûler une action.
      button(
        "BAIT",
        icon("berry"),
        ["Appâter", encounter.baitCapped ? "il n'a plus faim" : "chances en hausse"],
        {
          disabled: encounter.baitCapped,
          title: encounter.baitCapped ? "Un appât de plus ne changerait rien." : null,
        }
      ),
      button("FLEE", icon("wind"), [
        "Fuir",
        `${Math.round(encounter.fleeRisk * 100)} % qu'il détale`,
      ])
    );
  }

  const actionPanel = () =>
    outcomePanel(
      panel.text,
      PANEL_ICONS[panel.outcome],
      panel.outcome === "CATCH" ? "throw-catch" : "throw-miss"
    );

  function recapView() {
    const count = visit.catches.length;
    return h(
      "div",
      { class: "spawn-empty safari-recap" },
      panel ? actionPanel() : null,
      h("h2", {}, "Fin de la visite"),
      h(
        "p",
        {},
        count
          ? `Tu ressors du parc avec ${fmt(count)} Pokémon, déjà rangés dans ta boîte.`
          : "Tu ressors du parc les mains vides. Ça arrive."
      ),
      h(
        "div",
        { class: "confirm-actions" },
        h(
          "a",
          { class: "button primary", href: "/capture", "data-link": true },
          "Retour à la capture"
        ),
        count
          ? h("a", { class: "button ghost", href: "/boite", "data-link": true }, "Voir ma boîte")
          : null
      )
    );
  }

  // ---------------------- Sur le côté ----------------------

  function progressSection() {
    return h(
      "section",
      { class: "side-section" },
      h(
        "h3",
        {},
        "Parc safari ",
        h(
          "span",
          { class: "muted" },
          `${fmt(visit.actionsLeft)} / ${fmt(visit.actionsTotal)} actions`
        )
      ),
      progressBar((visit.actionsLeft / visit.actionsTotal) * 100),
      visit.finished
        ? null
        : h(
            "p",
            { class: "muted small" },
            `Visite ouverte jusqu'au ${dateTimeFr(visit.expiresAt)}.`
          )
    );
  }

  function catchesSection() {
    return h(
      "section",
      { class: "side-section" },
      h("h3", {}, "Tes prises ", h("span", { class: "muted" }, fmt(visit.catches.length))),
      visit.catches.length
        ? h(
            "div",
            { class: "safari-catches" },
            visit.catches.map((row) => {
              const species = ctx.species.get(row.speciesId);
              return species
                ? h("img", {
                    class: "sprite",
                    src: row.shiny ? species.iconShiny : species.icon,
                    alt: species.name,
                    title: `${species.name}${row.shiny ? " shiny" : ""}`,
                    width: 56,
                    height: 56,
                  })
                : null;
            })
          )
        : h("p", { class: "muted small" }, "Rien pour l'instant.")
    );
  }

  draw();
  return h("section", { class: "view" }, body);
}
