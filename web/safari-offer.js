// Le bouton du parc safari : reprendre sa visite, entrer dans un parc ouvert,
// ou acheter une entrée après confirmation. Le serveur décide de ce qui est
// possible (GET /api/spawn ou /api/safari → `offer`) et tranche à l'achat ; le
// bouton ne fait que le montrer, grisé quand l'achat serait refusé.
import { icon } from "./icons.js";
import { api, dateTimeFr, fmt, h, richText, toast } from "./lib.js";

const BLOCKED = {
  balance: (offer) => `Il te faut ${fmt(offer.price)} pts pour une entrée.`,
  cooldown: (offer) => `Prochaine entrée achetable ${dateTimeFr(offer.retryAt)}.`,
};

// Les générations visées, gardées d'un dessin à l'autre et d'un onglet à
// l'autre : null les vise toutes.
let targeted = null;

// Les générations ouvertes que le dresseur vise encore : une génération
// retirée de l'offre ne reste pas cochée.
function chosenGenerations(offer) {
  const open = offer.generations.map((choice) => choice.generation);
  const kept = (targeted ?? []).filter((generation) => open.includes(generation));
  return kept.length ? kept : open;
}

// Une bascule par génération ouverte, dès qu'il y en a plus d'une. Il en reste
// toujours une de visée : la dernière ne se décoche pas, sans pour autant
// paraître grisée — elle est choisie, pas indisponible.
function generationToggles(offer, redraw) {
  if ((offer.generations?.length ?? 0) < 2) return null;
  const chosen = chosenGenerations(offer);
  return h(
    "div",
    { class: "safari-gens", role: "group", "aria-label": "Générations visées" },
    offer.generations.map(({ generation, ordinal, species }) => {
      const pressed = chosen.includes(generation);
      return h(
        "button",
        {
          type: "button",
          class: "button small",
          title: `${fmt(species)} espèces à croiser`,
          "aria-pressed": String(pressed),
          onclick: () => {
            if (pressed && chosen.length === 1) return;
            targeted = pressed
              ? chosen.filter((entry) => entry !== generation)
              : [...chosen, generation].sort((a, b) => a - b);
            redraw();
          },
        },
        `${ordinal} gén.`
      );
    })
  );
}

// `onEnter` reçoit la visite ouverte ; `redraw` redessine le bouton (pour la
// confirmation).
export function safariOffer(ctx, offer, { onEnter, redraw, confirming, setConfirming }) {
  if (!offer?.enabled) return null;

  // Le serveur revalide la liste : il ne garde que les générations ouvertes.
  const go = async (path, body = {}) => {
    if (offer.generations?.length > 1) body = { ...body, generations: chosenGenerations(offer) };
    try {
      const result = await api(path, { method: "POST", body });
      if (result.ticket) toast(`Tu présentes ton **${result.ticket}** à l'entrée.`, "success");
      await ctx.refreshMe().catch(() => {});
      onEnter(result.visit);
    } catch (error) {
      toast(error.message, "error");
      setConfirming(false);
      redraw();
    }
  };

  if (offer.session) {
    return h(
      "div",
      { class: "safari-offer" },
      icon("tent"),
      h(
        "span",
        { class: "safari-offer-text" },
        `Ta visite du parc safari t'attend : encore ${fmt(offer.session.actionsLeft)} actions.`
      ),
      h("button", { class: "button small primary", onclick: () => onEnter(null) }, "Reprendre")
    );
  }

  if (offer.freePark) {
    return h(
      "div",
      { class: "safari-offer" },
      icon("tent"),
      h(
        "span",
        { class: "safari-offer-text" },
        offer.freePark.reserved
          ? "Un parc safari t'est réservé : ton entrée est offerte."
          : "Un parc safari est ouvert : ton entrée est offerte.",
        h("span", { class: "muted" }, ` Il ferme ${dateTimeFr(offer.freePark.expiresAt)}.`)
      ),
      generationToggles(offer, redraw),
      h(
        "button",
        {
          class: "button small primary",
          onclick: () => go("/api/safari/enter", { parkId: offer.freePark.id }),
        },
        "Entrer"
      )
    );
  }

  // Acheter : une confirmation d'abord, comme pour la Master Ball.
  const ticket = offer.tickets > 0;
  if (confirming) {
    return h(
      "div",
      { class: "safari-offer" },
      icon("tent"),
      h(
        "span",
        { class: "safari-offer-text" },
        richText(
          ticket
            ? `Utiliser ton **Ticket Safari** pour une visite de **${fmt(offer.actions)}** actions ?`
            : `Payer **${fmt(offer.price)}** points pour une visite de **${fmt(offer.actions)}** actions ?`
        )
      ),
      generationToggles(offer, redraw),
      h(
        "button",
        { class: "button small primary", onclick: () => go("/api/safari/buy") },
        "Confirmer"
      ),
      h(
        "button",
        {
          class: "button small ghost",
          onclick: () => {
            setConfirming(false);
            redraw();
          },
        },
        "Annuler"
      )
    );
  }
  const reason = offer.canBuy ? null : BLOCKED[offer.blocked]?.(offer);
  return h(
    "div",
    { class: "safari-offer" },
    icon("tent"),
    h(
      "span",
      { class: "safari-offer-text" },
      "Aucun parc safari ouvert.",
      reason ? h("span", { class: "muted" }, ` ${reason}`) : null
    ),
    h(
      "button",
      {
        class: "button small",
        disabled: !offer.canBuy,
        title: reason,
        onclick: () => {
          setConfirming(true);
          redraw();
        },
      },
      ticket ? "Utiliser mon Ticket Safari" : `Acheter une entrée · ${fmt(offer.price)} pts`
    )
  );
}
