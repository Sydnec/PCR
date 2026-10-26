// La capture : l'apparition en cours, la même que dans le salon Discord, et de
// quoi lui lancer ses balls. Le site ne tranche rien : chaque lancer part par le
// même chemin que les boutons Discord (même cooldown, même paiement, même
// course), et l'annonce du salon suit. La page relit l'apparition à la cadence
// que donne l'API, tant qu'elle est ouverte et visible.
//
// Le Pokémon au centre, ses balls juste en dessous, puis ce que donnerait le
// bouton « Infos du Pokémon » sur Discord : ce qu'on en possède, son solde et
// ses balls en poche, sa lignée. Sur le côté, tout ce qui se lance d'ailleurs :
// le journal des lancers, ce qui est au sol, la pêche et le parc safari. La
// touche d'une pêche passe en tête du centre : elle s'enfuit vite, et n'est qu'à toi.
import { icon } from "../icons.js";
import { lineageView } from "../lineage.js";
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
  richText,
  toast,
} from "../lib.js";
import { safariOffer } from "../safari-offer.js";

// L'icône qui ouvre la réponse d'un lancer, à la place de l'emoji du message.
const PANEL_ICONS = {
  catch: "star",
  miss: "cross",
  void: "wind",
  gone: "wind",
  cooldown: "hourglass",
};

export async function render(ctx) {
  let state = await api("/api/spawn");
  let signature = JSON.stringify(state);
  ctx.setWallet(state.wallet);
  // Ce qui n'appartient qu'à cet onglet : la Master Ball ou l'entrée du parc en
  // attente de confirmation, la réponse du dernier lancer, et la fin du
  // cooldown affiché.
  // La confirmation de la Master Ball vise une apparition ({ key, spawnId }) : le salon et la
  // pêche ont chacun la leur. Les balls spéciales s'ouvrent de même par apparition.
  let confirming = null;
  const specialOpen = new Set();
  let buyingSafari = false;
  let panel = null;
  let throwing = false;
  let coolUntil = 0;
  let coolTimer = null;

  const body = h("div", { class: "capture" });

  // replaceChildren écrirait « null » en toutes lettres : h() filtre les
  // absents, lui non.
  const draw = () =>
    body.replaceChildren(
      h(
        "div",
        { class: "capture-layout" },
        h(
          "div",
          { class: "capture-main" },
          touchView(),
          state.spawn ? spawnView(state.spawn) : waiting()
        ),
        h("aside", { class: "capture-aside" }, journal(), drops(), fishingView(), safariView())
      )
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
    // Un nouveau Pokémon, au salon ou au bout de la ligne : la confirmation et la réponse
    // visaient l'ancien.
    const touch = next.fishing?.spawn;
    if (
      (next.spawn && next.spawn.id !== state.spawn?.id) ||
      (touch && touch.id !== state.fishing?.spawn?.id)
    ) {
      confirming = null;
      panel = null;
    }
    state = next;
    signature = nextSignature;
    ctx.setWallet(state.wallet);
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

  async function throwBall(ball, { requireItem = false, expectedPrice = null } = {}, spawn) {
    throwing = true;
    confirming = null;
    draw();
    try {
      const result = await api("/api/spawn/throw", {
        method: "POST",
        body: { spawnId: spawn.id, ball: ball.key, requireItem, expectedPrice },
      });
      panel = {
        text: result.message,
        status: result.status,
        spawnId: spawn.id,
        fished: Boolean(spawn.fished),
        final: Boolean(result.final),
      };
      if (result.status === "cooldown") coolDown(result.remaining);
      else if (!result.final) coolDown(state.cooldownSeconds);
    } catch (error) {
      panel = {
        text: error.message,
        status: "error",
        spawnId: spawn.id,
        fished: Boolean(spawn.fished),
      };
    }
    throwing = false;
    await refreshAll();
  }

  // ---------------------- Le Pokémon ----------------------

  // Une apparition du salon, ou la touche réservée au pêcheur (`fished`) : même carte, mêmes
  // balls, mêmes chances.
  function spawnView(spawn) {
    const species = ctx.species.get(spawn.speciesId);
    if (!species) return h("p", { class: "notice" }, "Un Pokémon inconnu apparaît…");
    const view = h(
      "div",
      { class: `spawn${spawn.shiny ? " spawn-shiny" : ""}` },
      h(
        "div",
        { class: "chips" },
        spawn.rarityLabel
          ? colorChip(spawn.rarityLabel, { className: `rarity-${spawn.rarity}` })
          : null,
        species.types.map((type) => colorChip(type, { color: ctx.types[type] })),
        colorChip(spawn.difficulty.label, { className: `difficulty-${spawn.difficulty.level}` })
      ),
      h("img", {
        class: "spawn-art",
        src: spawn.form?.sprite ?? (spawn.shiny ? species.spriteShiny : species.sprite),
        alt: species.name,
      }),
      // Le sexe du Pokémon apparu, comme sur l'annonce Discord.
      h(
        "h2",
        { class: "spawn-title" },
        spawn.shiny ? [icon("sparkle", { label: "Shiny" }), " "] : null,
        "Un ",
        pokemonName(species, false, spawn.sex, null, spawn.form),
        spawn.fished
          ? spawn.shiny
            ? " shiny mord à la ligne !"
            : " mord à la ligne !"
          : spawn.shiny
            ? " shiny apparaît !"
            : " sauvage apparaît !"
      ),
      h(
        "p",
        { class: "spawn-meta muted" },
        dexNumber(species),
        " · ",
        ownedMark(spawn.owned, spawn.shiny)
      ),
      // Il ne brille que pour les porteurs du Charme Chroma de sa génération :
      // le salon le voit normal, et c'est au porteur qu'il faut le dire.
      spawn.charm
        ? h(
            "p",
            { class: "notice" },
            itemIcon(spawn.charm),
            h(
              "span",
              {},
              spawn.charm.mine
                ? `Il brille pour toi, grâce à ton ${spawn.charm.label} !`
                : `Il brille pour les porteurs du ${spawn.charm.label}.`
            )
          )
        : null,
      wallet(),
      balls(spawn),
      confirming?.spawnId === spawn.id ? confirmation(spawn) : null,
      panel?.spawnId === spawn.id ? throwPanel() : null,
      lineageView(ctx, spawn.lineage, { currentId: spawn.speciesId, shiny: spawn.shiny })
    );
    // Un halo de la couleur de son premier type, comme la bordure de l'embed.
    const glow = ctx.types[species.types[0]];
    if (glow) view.style.setProperty("--glow", glow);
    return view;
  }

  // Le solde et les balls en poche : les deux questions qu'on se pose avant de
  // lancer, comme dans la fiche Discord.
  function wallet() {
    const { balance, balls: stock } = ctx.me;
    return h(
      "p",
      { class: "wallet" },
      h("strong", {}, `${fmt(balance)} pts`),
      stock.map((ball) =>
        h(
          "span",
          { class: "wallet-ball", title: ball.label },
          itemIcon(ball),
          `×${fmt(ball.count)}`
        )
      )
    );
  }

  // Les balls ordinaires d'abord ; la Master Ball et celles de la boutique sont
  // rangées derrière « Balls spéciales », comme dans le sous-menu de Discord.
  function balls(spawn) {
    const cooling = Date.now() < coolUntil;
    const standard = spawn.balls.filter((ball) => !ball.guaranteed);
    // Une ball de la boutique sert si on en a acheté AVANT cette apparition : aucun
    // prix au lancer, son nombre tient lieu de stock.
    const special = [
      ...spawn.specialBalls.map((ball) => ({
        ...ball,
        shop: true,
        price: 0,
        free: ball.eligible,
        usable: ball.eligible > 0,
        guaranteed: false,
      })),
      ...spawn.balls.filter((ball) => ball.guaranteed),
    ];

    const button = (ball) => {
      // Hors de portée : pas assez de points, et aucune en poche (celle-là
      // serait gratuite). Le serveur tranche de toute façon.
      const reason = !ball.usable
        ? ball.shop
          ? ball.held
            ? "Tes balls ont été achetées après l'apparition de ce Pokémon."
            : "Achète-en à la boutique : elles servent aux Pokémon suivants."
          : `Il te faut ${fmt(ball.price)} pts, tu en as ${fmt(ctx.me.balance)}.`
        : cooling
          ? "Attends la fin du cooldown."
          : null;
      return h(
        "button",
        {
          class: `ball${ball.usable ? "" : " ball-off"}`,
          disabled: throwing || cooling || !ball.usable,
          title: reason,
          // La Master Ball se confirme, comme sur Discord : un mésclic ne se
          // rattrape pas.
          onclick: () => {
            if (!ball.guaranteed) return throwBall(ball, {}, spawn);
            confirming = { key: ball.key, spawnId: spawn.id };
            draw();
          },
        },
        // Le nombre en poche en pastille sur la ball, comme un compteur
        // d'inventaire.
        h(
          "span",
          { class: "ball-icon" },
          itemIcon(ball),
          ball.free ? h("span", { class: "ball-stock" }, fmt(ball.free)) : null
        ),
        h(
          "span",
          { class: "ball-text" },
          h("span", { class: "ball-label" }, ball.label),
          h(
            "span",
            { class: "ball-meta" },
            // Une ball en poche est offerte : son prix ne compte pas. Une ball de
            // la boutique est déjà payée, et ne porte pas de prix du tout.
            ball.shop ? "achetée" : ball.free ? "offerte" : `${fmt(ball.price)} pts`,
            " · ",
            ball.guaranteed ? "garantie" : percent(ball.probability)
          )
        )
      );
    };

    return h(
      "div",
      { class: "balls-group" },
      h(
        "div",
        { class: "balls" },
        standard.map(button),
        h(
          "button",
          {
            class: `ball ball-special${specialOpen.has(spawn.id) ? " ball-open" : ""}`,
            disabled: throwing,
            onclick: () => {
              if (!specialOpen.delete(spawn.id)) specialOpen.add(spawn.id);
              draw();
            },
          },
          h("span", { class: "ball-icon" }, "🌟"),
          h("span", { class: "ball-text" }, h("span", { class: "ball-label" }, "Balls spéciales"))
        )
      ),
      specialOpen.has(spawn.id) ? h("div", { class: "balls" }, special.map(button)) : null
    );
  }

  function confirmation(spawn) {
    const ball = spawn.balls.find((candidate) => candidate.key === confirming.key);
    if (!ball) return null;
    const free = ball.free > 0;
    return h(
      "div",
      { class: "confirm" },
      h(
        "p",
        {},
        richText(
          free
            ? `⚠️ Tu vas utiliser ta **${ball.label}** en poche : la capture est garantie, mais ` +
                `elle est perdue si quelqu'un t'attrape le Pokémon avant. Il t'en reste **${fmt(ball.free)}**.`
            : `⚠️ La **${ball.label}** garantit la capture mais coûte **${fmt(ball.price)}** points, ` +
                `et ils sont perdus si quelqu'un t'attrape le Pokémon avant.`
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
            // que la confirmation Discord. Payante, le prix affiché est celui
            // qu'on promet, et il ne doit pas avoir monté entre-temps.
            onclick: () =>
              throwBall(
                ball,
                { requireItem: free, expectedPrice: free ? null : ball.price },
                spawn
              ),
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
    outcomePanel(panel.text, PANEL_ICONS[panel.status], `throw-${panel.status}`);

  // ---------------------- La pêche ----------------------

  async function castLine(rod) {
    throwing = true;
    draw();
    let bitten = false;
    try {
      const result = await api("/api/fishing/cast", { method: "POST", body: { rod: rod.key } });
      bitten = result.ok;
      panel = result.ok ? null : { text: result.message, status: "error", fished: true };
    } catch (error) {
      panel = { text: error.message, status: "error", fished: true };
    }
    throwing = false;
    await refreshAll();
    // La canne se lance du côté, la touche arrive en tête : on l'amène sous les yeux,
    // sur un téléphone le côté est tout en bas.
    if (bitten) showTouch();
  }

  // Défiler jusqu'à la touche, juste sous l'en-tête collant : sa hauteur se mesure, car
  // sur un téléphone il passe sur plusieurs lignes.
  function showTouch() {
    const touch = document.getElementById("touch");
    if (!touch) return;
    const bar = document.querySelector(".topbar")?.offsetHeight ?? 0;
    const top = touch.getBoundingClientRect().top + window.scrollY - bar - 8;
    window.scrollTo({ top, behavior: "smooth" });
  }

  // Le temps qu'il reste à la touche, « 1:42 ». Les nœuds `data-until` sont remis à jour
  // chaque seconde par l'horloge de la page, sans tout redessiner.
  const remaining = (until) => {
    const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };
  const countdown = (until) =>
    h("strong", { class: "countdown", "data-until": String(until) }, remaining(until));

  // La touche, en tête : la carte d'une apparition, sous un bandeau qui dit qu'elle n'est
  // qu'à toi et combien de temps il lui reste. Partie, l'issue du lancer qui l'a close
  // reste là où on la regardait ; un raté, lui, ne dit plus rien une fois qu'elle a fui.
  function touchView() {
    if (!state.fishing?.open) return null;
    const touch = state.fishing.spawn;
    if (!touch) {
      return panel?.fished && panel.spawnId && panel.final
        ? h("section", { class: "touch", id: "touch" }, throwPanel())
        : null;
    }
    return h(
      "section",
      { class: "touch", id: "touch" },
      h(
        "p",
        { class: "notice touch-banner" },
        icon("hourglass"),
        h(
          "span",
          {},
          h("strong", {}, "Ça mord, rien que pour toi !"),
          " Il s'enfuit dans ",
          countdown(touch.fleesAt),
          ". Les balls se paient comme sur une apparition."
        )
      ),
      spawnView(touch)
    );
  }

  // Une canne : ce qu'elle pêche, écrit en clair (une infobulle ne s'ouvre pas sur un
  // téléphone), et pourquoi elle est grisée quand elle l'est.
  function rodButton(rod) {
    const poor = state.wallet.balance < rod.price;
    const status = !rod.owned
      ? "À trouver sur les Pokémon ou à la loterie"
      : poor
        ? `Il te faut ${fmt(rod.price)} pts, tu en as ${fmt(state.wallet.balance)}`
        : `${fmt(rod.price)} pts`;
    return h(
      "button",
      {
        class: `ball${rod.owned && !poor ? "" : " ball-off"}`,
        disabled: throwing || !rod.owned || poor,
        onclick: () => castLine(rod),
      },
      h("span", { class: "ball-icon" }, itemIcon(rod)),
      h(
        "span",
        { class: "ball-text" },
        h(
          "span",
          { class: "ball-label" },
          rod.owned ? null : [icon("lock", { label: "Pas encore à toi" }), " "],
          rod.label
        ),
        rod.description ? h("span", { class: "rod-pool" }, rod.description) : null,
        h("span", { class: "ball-meta" }, status)
      )
    );
  }

  // Les cannes, ou la touche qui attend : une seule à la fois, et elle n'est qu'au pêcheur.
  // Rien ne s'affiche tant que la génération de la pêche est fermée.
  function fishingView() {
    const fishing = state.fishing;
    if (!fishing?.open) return null;
    const touch = fishing.spawn;
    const species = touch ? ctx.species.get(touch.speciesId) : null;
    return h(
      "section",
      { class: "side-section" },
      h("h3", {}, "Pêche"),
      touch
        ? [
            h(
              "p",
              { class: "small" },
              species
                ? [
                    pokemonName(species, false, touch.sex, null, touch.form),
                    " est au bout de ta ligne",
                  ]
                : "Un Pokémon est au bout de ta ligne",
              " : il s'enfuit dans ",
              countdown(touch.fleesAt),
              "."
            ),
            h(
              "button",
              {
                class: "button small primary",
                onclick: showTouch,
              },
              "Lui lancer une ball"
            ),
          ]
        : [
            h("p", { class: "muted small" }, "Le Pokémon qui mord est pour toi seul."),
            h("div", { class: "rods" }, fishing.rods.map(rodButton)),
            // Un refus de la ligne, là où on a cliqué ; le résultat d'un lancer sur la
            // touche, lui, reste en tête (touchView).
            panel?.fished && !panel.spawnId ? throwPanel() : null,
          ]
    );
  }

  // ---------------------- Le parc safari ----------------------

  function safariView() {
    const offer = safariOffer(ctx, state.safari, {
      onEnter: () => ctx.navigate("/safari"),
      redraw: draw,
      confirming: buyingSafari,
      setConfirming: (value) => {
        buyingSafari = value;
      },
    });
    return offer
      ? h("section", { class: "side-section" }, h("h3", {}, "Parc safari"), offer)
      : null;
  }

  // ---------------------- Entre deux apparitions ----------------------

  function waiting() {
    const last = state.last;
    const species = last ? ctx.species.get(last.speciesId) : null;
    const ball = last?.ball ? ctx.balls.get(last.ball) : null;
    return h(
      "div",
      { class: "spawn-empty" },
      panel && !panel.fished ? throwPanel() : null,
      species
        ? h(
            "div",
            { class: "last-spawn" },
            h("img", {
              class: "sprite",
              src: last.form?.icon ?? (last.shiny ? species.iconShiny : species.icon),
              alt: "",
              width: 96,
              height: 96,
            }),
            h(
              "p",
              {},
              last.status === "CAUGHT"
                ? [
                    pokemonName(species, last.shiny, last.sex, null, last.form),
                    " a été capturé par ",
                    h("strong", {}, last.caughtBy?.name ?? "un dresseur parti"),
                    ball ? [" avec ", itemIcon(ball), " ", ball.label] : null,
                    ".",
                  ]
                : [pokemonName(species, last.shiny, last.sex, null, last.form), " s'est enfui…"]
            )
          )
        : null,
      // Le parc ouvert suspend les apparitions : l'attente a alors une fin connue.
      state.pausedUntil
        ? h(
            "p",
            { class: "muted" },
            "Aucun Pokémon dans les parages : le parc safari est ouvert, et les apparitions ",
            `reprennent à sa fermeture, ${dateTimeFr(state.pausedUntil)}.`
          )
        : h(
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
      { class: "side-section" },
      h("h3", {}, "Lancers ", h("span", { class: "muted" }, fmt(throwCount))),
      throws.length
        ? h(
            "ul",
            { class: "throws" },
            // Le plus récent en haut : c'est ce qu'on cherche des yeux en pleine course.
            [...throws].reverse().map((row) => {
              const ball = ctx.balls.get(row.ball);
              const won = row.result === "CATCH";
              return h(
                "li",
                { class: won ? "throw-won" : null },
                icon(won ? "check" : "cross", { label: won ? "Capturé" : "Raté" }),
                row.trainer.avatar
                  ? h("img", { class: "avatar", src: row.trainer.avatar, alt: "" })
                  : null,
                h("span", { class: "throw-name" }, row.trainer.name ?? "Dresseur parti"),
                ball ? itemIcon(ball) : row.ball
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
      { class: "side-section" },
      h("h3", {}, "Au sol"),
      state.drops.map((drop) =>
        h(
          "div",
          { class: "drop" },
          itemIcon(drop),
          h("span", { class: "drop-text" }, drop.label),
          // Ce qu'un Pokémon capturé lâche n'est pas pour son capteur : l'API le
          // dit, le bouton reste visible mais inerte.
          h(
            "button",
            {
              class: "button small",
              disabled: !drop.claimable,
              title: drop.claimable ? null : "Tu l'as capturé : il revient aux autres.",
              onclick: async (event) => {
                event.currentTarget.disabled = true;
                try {
                  const { item, sold } = await api(`/api/drops/${drop.id}/claim`, {
                    method: "POST",
                    body: {},
                  });
                  // Au-delà de la limite (la Master Ball), l'objet est vendu d'office.
                  toast(`Tu ramasses **${item.label}** !${sold ? ` ${sold}` : ""}`, "success");
                } catch (error) {
                  toast(error.message, "error");
                }
                await refreshAll();
              },
            },
            drop.claimable ? "Ramasser" : "Aux autres"
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

  // L'horloge des comptes à rebours. À zéro, la touche s'est enfuie : on relit tout de
  // suite, une fois par touche — une horloge en avance sur le serveur la trouverait
  // encore là, et la relecture habituelle prendra le relais.
  let expiredTouch = null;
  const clock = setInterval(() => {
    for (const node of body.querySelectorAll("[data-until]")) {
      node.textContent = remaining(Number(node.dataset.until));
    }
    const touch = state.fishing?.spawn;
    if (touch && touch.fleesAt <= Date.now() && expiredTouch !== touch.id && !document.hidden) {
      expiredTouch = touch.id;
      refresh();
    }
  }, 1000);
  const onVisible = () => {
    if (!document.hidden) refresh();
  };
  document.addEventListener("visibilitychange", onVisible);
  ctx.onLeave(() => {
    clearInterval(timer);
    clearInterval(clock);
    clearTimeout(coolTimer);
    document.removeEventListener("visibilitychange", onVisible);
  });

  draw();
  return h("section", { class: "view" }, body);
}
