// La boutique des balls spéciales, comme /pk boutique : le catalogue, ce qu'on en a,
// et l'achat. Une ball achetée ne sert qu'aux Pokémon qui apparaissent après son achat.
import { api, fmt, h, itemIcon, toast } from "../lib.js";

export async function render(ctx) {
  const balance = h("strong", {});
  const list = h("div");
  let shop = await api("/api/shop");

  function paint() {
    balance.textContent = `${fmt(shop.balance)} pts`;
    list.replaceChildren(
      shop.balls.length
        ? h("ul", { class: "items" }, shop.balls.map(row))
        : h("p", { class: "muted" }, "La boutique n'a rien en vente pour l'instant.")
    );
  }

  // Le solde suit : un achat débite des points, et l'en-tête les montre.
  async function buy(ball, quantity, button) {
    button.disabled = true;
    try {
      const result = await api("/api/shop/buy", {
        method: "POST",
        body: { ball: ball.key, quantity },
      });
      shop = { balance: result.balance, limit: result.limit, balls: result.balls };
      if (result.ok) {
        toast(
          `${fmt(result.bought)}× ${ball.label} pour ${fmt(result.cost)} pts.` +
            (result.partial ? ` ${result.message}` : ""),
          result.partial ? "info" : "success"
        );
      } else {
        toast(result.message, "error");
      }
      await ctx.refreshMe().catch(() => {});
    } catch (error) {
      toast(error.message, "error");
    }
    paint();
  }

  function row(ball) {
    const room = Math.max(0, shop.limit - ball.held);
    const quantity = h("input", {
      type: "number",
      min: 1,
      max: Math.max(1, room),
      value: 1,
      "aria-label": `Quantité de ${ball.label}`,
    });
    const button = h(
      "button",
      { type: "button", class: "button small", disabled: room === 0 },
      room === 0 ? "Poche pleine" : "Acheter"
    );
    button.addEventListener("click", () =>
      buy(ball, Math.floor(Number(quantity.value)) || 1, button)
    );
    return h(
      "li",
      { class: "item" },
      h("span", { class: "item-icon" }, itemIcon(ball)),
      h(
        "span",
        { class: "item-text" },
        h("strong", {}, ball.label),
        h("span", { class: "muted small" }, ball.effect),
        h("span", { class: "muted small" }, `${fmt(ball.price)} pts l'unité`)
      ),
      h("span", { class: "item-count" }, `${fmt(ball.held)}/${fmt(shop.limit)}`),
      h("span", { class: "item-action" }, quantity, button)
    );
  }

  paint();

  return h(
    "section",
    { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "Boutique")),
    h("div", { class: "balance" }, h("span", { class: "muted" }, "Solde"), balance),
    h(
      "p",
      { class: "muted" },
      "Une ball achetée ne sert qu'aux Pokémon qui apparaissent après son achat — pas à celui en cours. ",
      "Elles se lancent dans « Balls spéciales » sur la page Capture."
    ),
    list
  );
}
