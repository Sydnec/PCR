// La capture : l'apparition en cours, la même que dans le salon Discord, et de
// quoi lui lancer ses balls. Le site ne tranche rien : chaque lancer part par le
// même chemin que les boutons Discord (même cooldown, même paiement, même
// course), et l'annonce du salon suit. La page relit l'apparition à la cadence
// que donne l'API, tant qu'elle est ouverte et visible.
import { api, emoji, fmt, h, pokemonName, richText, toast } from "../lib.js";

// Les chances affichées comme sur l'annonce Discord.
function percent(probability) {
  const value = probability * 100;
  if (value >= 10) return `${Math.round(value)} %`;
  if (value >= 1) return `${value.toFixed(1).replace(".", ",")} %`;
  return `${value.toFixed(2).replace(".", ",")} %`;
}

export async function render(ctx) {
  let state = await api("/api/spawn");
  let signature = JSON.stringify(state);
  // Ce qui n'appartient qu'à cet onglet : la Master Ball en attente de
  // confirmation, la réponse du dernier lancer, et la fin du cooldown affiché.
  let confirming = null;
  let panel = null;
  let throwing = false;
  let coolUntil = 0;
  let coolTimer = null;

  const body = h("div", { class: "capture" });

  // replaceChildren écrirait « null » en toutes lettres : h() filtre les
  // absents, lui non.
  const draw = () =>
    body.replaceChildren(
      ...[
        state.pausedUntil
          ? h(
              "p",
              { class: "notice" },
              "🏕️ Le parc safari est ouvert : les apparitions reprennent à sa fermeture. ",
              "Il se visite sur Discord avec /pk safari."
            )
          : null,
        state.spawn ? spawnCard() : waiting(),
        state.spawn ? journal() : null,
        state.drops.length ? drops() : null,
      ].filter(Boolean)
    );

  async function refresh({ force = false } = {}) {
    let next;
    try {
      next = await api("/api/spawn");
    } catch {
      // Une relecture manquée n'efface rien : la suivante rattrapera.
      return;
    }
    const nextSignature = JSON.stringify(next);
    if (!force && nextSignature === signature) return;
    // Un nouveau Pokémon : la confirmation et la réponse visaient l'ancien.
    if (next.spawn && next.spawn.id !== state.spawn?.id) {
      confirming = null;
      panel = null;
    }
    state = next;
    signature = nextSignature;
    draw();
  }

  // Le serveur garde le dernier mot sur le cooldown ; ceci n'évite que les
  // clics dont on sait déjà qu'ils seront refusés.
  function coolDown(seconds) {
    coolUntil = Date.now() + seconds * 1000;
    clearTimeout(coolTimer);
    coolTimer = setTimeout(draw, seconds * 1000);
  }

  async function throwBall(ball, { requireItem = false } = {}) {
    throwing = true;
    confirming = null;
    draw();
    try {
      const result = await api("/api/spawn/throw", {
        method: "POST",
        body: { spawnId: state.spawn.id, ball: ball.key, requireItem },
      });
      panel = { text: result.message, status: result.status };
      if (result.status === "cooldown") coolDown(result.remaining);
      else if (!result.final) coolDown(state.cooldownSeconds);
    } catch (error) {
      panel = { text: error.message, status: "error" };
    }
    throwing = false;
    await Promise.all([refresh({ force: true }), ctx.refreshMe().catch(() => {})]);
  }

  function spawnCard() {
    const spawn = state.spawn;
    const species = ctx.species.get(spawn.speciesId);
    if (!species) return h("p", { class: "notice" }, "Un Pokémon inconnu apparaît…");
    const owned = spawn.shiny ? spawn.owned.shiny : spawn.owned.normal;
    return h(
      "article",
      { class: `spawn${spawn.shiny ? " spawn-shiny" : ""}` },
      h("img", {
        class: "spawn-art",
        src: spawn.shiny ? species.spriteShiny : species.sprite,
        alt: species.name,
      }),
      h(
        "div",
        { class: "spawn-side" },
        h(
          "h2",
          {},
          spawn.shiny
            ? `✨ Un ${species.name} SHINY apparaît ! ✨`
            : `Un ${species.name} sauvage apparaît !`
        ),
        h(
          "div",
          { class: "chips" },
          spawn.rarityLabel ? h("span", { class: "chip" }, spawn.rarityLabel) : null,
          h("span", { class: "chip" }, species.types.join(" / ")),
          h("span", { class: "chip" }, `Difficulté : ${spawn.difficulty}`)
        ),
        h(
          "p",
          { class: "muted small" },
          owned
            ? `Tu en as ${fmt(owned)}${spawn.shiny ? " en shiny" : ""} dans ta boîte.`
            : `🆕 Tu n'en as pas encore${spawn.shiny ? " en shiny" : ""} !`
        ),
        balls(spawn),
        confirming ? confirmation(spawn) : null,
        panel ? throwPanel() : null
      )
    );
  }

  function balls(spawn) {
    const cooling = Date.now() < coolUntil;
    return h(
      "div",
      { class: "balls" },
      spawn.balls.map((ball) =>
        h(
          "button",
          {
            class: `ball${ball.guaranteed ? " ball-master" : ""}`,
            disabled: throwing || cooling,
            title: cooling ? "Attends la fin du cooldown" : null,
            // La Master Ball se confirme, comme sur Discord : un mésclic ne se
            // rattrape pas.
            onclick: () => {
              if (!ball.guaranteed) return throwBall(ball);
              confirming = ball.key;
              draw();
            },
          },
          emoji(ball.emoji, ball.label),
          h("span", { class: "ball-label" }, ball.label),
          h(
            "span",
            { class: "ball-meta" },
            ball.free
              ? `${fmt(ball.free)} offerte${ball.free > 1 ? "s" : ""}`
              : `${fmt(ball.price)} pts`,
            " · ",
            ball.guaranteed ? "garantie" : percent(ball.probability)
          )
        )
      )
    );
  }

  function confirmation(spawn) {
    const ball = spawn.balls.find((candidate) => candidate.key === confirming);
    if (!ball) return null;
    const free = ball.free > 0;
    return h(
      "div",
      { class: "notice confirm" },
      h(
        "p",
        {},
        richText(
          free
            ? `⚠️ Tu vas utiliser ta **${ball.label}** offerte : la capture est garantie, mais ` +
                `elle est perdue si quelqu'un t'attrape le Pokémon avant. Il t'en reste **${fmt(ball.free)}**.`
            : `⚠️ La **${ball.label}** garantit la capture mais coûte **${fmt(ball.price)}** points, ` +
                `et ils sont perdus si quelqu'un t'attrape le Pokémon avant. ` +
                `Ton solde : **${fmt(ctx.me.balance)}** points.`
        )
      ),
      h(
        "div",
        { class: "confirm-actions" },
        h(
          "button",
          {
            class: "button danger",
            // Annoncée offerte, elle ne se paie jamais en points : même promesse
            // que la confirmation Discord.
            onclick: () => throwBall(ball, { requireItem: free }),
          },
          free ? `Utiliser ma ${ball.label}` : `Confirmer (-${fmt(ball.price)} pts)`
        ),
        h(
          "button",
          {
            class: "button ghost",
            onclick: () => {
              confirming = null;
              draw();
            },
          },
          "Annuler"
        )
      )
    );
  }

  const throwPanel = () =>
    h("div", { class: `throw-panel throw-${panel.status}`, role: "status" }, richText(panel.text));

  function waiting() {
    const last = state.last;
    const species = last ? ctx.species.get(last.speciesId) : null;
    const ball = last?.ball ? ctx.balls.get(last.ball) : null;
    return h(
      "div",
      { class: "spawn-empty" },
      panel ? throwPanel() : null,
      species
        ? h(
            "div",
            { class: "last-spawn" },
            h("img", {
              class: "sprite",
              src: last.shiny ? species.iconShiny : species.icon,
              alt: "",
              width: 96,
              height: 96,
            }),
            h(
              "p",
              {},
              last.status === "CAUGHT"
                ? [
                    pokemonName(species, last.shiny),
                    " a été capturé par ",
                    h("strong", {}, last.caughtBy?.name ?? "un dresseur parti"),
                    ball ? [" avec ", emoji(ball.emoji, ball.label), " ", ball.label] : null,
                    ".",
                  ]
                : [pokemonName(species, last.shiny), " s'est enfui…"]
            )
          )
        : null,
      h(
        "p",
        { class: "muted" },
        "Aucun Pokémon dans les parages. Le prochain apparaîtra avec l'activité du salon ",
        "Discord, et cette page le montrera dès son arrivée."
      )
    );
  }

  function journal() {
    const { throws, throwCount } = state.spawn;
    return h(
      "section",
      { class: "journal" },
      h("h3", {}, `Lancers (${fmt(throwCount)})`),
      throws.length
        ? h(
            "ul",
            { class: "throws" },
            // Le plus récent en haut : c'est ce qu'on cherche des yeux en pleine course.
            [...throws].reverse().map((row) => {
              const ball = ctx.balls.get(row.ball);
              return h(
                "li",
                {},
                h("span", { "aria-hidden": "true" }, row.result === "CATCH" ? "✅" : "❌"),
                row.trainer.avatar
                  ? h("img", { class: "avatar", src: row.trainer.avatar, alt: "" })
                  : null,
                h("span", { class: "throw-name" }, row.trainer.name ?? "Dresseur parti"),
                ball ? emoji(ball.emoji, ball.label) : row.ball
              );
            })
          )
        : h("p", { class: "muted small" }, "Personne n'a encore tenté sa chance.")
    );
  }

  function drops() {
    return h(
      "section",
      { class: "drops" },
      h("h3", {}, "Au sol"),
      state.drops.map((drop) =>
        h(
          "div",
          { class: "drop" },
          emoji(drop.emoji, drop.label),
          h(
            "span",
            { class: "drop-text" },
            "Il a laissé tomber ",
            h("strong", {}, drop.label),
            " ! Au plus rapide."
          ),
          h(
            "button",
            {
              class: "button primary",
              onclick: async (event) => {
                event.currentTarget.disabled = true;
                try {
                  const { item } = await api(`/api/drops/${drop.id}/claim`, {
                    method: "POST",
                    body: {},
                  });
                  toast(`Tu ramasses **${item.label}** !`, "success");
                } catch (error) {
                  toast(error.message, "error");
                }
                await Promise.all([refresh({ force: true }), ctx.refreshMe().catch(() => {})]);
              },
            },
            "Ramasser"
          )
        )
      )
    );
  }

  // Relire à la cadence donnée, seulement quand la page est sous les yeux, et
  // tout de suite quand on y revient.
  const timer = setInterval(() => {
    if (!document.hidden) refresh();
  }, state.refreshSeconds * 1000);
  const onVisible = () => {
    if (!document.hidden) refresh();
  };
  document.addEventListener("visibilitychange", onVisible);
  ctx.onLeave(() => {
    clearInterval(timer);
    clearTimeout(coolTimer);
    document.removeEventListener("visibilitychange", onVisible);
  });

  draw();
  return h(
    "section",
    { class: "view" },
    h(
      "div",
      { class: "view-head" },
      h("h1", {}, "Capture"),
      h("p", { class: "muted" }, "Les mêmes Pokémon que dans le salon Discord, et la même course.")
    ),
    body
  );
}
