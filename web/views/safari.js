// Le parc safari : la visite du dresseur, la même que l'éphémère Discord. Chaque
// action part par le même chemin que ses boutons (playAction), avec le même
// jeton anti-double-clic : le nombre d'actions restantes. Une visite commencée
// ici se reprend sur Discord avec /pk safari, et inversement.
//
// Sans visite en cours, la page propose ce que propose l'onglet Capture :
// entrer dans un parc ouvert ou acheter une entrée.
//
// À la sortie, le récapitulatif liste les prises avec leur état dans la boîte,
// à cocher pour les verrouiller, les déverrouiller ou les revendre d'un coup :
// chacune par le chemin de /pk verrou et /pk revendre.
import { icon } from "../icons.js";
import {
  api,
  colorChip,
  dateTimeFr,
  dexNumber,
  fmt,
  formMark,
  h,
  itemIcon,
  outcomePanel,
  ownedMark,
  percent,
  pokemonName,
  progressBar,
  richText,
  toast,
} from "../lib.js";
import { lineageView } from "../lineage.js";
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
  let sharing = false;
  let goingLive = false;
  // Le récapitulatif : les prises cochées (par individu), une action en cours,
  // la revente en attente de confirmation, et les refus de la dernière revente.
  const selected = new Set();
  let busy = false;
  let confirmingSale = false;
  let refusals = [];

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

  // Le bot publie dans le salon Pokémon, comme le bouton du bilan sur Discord :
  // même verrou en base, donc une seule publication par visite, d'où qu'elle vienne.
  async function share() {
    sharing = true;
    draw();
    try {
      await api("/api/safari/share", { method: "POST", body: { sessionId: visit.id } });
      visit.shared = true;
      toast("Bilan partagé dans le salon Pokémon.", "success");
    } catch (error) {
      // Déjà partagé (depuis Discord, ou un envoi incertain) : le verrou est pris,
      // le bouton se ferme plutôt que de promettre un nouvel essai.
      if (error.details?.shared) visit.shared = true;
      toast(error.message, "error");
    }
    sharing = false;
    draw();
  }

  // Le direct part dans le salon Pokémon, comme le bilan : le bot y publie la
  // rencontre et réécrit son message à chaque action, d'ici comme de Discord.
  // Même verrou que le bilan : une visite en direct ne se partage plus ensuite.
  async function goLive() {
    goingLive = true;
    draw();
    try {
      await api("/api/safari/live", { method: "POST", body: { sessionId: visit.id } });
      visit.live = true;
      visit.shared = true;
      toast("Ta visite est en direct dans le salon Pokémon.", "success");
    } catch (error) {
      if (error.details?.shared) visit.shared = true;
      toast(error.message, "error");
    }
    goingLive = false;
    draw();
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
    // Comme sur la Capture : pour un Zarbi, c'est sa lettre qu'on collectionne.
    const letter = formMark(species, encounter.form, encounter.forms);
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
        src: encounter.form?.sprite ?? (encounter.shiny ? species.spriteShiny : species.sprite),
        alt: species.name,
      }),
      h(
        "h2",
        { class: "spawn-title" },
        encounter.shiny ? [icon("sparkle", { label: "Shiny" }), " "] : null,
        "Un ",
        pokemonName(species, false, encounter.sex, null, encounter.form),
        encounter.shiny ? " shiny vous observe !" : " sauvage vous observe…"
      ),
      h(
        "p",
        { class: "spawn-meta muted" },
        dexNumber(species),
        // Collection illisible : la rencontre s'affiche sans la pastille.
        encounter.owned ? [" · ", ownedMark(encounter.owned, encounter.shiny)] : null,
        letter ? [" · ", letter] : null
      ),
      actions(encounter),
      panel ? actionPanel() : null,
      // La lignée et ce qu'on en possède, le même rendu que l'apparition de la
      // Capture et la fiche Discord. Collection illisible : on l'omet.
      encounter.lineage
        ? lineageView(ctx, encounter.lineage, {
            currentId: encounter.speciesId,
            shiny: encounter.shiny,
            forms: encounter.forms,
            currentForm: encounter.form?.key,
          })
        : null
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
    const rows = choosable();
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
      rows.length
        ? h("p", { class: "muted small" }, "Coche ceux que tu veux verrouiller ou revendre.")
        : null,
      count ? h("ul", { class: "safari-recap-list" }, visit.catches.map(catchRow)) : null,
      rows.length ? selectionBar(rows) : null,
      refusals.length
        ? h(
            "div",
            { class: "notice safari-recap-refusals" },
            h("span", {}, richText(refusals.join("\n")))
          )
        : null,
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
          : null,
        visit.shared
          ? h(
              "button",
              { class: "button ghost", disabled: true },
              visit.live ? "Bilan publié dans le direct" : "Bilan partagé"
            )
          : h(
              "button",
              { class: "button ghost", disabled: sharing, onclick: share },
              "Partager dans le salon Pokémon"
            )
      )
    );
  }

  // ---------------------- Le récapitulatif ----------------------

  // Les prises qu'on peut désigner : leur individu est encore dans la boîte.
  // `individual` vaut null pour un Pokémon parti depuis, et manque quand l'API
  // ne sait pas (prise d'avant le lien avec la boîte, lecture ratée).
  const choosable = () => visit.catches.filter((row) => row.individual);
  const chosen = () => choosable().filter((row) => selected.has(row.pokemonId));

  // L'espèce et la forme d'aujourd'hui : une prise a pu évoluer depuis la
  // visite, et c'est sous sa forme actuelle qu'elle se revend.
  const speciesOf = (row) => row.individual?.speciesId ?? row.speciesId;
  const formOf = (row) => (row.individual ? row.individual.form : row.form);

  // Le prix que l'API calcule pour l'espèce, comme la fiche de la boîte.
  function priceOf(row) {
    const species = ctx.species.get(speciesOf(row));
    return (row.individual.shiny ? species?.sellValueShiny : species?.sellValue) ?? 0;
  }

  // Ce que la revente laisserait partir : ni verrouillé, ni dernier de son
  // espèce, ni invendable. Le jeu revalide chacun.
  const sellableRow = (row) => !row.individual.locked && !row.individual.last && priceOf(row) > 0;

  // Pourquoi il ne se revend pas, ou ce qu'il rapporterait.
  function saleStatus(row) {
    if (row.individual.locked) return "verrouillé";
    if (row.individual.last) return "dernier de son espèce";
    const price = priceOf(row);
    return price > 0 ? `${fmt(price)} pts` : "ne se revend pas";
  }

  function catchRow(row) {
    const species = ctx.species.get(speciesOf(row));
    if (!species) return null;
    const mon = row.individual;
    const form = formOf(row);
    const image = h("img", {
      class: "sprite",
      src: form?.icon ?? (row.shiny ? species.iconShiny : species.icon),
      alt: "",
      width: 48,
      height: 48,
    });
    const name = (detail) =>
      h(
        "span",
        { class: "safari-recap-name" },
        pokemonName(species, row.shiny, mon?.sex ?? null, mon?.nickname ?? null, form),
        detail ? h("span", { class: "muted small" }, detail) : null
      );
    if (!mon) {
      return h(
        "li",
        { class: `safari-recap-row${mon === null ? " safari-recap-gone" : ""}` },
        h(
          "div",
          { class: "safari-recap-item" },
          // La place de la case à cocher : les sprites restent alignés.
          h("span", { class: "safari-recap-check" }),
          image,
          name(mon === null ? "n'est plus dans ta boîte" : null)
        )
      );
    }
    const checked = selected.has(row.pokemonId);
    return h(
      "li",
      { class: `safari-recap-row${checked ? " safari-recap-selected" : ""}` },
      h(
        "label",
        { class: "safari-recap-item" },
        h("input", {
          type: "checkbox",
          class: "safari-recap-check",
          checked,
          disabled: busy,
          onchange: () => {
            if (selected.has(row.pokemonId)) selected.delete(row.pokemonId);
            else selected.add(row.pokemonId);
            confirmingSale = false;
            draw();
          },
        }),
        image,
        name(`#${mon.id}`),
        mon.locked ? icon("shield", { label: "Verrouillé" }) : null,
        h("span", { class: "muted small safari-recap-status" }, saleStatus(row))
      )
    );
  }

  function selectionBar(rows) {
    const picked = chosen();
    const sellable = picked.filter(sellableRow);
    const total = sellable.reduce((sum, row) => sum + priceOf(row), 0);
    // Deux de la même espèce peuvent buter sur « le dernier reste » : le total
    // n'est alors qu'un plafond, et le compte rendu dira ce qui est parti.
    const species = sellable.map(speciesOf);
    const ceiling = new Set(species).size < species.length ? "jusqu'à " : "";
    const pickAll = (ids) => {
      selected.clear();
      for (const id of ids) selected.add(id);
      confirmingSale = false;
      draw();
    };
    const button = (label, onclick, { kind = "ghost", disabled = false } = {}) =>
      h("button", { class: `button small ${kind}`, disabled: busy || disabled, onclick }, label);

    return h(
      "div",
      { class: "notice safari-recap-bar" },
      h(
        "span",
        {},
        picked.length
          ? `${fmt(picked.length)} Pokémon sélectionné${picked.length > 1 ? "s" : ""}.`
          : "Aucun Pokémon sélectionné."
      ),
      h(
        "div",
        { class: "safari-recap-actions" },
        button("Tout", () => pickAll(rows.map((row) => row.pokemonId)), {
          disabled: picked.length === rows.length,
        }),
        button("Aucun", () => pickAll([]), { disabled: !picked.length }),
        button("Verrouiller", () => lockChosen(true), {
          disabled: !picked.some((row) => !row.individual.locked),
        }),
        button("Déverrouiller", () => lockChosen(false), {
          disabled: !picked.some((row) => row.individual.locked),
        }),
        button(
          "Revendre",
          () => {
            confirmingSale = true;
            draw();
          },
          { kind: "danger", disabled: !sellable.length || confirmingSale }
        )
      ),
      confirmingSale && sellable.length
        ? h(
            "div",
            { class: "safari-recap-confirm" },
            h(
              "p",
              {},
              "Revendre ",
              h("strong", {}, `${fmt(sellable.length)} Pokémon`),
              " pour ",
              h("strong", {}, `${ceiling}${fmt(total)} pts`),
              " ? Ils ne reviendront pas.",
              picked.length > sellable.length
                ? ` Les ${fmt(picked.length - sellable.length)} autres de ta sélection restent : ` +
                    "verrouillés, derniers de leur espèce ou invendables."
                : null
            ),
            h(
              "div",
              { class: "confirm-actions" },
              button("Revendre", () => sellChosen(sellable), { kind: "danger" }),
              button("Annuler", () => {
                confirmingSale = false;
                draw();
              })
            )
          )
        : null
    );
  }

  // Le même verrou sur toute la sélection, par la route de /pk verrou en groupe.
  async function lockChosen(locked) {
    const ids = chosen()
      .filter((row) => row.individual.locked !== locked)
      .map((row) => row.pokemonId);
    busy = true;
    confirmingSale = false;
    refusals = [];
    draw();
    try {
      const result = await api("/api/me/pokemon/lock-many", {
        method: "POST",
        body: { pokemonIds: ids, locked },
      });
      const plural = result.changed > 1 ? "s" : "";
      toast(
        `${fmt(result.changed)} Pokémon ${locked ? "verrouillé" : "déverrouillé"}${plural}.` +
          (result.skipped
            ? ` ${fmt(result.skipped)} n'étai${result.skipped > 1 ? "en" : ""}t plus dans ta boîte.`
            : ""),
        "success"
      );
    } catch (error) {
      toast(error.message, "error");
    }
    await refreshCatches();
  }

  // La revente des cochés qui peuvent partir : chacun par le chemin de
  // /pk revendre. Les refus (un dernier de son espèce atteint en cours de
  // route, un verrou posé depuis Discord) restent affichés sous la liste.
  async function sellChosen(rows) {
    busy = true;
    confirmingSale = false;
    refusals = [];
    draw();
    try {
      const result = await api("/api/me/sell-many", {
        method: "POST",
        body: { pokemonIds: rows.map((row) => row.pokemonId) },
      });
      refusals = result.refused.map((row) => row.reason);
      const sold = result.sold.length;
      toast(
        sold
          ? `${fmt(sold)} Pokémon revendu${sold > 1 ? "s" : ""} pour ${fmt(result.points)} pts.`
          : "Rien n'a été revendu.",
        sold && !result.failed ? "success" : "error"
      );
      if (sold) ctx.refreshMe().catch(() => {});
    } catch (error) {
      toast(error.message, "error");
    }
    await refreshCatches();
  }

  // Relit l'état des prises après une action : un verrou, une revente, et le
  // dernier de chaque espèce a pu changer. La visite finie ne se relit plus,
  // ses Pokémon si. Un Pokémon parti sort de la sélection.
  async function refreshCatches() {
    const ids = visit.catches
      .filter((row) => row.pokemonId && row.individual !== undefined)
      .map((row) => row.pokemonId);
    try {
      const { pokemon } = ids.length
        ? await api(`/api/me/pokemon?ids=${ids.join(",")}`)
        : { pokemon: [] };
      const byId = new Map(pokemon.map((mon) => [mon.id, mon]));
      for (const row of visit.catches) {
        if (row.individual !== undefined) row.individual = byId.get(row.pokemonId) ?? null;
      }
    } catch (error) {
      toast(error.message, "error");
    }
    const still = new Set(choosable().map((row) => row.pokemonId));
    for (const id of [...selected]) if (!still.has(id)) selected.delete(id);
    busy = false;
    draw();
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
        : [
            h(
              "p",
              { class: "muted small" },
              `Visite ouverte jusqu'au ${dateTimeFr(visit.expiresAt)}.`
            ),
            // Une visite expirée que le balayage n'a pas encore close : le
            // direct serait refusé, le bouton ne promet rien.
            visit.expiresAt <= Date.now()
              ? null
              : visit.shared
                ? h(
                    "p",
                    { class: "muted small" },
                    visit.live ? "En direct dans le salon Pokémon." : "Visite déjà partagée."
                  )
                : h(
                    "button",
                    { class: "button ghost", disabled: goingLive, onclick: goLive },
                    "Partager en direct"
                  ),
          ]
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
                    src: row.form?.icon ?? (row.shiny ? species.iconShiny : species.icon),
                    alt: species.name,
                    title: `${species.name}${row.form ? ` ${row.form.name}` : ""}${row.shiny ? " shiny" : ""}`,
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
