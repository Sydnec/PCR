// Le sac : le solde et les objets, comme /pk inventaire.
import { api, emoji, fmt, h } from "../lib.js";

export async function render(ctx) {
  const { items } = await api("/api/users/me/inventory");
  return h(
    "section",
    { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "Sac")),
    h(
      "div",
      { class: "balance" },
      h("span", { class: "muted" }, "Solde"),
      h("strong", {}, `${fmt(ctx.me.balance)} pts`)
    ),
    items.length
      ? h(
          "ul",
          { class: "items" },
          items.map((item) =>
            h(
              "li",
              { class: "item" },
              h("span", { class: "item-icon" }, emoji(item.emoji, item.label)),
              h(
                "span",
                { class: "item-text" },
                h("strong", {}, item.label),
                item.description ? h("span", { class: "muted small" }, item.description) : null
              ),
              h("span", { class: "item-count" }, `×${fmt(item.count)}`)
            )
          )
        )
      : h(
          "p",
          { class: "muted" },
          "Ton sac est vide. Les objets se trouvent sur les Pokémon capturés et à la loterie (/pk loterie)."
        )
  );
}
