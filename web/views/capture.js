// La capture : l'apparition en cours, la même que dans le salon Discord, et de
// quoi lui lancer ses balls. Le site ne tranche rien : chaque lancer part par le
// même chemin que les boutons Discord (même cooldown, même paiement, même
// course), et l'annonce du salon suit. La page relit l'apparition à la cadence
// que donne l'API, tant qu'elle est ouverte et visible.
//
// Le Pokémon au centre, les balls juste en dessous, puis ce que donnerait le
// bouton « Infos du Pokémon » sur Discord : ce qu'on possède de sa lignée, son
// solde et ses balls en poche. Le journal des lancers vit sur le côté.
import {
  OBTENTION_LEGENDS,
  OBTENTION_MARKS,
  api,
  colorChip,
  emoji,
  fmt,
  h,
  pokemonName,
  richText,
  toast,
} from "../lib.js";

// Les chances affichées comme sur l'annonce Discord.
function percent(probability) {
  const value = probability * 100;
  if (value >= 10) return `${Math.round(value)} %`;
  if (value >= 1) return `${value.toFixed(1).replace(".", ",")} %`;
  return `${value.toFixed(2).replace(".", ",")} %`;
}

// Les stades tels que les nomme la fiche Discord.
const STAGE_LABELS = ["Forme de base", "Stade 1", "Stade 2"];

const dexNumber = (species) => `n° ${String(species.id).padStart(3, "0")}`;

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
        h(
          "div",
          { class: "capture-layout" },
          h("div", { class: "capture-main" }, state.spawn ? spawnCard() : waiting()),
          h("aside", { class: "capture-aside" }, journal(), drops())
        ),
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

  // Après une action : l'apparition et le solde ont pu changer tous les deux.
  async function refreshAll() {
    await Promise.all([refresh({ force: true }), ctx.refreshMe().catch(() => {})]);
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
    await refreshAll();
  }

  // ---------------------- Le Pokémon ----------------------

  function spawnCard() {
    const spawn = state.spawn;
    const species = ctx.species.get(spawn.speciesId);
    if (!species) return h("p", { class: "notice" }, "Un Pokémon inconnu apparaît…");
    const card = h(
      "article",
      { class: `spawn${spawn.shiny ? " spawn-shiny" : ""}` },
      h(
        "div",
        { class: "chips" },
        spawn.rarityLabel
          ? colorChip(spawn.rarityLabel, { className: `rarity-${spawn.rarity}` })
          : null,
        species.types.map((type) => colorChip(type, { color: ctx.types[type] })),
        colorChip(`Difficulté : ${spawn.difficulty.label}`, {
          className: `difficulty-${spawn.difficulty.level}`,
        })
      ),
      h("img", {
        class: "spawn-art",
        src: spawn.shiny ? species.spriteShiny : species.sprite,
        alt: species.name,
      }),
      h(
        "h2",
        { class: "spawn-title" },
        spawn.shiny
          ? `✨ Un ${species.name} SHINY apparaît ! ✨`
          : `Un ${species.name} sauvage apparaît !`
      ),
      h("p", { class: "muted small spawn-dex" }, dexNumber(species)),
      ownedLine(spawn),
      wallet(),
      balls(spawn),
      confirming ? confirmation(spawn) : null,
      panel ? throwPanel() : null,
      lineage(spawn, species)
    );
    // Un halo de la couleur de son premier type, comme la bordure de l'embed.
    const glow = ctx.types[species.types[0]];
    if (glow) card.style.setProperty("--glow", glow);
    return card;
  }

  // « Est-ce que je l'ai déjà ? » La variante qui compte est celle qu'on a sous
  // les yeux : un shiny est une entrée de Pokédex à part. Les deux compteurs
  // restent visibles, comme sur la fiche Discord.
  function ownedLine(spawn) {
    const { normal, shiny } = spawn.owned;
    const has = spawn.shiny ? shiny > 0 : normal > 0;
    const counts = [normal ? `×${fmt(normal)}` : null, shiny ? `✨×${fmt(shiny)}` : null]
      .filter(Boolean)
      .join(" · ");
    return h(
      "p",
      { class: `spawn-owned${has ? " has" : ""}` },
      has
        ? `✅ Déjà dans ta boîte (${counts})`
        : `🆕 Pas encore dans ta boîte${spawn.shiny ? " en shiny" : ""}` +
            (counts ? ` (tu as ${counts})` : "")
    );
  }

  // Le solde et les balls en poche : les deux questions qu'on se pose avant de
  // lancer, comme dans la fiche Discord.
  function wallet() {
    const { balance, balls: stock } = ctx.me;
    return h(
      "div",
      { class: "wallet" },
      h("span", { class: "wallet-balance" }, "Solde ", h("strong", {}, `${fmt(balance)} pts`)),
      stock.length
        ? stock.map((ball) =>
            h(
              "span",
              { class: "wallet-ball", title: ball.label },
              emoji(ball.emoji, ball.label),
              `×${fmt(ball.count)}`
            )
          )
        : h("span", { class: "muted" }, "Aucune ball en poche")
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
              : `${fmt(ball.price)} pts`
          ),
          h(
            "span",
            { class: "ball-odds" },
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

  // La lignée, stade par stade comme la fiche Discord : un embranchement
  // (Évoli) empile ses formes dans la colonne de leur stade.
  function lineage(spawn, species) {
    const stages = new Map();
    for (const link of spawn.lineage) {
      const linkSpecies = ctx.species.get(link.speciesId);
      if (!linkSpecies) continue;
      const list = stages.get(link.stage) ?? [];
      list.push({ ...link, species: linkSpecies });
      stages.set(link.stage, list);
    }
    const solo = stages.size <= 1;
    const kinds = new Set(
      spawn.lineage.map((link) => ctx.species.get(link.speciesId)?.obtention).filter(Boolean)
    );
    return h(
      "section",
      { class: "lineage" },
      h("h3", {}, solo ? "Ton Pokédex" : "Lignée"),
      h(
        "div",
        { class: "lineage-stages" },
        [...stages]
          .sort((a, b) => a[0] - b[0])
          .map(([stage, links]) =>
            h(
              "div",
              { class: "lineage-stage" },
              solo
                ? null
                : h(
                    "span",
                    { class: "lineage-label" },
                    STAGE_LABELS[stage - 1] ?? `Stade ${stage - 1}`
                  ),
              h(
                "div",
                { class: "lineage-links" },
                links.map((link) => lineageLink(link, spawn, species))
              )
            )
          )
      ),
      ["evolution", "egg"]
        .filter((kind) => kinds.has(kind))
        .map((kind) => h("p", { class: "muted small" }, OBTENTION_LEGENDS[kind]))
    );
  }

  function lineageLink(link, spawn, species) {
    const { normal, shiny } = link.owned;
    const has = spawn.shiny ? shiny > 0 : normal > 0;
    const current = link.speciesId === species.id;
    const mark = OBTENTION_MARKS[link.species.obtention];
    const counts = [normal ? `×${fmt(normal)}` : null, shiny ? `✨×${fmt(shiny)}` : null]
      .filter(Boolean)
      .join(" · ");
    return h(
      "div",
      { class: `lineage-link${has ? " has" : ""}${current ? " current" : ""}` },
      h("img", {
        class: "sprite",
        src: spawn.shiny ? link.species.iconShiny : link.species.icon,
        alt: "",
        width: 72,
        height: 72,
      }),
      h(
        "span",
        { class: "lineage-name" },
        `${has ? "✅" : "❔"} ${link.species.name}`,
        mark ? ` ${mark}` : null
      ),
      h("span", { class: "muted small" }, counts || "—")
    );
  }

  // ---------------------- Entre deux apparitions ----------------------

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
      ),
      wallet()
    );
  }

  // ---------------------- Sur le côté ----------------------

  function journal() {
    if (!state.spawn) return null;
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
                { class: row.result === "CATCH" ? "throw-won" : null },
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
    if (!state.drops.length) return null;
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
                await refreshAll();
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
