// La boîte PC : des boîtes de cases où chacun range ses Pokémon comme il
// l'entend, comme dans les jeux. Une case ne montre que le sprite ; un clic
// ouvre la fiche, d'où le Pokémon se renomme, se déplace, se revend ou évolue —
// ces deux derniers comme /pk revendre et /pk evolution avec un `#id`.
//
// Le rangement (places, noms des boîtes, surnoms) n'existe que sur le site et
// ne change rien au jeu. On déplace en glissant un Pokémon sur une case, ou, au
// doigt, avec « Déplacer » dans sa fiche puis un clic sur la case voulue. C'est
// l'API qui range : la page redessine la boîte qu'elle lui renvoie.
import { icon } from "../icons.js";
import { lineageView, loadLineage } from "../lineage.js";
import {
  api,
  confirmButton,
  dateFr,
  dexNumber,
  fmt,
  h,
  itemIcon,
  openDialog,
  pokemonName,
  richText,
  speciesChips,
  toast,
} from "../lib.js";

const ORIGINS = {
  capture: "Capturé",
  safari: "Capturé au parc safari",
  echange: "Reçu en échange",
  oeuf: "Éclos d'un œuf",
  evolution: "Obtenu par évolution",
  migration: "Arrivé avant le suivi des balls",
};

// Survoler une flèche en glissant un Pokémon change de boîte, au rythme d'une
// boîte par intervalle : le temps de voir où l'on arrive.
const FLIP_DELAY_MS = 600;

export async function render(ctx) {
  // La boîte ouverte vit dans l'adresse (?box=2), pour qu'un rechargement y
  // revienne ; le Pokédex y ajoute une espèce à mettre en évidence (?species=25).
  const params = new URLSearchParams(location.search);
  let highlight = Number(params.get("species")) || null;
  let pc = await api("/api/me/pc");
  let box = Math.max(0, Number(params.get("box") ?? 1) - 1) || 0;
  if (highlight && !params.has("box")) {
    const first = matches()[0];
    if (first) box = boxOf(first.pos);
  }
  box = Math.min(box, pc.boxes.length - 1);

  // Le Pokémon à ranger d'un clic (« Déplacer » dans sa fiche), celui qu'on
  // glisse, et le nom de boîte en cours d'édition.
  let moving = null;
  let dragging = null;
  let dragSource = null;
  let renaming = false;
  let flip = { direction: 0, since: 0, last: 0 };

  const body = h("div", { class: "pc" });
  // Le Pokémon qu'on glisse doit rester dans la page jusqu'au bout : retiré
  // avec la grille quand la boîte change, il ne recevrait plus la fin du
  // glissement.
  const stash = h("div", { class: "pc-stash", "aria-hidden": "true" });

  function boxOf(pos) {
    return Math.floor(pos / pc.slotsPerBox);
  }

  function matches() {
    return pc.pokemon.filter((mon) => mon.speciesId === highlight).sort((a, b) => a.pos - b.pos);
  }

  function writeUrl() {
    const query = new URLSearchParams();
    if (box) query.set("box", String(box + 1));
    if (highlight) query.set("species", String(highlight));
    const text = query.toString();
    history.replaceState(null, "", `/boite${text ? `?${text}` : ""}`);
  }

  function draw() {
    writeUrl();
    if (dragSource?.isConnected && !stash.contains(dragSource)) stash.append(dragSource);
    body.replaceChildren(...[head(), banner(), grid(), summary(), stash].filter(Boolean));
  }

  function goTo(next) {
    const target = Math.max(0, Math.min(pc.boxes.length - 1, next));
    if (target === box) return;
    box = target;
    renaming = false;
    draw();
  }

  async function reload() {
    try {
      pc = await api("/api/me/pc");
    } catch (error) {
      toast(error.message, "error");
    }
    box = Math.min(box, pc.boxes.length - 1);
    draw();
  }

  async function move(pokemonId, pos) {
    moving = null;
    const mon = pc.pokemon.find((candidate) => candidate.id === pokemonId);
    if (!mon || mon.pos === pos) return draw();
    try {
      pc = await api("/api/me/pc/move", { method: "POST", body: { pokemonId, pos } });
      draw();
    } catch (error) {
      toast(error.message, "error");
      await reload();
    }
  }

  // ---------------------- En-tête : la boîte ouverte ----------------------

  function head() {
    const current = pc.boxes[box];
    const arrow = (direction, name, label) =>
      h(
        "button",
        {
          class: "button ghost pc-arrow",
          "aria-label": label,
          title: label,
          disabled: direction < 0 ? box === 0 : box === pc.boxes.length - 1,
          onclick: () => goTo(box + direction),
          // Glisser un Pokémon sur la flèche : on change de boîte sans le lâcher.
          ondragover: (event) => {
            if (!dragging) return;
            event.preventDefault();
            const now = Date.now();
            if (flip.direction !== direction) flip = { direction, since: now, last: 0 };
            if (now - flip.since >= FLIP_DELAY_MS && now - flip.last >= FLIP_DELAY_MS) {
              flip.last = now;
              goTo(box + direction);
            }
          },
          ondragleave: () => {
            flip = { direction: 0, since: 0, last: 0 };
          },
        },
        icon(name)
      );
    return h(
      "div",
      { class: "pc-head" },
      arrow(-1, "chevronLeft", "Boîte précédente"),
      renaming ? nameForm(current) : nameButton(current),
      arrow(1, "chevronRight", "Boîte suivante"),
      h(
        "select",
        {
          class: "pc-jump",
          "aria-label": "Aller à la boîte",
          onchange: (event) => goTo(Number(event.target.value)),
        },
        pc.boxes.map((entry) => {
          const count = pc.pokemon.filter((mon) => boxOf(mon.pos) === entry.box).length;
          return h(
            "option",
            { value: entry.box, selected: entry.box === box },
            `${entry.name} (${fmt(count)})`
          );
        })
      )
    );
  }

  function nameButton(current) {
    return h(
      "button",
      {
        class: "pc-name",
        title: "Renommer la boîte",
        onclick: () => {
          renaming = true;
          draw();
          body.querySelector(".pc-name-input")?.select();
        },
      },
      h("span", {}, current.name),
      icon("pencil", { label: "Renommer" })
    );
  }

  // Entrée enregistre, Échap abandonne ; un nom vide rend le nom par défaut.
  function nameForm(current) {
    const input = h("input", {
      class: "pc-name-input",
      type: "text",
      value: current.custom ? current.name : "",
      placeholder: current.defaultName,
      maxlength: pc.boxNameLength,
      "aria-label": "Nom de la boîte",
      onkeydown: (event) => {
        if (event.key !== "Escape") return;
        renaming = false;
        draw();
      },
    });
    return h(
      "form",
      {
        class: "pc-name-form",
        onsubmit: async (event) => {
          event.preventDefault();
          try {
            const result = await api(`/api/me/pc/boxes/${current.box}/name`, {
              method: "POST",
              body: { name: input.value },
            });
            current.name = result.name;
            current.custom = result.custom;
          } catch (error) {
            toast(error.message, "error");
          }
          renaming = false;
          draw();
        },
      },
      input,
      h("button", { class: "button small primary", type: "submit" }, "OK")
    );
  }

  // ---------------------- Bandeaux ----------------------

  function banner() {
    if (moving) {
      const species = ctx.species.get(moving.speciesId);
      return h(
        "p",
        { class: "notice pc-banner" },
        icon("move"),
        h(
          "span",
          {},
          "Choisis la case de ",
          pokemonName(species, moving.shiny, moving.sex, moving.nickname),
          ` #${moving.id}. Une case occupée : les deux échangent leur place.`
        ),
        h(
          "button",
          {
            class: "button small ghost",
            onclick: () => {
              moving = null;
              draw();
            },
          },
          "Annuler"
        )
      );
    }
    if (!highlight) return null;
    const species = ctx.species.get(highlight);
    const name = species?.name ?? "Pokémon de cette espèce";
    const found = matches();
    const where = [...new Set(found.map((mon) => pc.boxes[boxOf(mon.pos)].name))].join(", ");
    return h(
      "p",
      { class: "notice pc-banner" },
      h(
        "span",
        {},
        found.length
          ? `${name} : ${fmt(found.length)} dans ta boîte, rangé${found.length > 1 ? "s" : ""} dans ${where}.`
          : `Aucun ${name} dans ta boîte.`
      ),
      h(
        "button",
        {
          class: "button small ghost",
          onclick: () => {
            highlight = null;
            draw();
          },
        },
        "Effacer"
      )
    );
  }

  // ---------------------- La grille ----------------------

  function grid() {
    const first = box * pc.slotsPerBox;
    const byPos = new Map(pc.pokemon.map((mon) => [mon.pos, mon]));
    const view = h(
      "div",
      { class: `pc-grid${moving ? " pc-choosing" : ""}` },
      Array.from({ length: pc.slotsPerBox }, (_, index) =>
        slot(first + index, byPos.get(first + index))
      )
    );
    view.style.setProperty("--columns", String(pc.columns));
    return view;
  }

  function slot(pos, mon) {
    const element = h(
      "div",
      {
        class: `pc-slot${mon && mon.speciesId === highlight ? " pc-match" : ""}${
          mon && mon.id === moving?.id ? " pc-moving" : ""
        }`,
        ondragover: (event) => {
          if (!dragging) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          element.classList.add("pc-over");
        },
        ondragleave: () => element.classList.remove("pc-over"),
        ondrop: (event) => {
          event.preventDefault();
          const id = dragging;
          endDrag();
          if (id) move(id, pos);
        },
      },
      mon ? monButton(mon, pos) : null
    );
    // Une case vide se choisit aussi, en mode « Déplacer ».
    if (!mon && moving) {
      element.append(
        h("button", {
          class: "pc-empty",
          "aria-label": `Case ${(pos % pc.slotsPerBox) + 1}`,
          onclick: () => move(moving.id, pos),
        })
      );
    }
    return element;
  }

  function monButton(mon, pos) {
    const species = ctx.species.get(mon.speciesId);
    // Le nom au survol et pour les lecteurs d'écran : la case n'en montre rien.
    const name =
      [mon.nickname, species?.name ?? "?"].filter(Boolean).join(" · ") +
      `${mon.shiny ? " shiny" : ""} #${mon.id}${mon.locked ? " · verrouillé" : ""}`;
    return h(
      "button",
      {
        class: "pc-mon",
        draggable: "true",
        title: name,
        "aria-label": name,
        onclick: () => {
          if (!moving) return openPokemon(ctx, mon, pc, { reload, startMove });
          // En mode « Déplacer », toucher un autre Pokémon échange leurs places ;
          // toucher celui qu'on déplace abandonne.
          if (moving.id !== mon.id) return move(moving.id, pos);
          moving = null;
          draw();
        },
        ondragstart: (event) => {
          moving = null;
          dragging = mon.id;
          dragSource = event.currentTarget;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", `#${mon.id}`);
          body.classList.add("pc-dragging");
        },
        ondragend: endDrag,
      },
      h("img", {
        src: mon.shiny ? species?.iconShiny : species?.icon,
        alt: "",
        loading: "lazy",
        draggable: "false",
      }),
      mon.locked ? icon("shield", { className: "pc-lock" }) : null
    );
  }

  function endDrag() {
    dragging = null;
    dragSource = null;
    flip = { direction: 0, since: 0, last: 0 };
    stash.replaceChildren();
    body.classList.remove("pc-dragging");
    for (const over of body.querySelectorAll(".pc-over")) over.classList.remove("pc-over");
  }

  function startMove(mon) {
    moving = mon;
    draw();
  }

  function summary() {
    const inBox = pc.pokemon.filter((mon) => boxOf(mon.pos) === box).length;
    return h(
      "p",
      { class: "muted small pc-summary" },
      `${fmt(inBox)} / ${fmt(pc.slotsPerBox)} dans cette boîte · ${fmt(pc.pokemon.length)} Pokémon en tout. `,
      "Glisse un Pokémon pour le ranger, ou ouvre sa fiche et choisis « Déplacer »."
    );
  }

  // Échap abandonne un déplacement en cours.
  const onKey = (event) => {
    if (event.key !== "Escape" || !moving) return;
    moving = null;
    draw();
  };
  document.addEventListener("keydown", onKey);
  ctx.onLeave(() => document.removeEventListener("keydown", onKey));

  draw();
  return h("section", { class: "view" }, body);
}

// ---------------------- La fiche ----------------------

function openPokemon(ctx, item, pc, { reload, startMove }) {
  const species = ctx.species.get(item.speciesId);
  if (!species) return;
  const ball = item.ball ? ctx.balls.get(item.ball) : null;
  const done = async () => {
    dialog.close();
    await Promise.all([ctx.refreshMe().catch(() => {}), reload()]);
  };

  const title = h("h2", {}, pokemonName(species, item.shiny, item.sex, item.nickname));
  const subtitle = () =>
    [`#${item.id}`, dexNumber(species), item.nickname ? species.name : null]
      .filter(Boolean)
      .join(" · ");
  const subtitleLine = h("p", { class: "muted" }, subtitle());

  const box = Math.floor(item.pos / pc.slotsPerBox);
  const value = item.shiny ? species.sellValueShiny : species.sellValue;
  const facts = h(
    "dl",
    { class: "facts" },
    h("dt", {}, "Rangé"),
    h("dd", {}, `${pc.boxes[box].name}, case ${(item.pos % pc.slotsPerBox) + 1}`),
    h("dt", {}, "Provenance"),
    h(
      "dd",
      {},
      ball ? [itemIcon(ball), " ", ball.label, " · "] : null,
      ORIGINS[item.origin] ?? item.origin
    ),
    h("dt", {}, "Arrivé le"),
    h("dd", {}, dateFr(item.obtainedAt)),
    h("dt", {}, "Fertilité"),
    h("dd", {}, item.fertile ? "Fertile" : "Stérile (a déjà pondu)"),
    h("dt", {}, "Capture"),
    h("dd", {}, `Taux ${species.catchRate} / 255`),
    h("dt", {}, "Revente"),
    h("dd", {}, value ? `${fmt(value)} pts` : "Ne se revend pas")
  );

  // La lignée arrive après la fiche : elle demande une lecture de plus, et la
  // fiche est lisible sans elle.
  const lineage = h("div", { class: "lineage-slot" });
  loadLineage(species.id)
    .then((links) =>
      lineage.replaceWith(lineageView(ctx, links, { currentId: species.id, shiny: item.shiny }))
    )
    .catch(() => lineage.remove());

  // Le surnom : vide, le Pokémon reprend le nom de son espèce.
  const nickname = h("input", {
    type: "text",
    value: item.nickname ?? "",
    placeholder: species.name,
    maxlength: pc.nicknameLength,
    "aria-label": "Surnom",
  });
  const tidy = h(
    "div",
    { class: "action" },
    h("h3", {}, "Ranger"),
    h(
      "form",
      {
        class: "inline-form",
        onsubmit: async (event) => {
          event.preventDefault();
          try {
            const result = await api(`/api/me/pokemon/${item.id}/nickname`, {
              method: "POST",
              body: { nickname: nickname.value },
            });
            item.nickname = result.nickname;
            nickname.value = result.nickname ?? "";
            title.replaceChildren(pokemonName(species, item.shiny, item.sex, item.nickname));
            subtitleLine.textContent = subtitle();
            toast(
              result.nickname ? `Il s'appelle désormais **${result.nickname}**.` : "Surnom retiré.",
              "success"
            );
            reload();
          } catch (error) {
            toast(error.message, "error");
          }
        },
      },
      nickname,
      h("button", { class: "button", type: "submit" }, "Renommer")
    ),
    h(
      "button",
      {
        class: "button",
        onclick: () => {
          dialog.close();
          startMove(item);
        },
      },
      icon("move"),
      "Déplacer"
    )
  );

  const dialog = openDialog(
    h(
      "div",
      { class: "dialog-head" },
      h("img", {
        class: "artwork",
        src: item.shiny ? species.spriteShiny : species.sprite,
        alt: "",
      }),
      title,
      subtitleLine,
      speciesChips(ctx, species)
    ),
    facts,
    lineage,
    h(
      "div",
      { class: "actions" },
      tidy,
      item.last
        ? h(
            "p",
            { class: "notice" },
            icon("pin"),
            ` C'est ton dernier ${species.name}, shiny ou non : il garde ton entrée du Pokédex, donc il ne peut ni partir ni évoluer.`
          )
        : [
            // Verrouillé, il ne se revend pas : on le dit au lieu du bouton.
            item.locked
              ? h(
                  "p",
                  { class: "notice" },
                  icon("shield"),
                  " Verrouillé : il ne sera ni revendu, ni échangé, ni sacrifié."
                )
              : sellAction(item, species, done),
            evolveAction(ctx, item, species, done),
          ],
      lockAction(item, done)
    )
  );
}

// Le verrou, comme /pk verrou : un Pokémon verrouillé ne part jamais, mais
// peut encore évoluer, après confirmation, et pondre.
function lockAction(item, done) {
  const button = h(
    "button",
    { class: "button" },
    icon("shield"),
    item.locked ? " Déverrouiller" : " Verrouiller"
  );
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await api(`/api/me/pokemon/${item.id}/lock`, {
        method: "POST",
        body: { locked: !item.locked },
      });
      toast(
        result.locked ? `#${item.id} est verrouillé.` : `#${item.id} est déverrouillé.`,
        "success"
      );
      await done();
    } catch (error) {
      toast(error.message, "error");
      button.disabled = false;
    }
  });
  return h(
    "div",
    { class: "action" },
    h("h3", {}, "Verrou"),
    h(
      "p",
      { class: "muted small" },
      item.locked
        ? "Verrouillé, il ne part jamais : ni revente, ni échange, ni sacrifice."
        : "Verrouiller le protège de la revente, des échanges et des sacrifices."
    ),
    button
  );
}

function sellAction(item, species, done) {
  const value = item.shiny ? species.sellValueShiny : species.sellValue;
  if (!value)
    return h(
      "p",
      { class: "muted small" },
      `${species.name}${item.shiny ? " shiny" : ""} ne se revend pas.`
    );
  return h(
    "div",
    { class: "action" },
    h("h3", {}, "Revendre"),
    confirmButton(
      `Revendre · ${fmt(value)} pts`,
      `Confirmer la revente · ${fmt(value)} pts`,
      async () => {
        try {
          const result = await api("/api/me/sell", {
            method: "POST",
            body: { pokemonId: item.id },
          });
          toast(`#${item.id} revendu pour ${fmt(result.points)} pts.`, "success");
          await done();
        } catch (error) {
          toast(error.message, "error");
        }
      }
    )
  );
}

function evolveAction(ctx, item, species, done) {
  const targets = species.evolvesInto.map((id) => ctx.species.get(id)).filter(Boolean);
  if (!targets.length) return null;
  let targetId = null;
  // Verrouillé, il évolue quand même, mais après un second clic : on ne le
  // bloque pas, on prévient. L'API refuse sans `confirmLocked`, et dit `locked`
  // si le verrou a été posé depuis Discord après l'ouverture de la fiche : le
  // bouton passe alors en confirmation.
  let locked = item.locked;
  const cost = h("p", { class: "muted small" }, "Calcul du coût…");
  let button = makeButton();
  button.disabled = true;

  // Le coût vient de l'API, qui le calcule comme la commande : une forme
  // choisie sur une lignée à embranchement coûte plus cher que le hasard.
  async function refresh() {
    button.disabled = true;
    try {
      const plan = await api(
        `/api/species/${species.id}/evolution${targetId ? `?targetId=${targetId}` : ""}`
      );
      const into = plan.target ? ctx.species.get(plan.target)?.name : "une forme tirée au hasard";
      const others = plan.sacrifices;
      cost.textContent =
        `Devient ${into}. Il faut ${plan.required} ${species.name}, shiny ou non : ` +
        `celui-ci évolue, ${others > 0 ? `${others} autre${others > 1 ? "s sont sacrifiés" : " est sacrifié"} (les normaux d'abord), ` : ""}` +
        `et un reste. Coût : ${fmt(plan.points)} pts.`;
      button.disabled = false;
    } catch (error) {
      cost.replaceChildren(...richText(error.message));
    }
  }

  async function evolveNow() {
    try {
      // L'espèce attendue accompagne l'individu : un second envoi sur un
      // Pokémon qui vient d'évoluer est refusé au lieu de le refaire évoluer.
      const body = {
        pokemonId: item.id,
        speciesId: species.id,
        ...(targetId ? { targetId } : {}),
        ...(locked ? { confirmLocked: true } : {}),
      };
      const result = await api("/api/me/evolve", { method: "POST", body });
      toast(
        `#${item.id} a évolué en ${ctx.species.get(result.pokemon.speciesId)?.name ?? "?"} !`,
        "success"
      );
      await done();
    } catch (error) {
      if (error.details?.locked && !locked) {
        locked = true;
        rebuild();
        toast(`#${item.id} est verrouillé : confirme pour le faire évoluer quand même.`);
        return;
      }
      toast(error.message, "error");
    }
  }

  // Le même confirmButton que la revente pour un verrouillé ; un bouton simple
  // sinon.
  function makeButton() {
    if (locked) {
      return confirmButton("Évoluer", "Il est verrouillé : évoluer quand même ?", evolveNow);
    }
    const plain = h("button", { class: "button primary" }, "Évoluer");
    plain.addEventListener("click", async () => {
      plain.disabled = true;
      await evolveNow();
      plain.disabled = false;
    });
    return plain;
  }

  // Un bouton neuf : changer de forme désarme une confirmation en cours. Il
  // naît actif ; refresh() le grise le temps de relire le coût.
  function rebuild() {
    const next = makeButton();
    button.replaceWith(next);
    button = next;
  }

  const choice =
    targets.length > 1
      ? h(
          "select",
          {
            onchange: (event) => {
              targetId = event.target.value ? Number(event.target.value) : null;
              rebuild();
              refresh();
            },
          },
          h("option", { value: "" }, "Forme au hasard"),
          targets.map((target) => h("option", { value: target.id }, `Choisir ${target.name}`))
        )
      : null;

  refresh();
  return h("div", { class: "action" }, h("h3", {}, "Faire évoluer"), choice, cost, button);
}
