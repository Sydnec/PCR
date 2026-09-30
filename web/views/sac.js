// Le sac : le solde et les objets, comme /pk inventaire. Un objet qui se revend
// porte son prix et un bouton, comme /pk revendre objet.
import { api, fmt, h, itemIcon, toast } from "../lib.js";

export async function render(ctx) {
  const balance = h("strong", {});
  const list = h("div");
  let items = [];
  // Un seul panneau de revente ouvert à la fois : la clé de l'objet concerné.
  let selling = null;

  function paint() {
    balance.textContent = `${fmt(ctx.me.balance)} pts`;
    list.replaceChildren(
      items.length
        ? h("ul", { class: "items" }, items.map(row))
        : h(
            "p",
            { class: "muted" },
            "Ton sac est vide. Les objets se trouvent sur les Pokémon capturés et à la loterie (/pk loterie)."
          )
    );
  }

  // Le solde suit : la revente crédite des points, et l'en-tête les montre.
  async function reload() {
    const [fresh] = await Promise.all([
      api("/api/users/me/inventory"),
      ctx.refreshMe().catch(() => {}),
    ]);
    items = fresh.items;
    // Tout l'objet a pu partir : son panneau n'a plus de raison de rester ouvert.
    if (selling && !items.some((item) => item.key === selling)) selling = null;
    paint();
  }

  function row(item) {
    const open = selling === item.key;
    return h(
      "li",
      { class: "item" },
      h("span", { class: "item-icon" }, itemIcon(item)),
      h(
        "span",
        { class: "item-text" },
        h("strong", {}, item.label),
        item.description ? h("span", { class: "muted small" }, item.description) : null,
        item.sellValue
          ? h("span", { class: "muted small" }, `Se revend ${fmt(item.sellValue)} pts l'unité`)
          : null
      ),
      h("span", { class: "item-count" }, `×${fmt(item.count)}`),
      // Une colonne réservée au bouton, même sans bouton : les quantités restent
      // alignées d'un objet à l'autre.
      h(
        "span",
        { class: "item-action" },
        item.sellValue
          ? h(
              "button",
              {
                type: "button",
                class: "button small",
                "aria-expanded": String(open),
                onclick: () => {
                  selling = open ? null : item.key;
                  paint();
                },
              },
              "Revendre"
            )
          : null
      ),
      open ? sellPanel(item) : null
    );
  }

  // La quantité se choisit : un objet qui s'empile (les Super Bonbons servent aux
  // évolutions) ne doit pas partir d'un seul clic. Le total est celui que le
  // serveur créditera, prix à l'unité × quantité.
  function sellPanel(item) {
    const quantity = h("input", {
      type: "number",
      min: 1,
      max: item.count,
      step: 1,
      value: 1,
      "aria-label": "Quantité à revendre",
    });
    const ok = h("button", { type: "button", class: "button danger small" });

    const amount = () => {
      const value = Number(quantity.value);
      return Number.isInteger(value) && value >= 1 && value <= item.count ? value : null;
    };
    const sync = () => {
      const value = amount();
      ok.disabled = !value;
      ok.textContent = value
        ? `Revendre pour ${fmt(value * item.sellValue)} pts`
        : "Quantité invalide";
    };
    quantity.addEventListener("input", sync);
    sync();

    ok.addEventListener("click", async () => {
      const value = amount();
      if (!value) return;
      ok.disabled = true;
      try {
        const result = await api("/api/me/sell-item", {
          method: "POST",
          body: { key: item.key, quantity: value },
        });
        toast(
          `${fmt(result.sold)}× ${item.label} revendu${result.sold > 1 ? "s" : ""} ` +
            `pour ${fmt(result.points)} pts.`,
          "success"
        );
        selling = null;
        await reload();
      } catch (error) {
        toast(error.message, "error");
        sync();
      }
    });

    return h(
      "div",
      { class: "confirm item-sell" },
      h(
        "label",
        {},
        "Quantité ",
        quantity,
        h("span", { class: "muted" }, ` sur ${fmt(item.count)}`)
      ),
      h(
        "div",
        { class: "confirm-actions" },
        ok,
        h(
          "button",
          {
            type: "button",
            class: "button small",
            onclick: () => {
              selling = null;
              paint();
            },
          },
          "Annuler"
        )
      )
    );
  }

  items = (await api("/api/users/me/inventory")).items;
  paint();

  return h(
    "section",
    { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "Sac")),
    h("div", { class: "balance" }, h("span", { class: "muted" }, "Solde"), balance),
    list
  );
}
