// L'administration du site : la courbe des points et la configuration du bot
// en arbre. Réservée à SYDNEC_USER_ID — l'API le vérifie à chaque requête, le
// lien du menu n'est qu'un confort. Un réglage s'écrit par le même chemin que
// /admin config (writeConfigValue), avec les mêmes refus, et s'applique
// aussitôt : le bot relit sa configuration à chaque usage.
import { lineChart, lineKey } from "../chart.js";
import { api, fmt, h, normalize, richText, toast } from "../lib.js";

const plural = (count, word) => `${count} ${word}${count > 1 ? "s" : ""}`;

// Une valeur telle qu'on la lit et qu'on la saisit : une liste séparée par des
// virgules, comme dans /admin config.
function display(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "oui" : "non";
  return String(value);
}

// Toutes les feuilles d'une branche, pour ses compteurs.
const leavesOf = (node) => (node.children ? node.children.flatMap(leavesOf) : [node]);

export async function render() {
  let data = await api("/api/admin/config");
  // Les branches ouvertes et le filtre survivent à la relecture qui suit un
  // enregistrement : on ne perd pas de vue le réglage qu'on vient de changer.
  const open = new Set();
  let query = "";
  let onlyModified = false;

  const status = h("div");
  const tree = h("div", { class: "config-tree" });

  async function reload() {
    try {
      data = await api("/api/admin/config");
    } catch (error) {
      toast(error.message, "error");
    }
    draw();
  }

  function draw() {
    // Une surcharge illisible fait retomber tous les réglages sur leurs défauts :
    // c'est ici qu'on viendrait constater qu'un réglage « n'a pas pris ».
    status.replaceChildren(
      ...(data.status.ok
        ? []
        : [h("p", { class: "notice error" }, h("span", {}, richText(data.status.reason)))])
    );
    const needle = normalize(query.trim());
    const nodes = data.tree.map((node) => nodeView(node, needle)).filter(Boolean);
    tree.replaceChildren(
      ...(nodes.length ? nodes : [h("p", { class: "muted" }, "Aucun réglage ne correspond.")])
    );
  }

  // Une branche ou un réglage, ou null si le filtre n'en laisse rien. Filtrer
  // ouvre les branches où il reste quelque chose.
  function nodeView(node, needle) {
    const filtering = Boolean(needle) || onlyModified;
    if (!node.children) {
      if (needle && !normalize(node.path).includes(needle)) return null;
      if (onlyModified && !node.modified) return null;
      return leafView(node);
    }
    const children = node.children.map((child) => nodeView(child, needle)).filter(Boolean);
    if (!children.length) return null;
    const leaves = leavesOf(node);
    const modified = leaves.filter((leaf) => leaf.modified).length;
    const details = h(
      "details",
      { class: "config-branch", open: filtering || open.has(node.path) },
      h(
        "summary",
        { title: node.path },
        h("span", { class: "config-key" }, node.key),
        h(
          "span",
          { class: "muted small" },
          plural(leaves.length, "réglage"),
          modified ? ` · ${plural(modified, "modifié")}` : ""
        )
      ),
      h("div", { class: "config-children" }, children)
    );
    details.addEventListener("toggle", () => {
      if (filtering) return;
      if (details.open) open.add(node.path);
      else open.delete(node.path);
    });
    return details;
  }

  async function save(leaf, value) {
    try {
      const result = await api("/api/admin/config", {
        method: "POST",
        body: { path: leaf.path, value },
      });
      toast(`**${result.path}** : ${display(result.before)} → ${display(result.after)}`, "success");
    } catch (error) {
      toast(error.message, "error");
    }
    await reload();
  }

  function leafView(leaf) {
    const { input, read } = control(leaf);
    const initial = JSON.stringify(read());
    const submit = h(
      "button",
      { class: "button small primary", type: "submit", hidden: true },
      "Enregistrer"
    );
    // Le bouton n'apparaît qu'une fois la valeur changée : l'arbre reste lisible.
    const dirty = () => {
      submit.hidden = JSON.stringify(read()) === initial;
    };
    input.addEventListener("input", dirty);
    input.addEventListener("change", dirty);

    return h(
      "form",
      {
        class: `config-leaf${leaf.modified ? " config-modified" : ""}`,
        onsubmit: (event) => {
          event.preventDefault();
          submit.disabled = true;
          save(leaf, read());
        },
      },
      h(
        "div",
        { class: "config-label" },
        h("span", { class: "config-key", title: leaf.path }, leaf.key),
        // Comme /admin config-voir : la valeur par défaut, quand ce n'est pas elle.
        leaf.modified
          ? h("span", { class: "muted small" }, `défaut : ${display(leaf.fallback)}`)
          : null
      ),
      h("div", { class: "config-control" }, input, submit)
    );
  }

  const search = h("input", {
    type: "search",
    placeholder: "Filtrer : spawn, shiny, price…",
    "aria-label": "Filtrer les réglages",
    oninput: (event) => {
      query = event.target.value;
      draw();
    },
  });
  const modifiedOnly = h(
    "label",
    { class: "config-toggle" },
    h("input", {
      type: "checkbox",
      onchange: (event) => {
        onlyModified = event.target.checked;
        draw();
      },
    }),
    " Modifiés seulement"
  );

  draw();
  return h(
    "section",
    { class: "view config" },
    h("div", { class: "view-head" }, h("h1", {}, "Administration")),
    pointsSection(),
    h(
      "section",
      { class: "admin-section" },
      h("h2", {}, "Configuration"),
      h(
        "p",
        { class: "muted" },
        "La configuration du bot, appliquée dès l'enregistrement. Comme /admin config sur Discord."
      ),
      status,
      h("div", { class: "toolbar" }, search, modifiedOnly),
      tree
    )
  );
}

// ---------------------- Points ----------------------

// Les périodes proposées au-dessus de la courbe, en jours ; null : tout le
// journal.
const PERIODS = [
  [1, "24 h"],
  [7, "7 j"],
  [30, "30 j"],
  [90, "90 j"],
  [null, "Tout"],
];

// Huit couleurs se distinguent encore, pas davantage : au-delà, les courbes
// séparées se confondraient. La somme, elle, n'a qu'un trait.
const MAX_SERIES = 8;

// Les lignes du tableau : quelques instants répartis sur la période, le
// premier et le dernier compris.
const TABLE_ROWS = 12;

// La somme des soldes à chaque instant ; null quand aucun n'est connu.
function sumValues(trainers, length) {
  return Array.from({ length }, (_, index) => {
    const known = trainers.map((entry) => entry.values[index]).filter((value) => value !== null);
    return known.length ? known.reduce((total, value) => total + value, 0) : null;
  });
}

// La courbe des soldes, lue dans le journal des points. On coche les dresseurs
// un à un : leurs soldes s'additionnent en une courbe, ou se comparent en
// courbes séparées. Tout arrive en une requête par période, pour que cocher et
// décocher ne demande rien au serveur.
function pointsSection() {
  let days = 7;
  let split = false;
  let data = null;
  let query = "";
  // Les dresseurs cochés, et ceux que la page a déjà vus. Tout le monde est
  // coché au premier affichage — la somme de tous les soldes, les points en
  // circulation —, et un nouveau venu l'est aussi tant que tout le monde l'est.
  const checked = new Set();
  const seen = new Set();
  // La couleur de chaque courbe séparée suit son dresseur : décocher les autres
  // ne la change pas.
  const slots = new Map();
  // Les traits de couleur de la liste, et la couleur des courbes séparées
  // tracées : la légende ne montre que ce qui est à l'écran.
  const keys = new Map();
  let drawn = new Map();
  // Seule la dernière période demandée s'affiche : la réponse lente d'une
  // période quittée entre-temps arrive trop tard.
  let request = 0;

  const summary = h("p", { class: "points-summary" });
  const chartBox = h("div", { class: "points-chart" });
  // Le tableau reste le même élément d'un tracé à l'autre : ouvert, il le reste.
  const tableBody = h("div", { class: "points-table-scroll" });
  const table = h(
    "details",
    { class: "points-table", hidden: true },
    h("summary", {}, "Tableau des valeurs"),
    tableBody
  );
  const list = h("div", { class: "points-list" });

  async function load(period) {
    const ticket = ++request;
    chartBox.classList.add("refreshing");
    try {
      const fresh = await api(`/api/admin/points${period ? `?days=${period}` : ""}`);
      if (ticket !== request) return;
      const everyone = [...seen].every((id) => checked.has(id));
      for (const entry of fresh.trainers) {
        if (!seen.has(entry.id) && everyone) checked.add(entry.id);
        seen.add(entry.id);
      }
      data = fresh;
      days = period;
      drawList();
      drawChart();
    } catch (error) {
      if (ticket === request) toast(error.message, "error");
    } finally {
      // Réussie ou non, la période sélectionnée redevient celle qui s'affiche.
      if (ticket === request) {
        chartBox.classList.remove("refreshing");
        periods.sync();
      }
    }
  }

  // Les courbes à tracer, ou la raison de n'en tracer aucune.
  function currentSeries() {
    const chosen = data.trainers.filter((entry) => checked.has(entry.id));
    for (const id of slots.keys()) if (!checked.has(id)) slots.delete(id);
    if (data.times.length < 2) {
      return "Le journal des points vient de commencer : la courbe se dessinera au fil des mouvements.";
    }
    if (!chosen.length) return "Coche au moins un dresseur.";
    if (!split) {
      return [
        {
          label: chosen.length === 1 ? chosen[0].name : `Somme de ${chosen.length} dresseurs`,
          slot: 1,
          values: sumValues(chosen, data.times.length),
        },
      ];
    }
    if (chosen.length > MAX_SERIES) {
      return (
        `${chosen.length} dresseurs cochés : ${MAX_SERIES} courbes séparées au plus. ` +
        "Décoches-en, ou additionne-les."
      );
    }
    const used = new Set(slots.values());
    for (const entry of chosen) {
      if (slots.has(entry.id)) continue;
      const free = Array.from({ length: MAX_SERIES }, (_, index) => index + 1).find(
        (slot) => !used.has(slot)
      );
      slots.set(entry.id, free);
      used.add(free);
    }
    return chosen.map((entry) => ({
      id: entry.id,
      label: entry.name,
      slot: slots.get(entry.id),
      values: entry.values,
    }));
  }

  function drawChart() {
    const series = currentSeries();
    drawn = new Map();
    if (typeof series === "string") {
      summary.replaceChildren();
      chartBox.replaceChildren(h("p", { class: "muted empty" }, series));
      table.hidden = true;
    } else {
      drawSummary(series);
      chartBox.replaceChildren(
        lineChart({ times: data.times, series, labels: series.length > 1 && series.length <= 4 })
      );
      tableBody.replaceChildren(valuesTable(series));
      table.hidden = false;
      // Le trait de couleur de la liste ne sert de légende qu'aux courbes séparées.
      if (split) for (const entry of series) drawn.set(entry.id, entry.slot);
    }
    drawKeys();
  }

  function drawKeys() {
    for (const [id, key] of keys) key.replaceChildren(drawn.has(id) ? lineKey(drawn.get(id)) : "");
  }

  // Une seule courbe : ce qu'elle représente, son solde actuel et ce qu'il a
  // gagné ou perdu sur la période. Plusieurs : leurs noms sont au bout des traits.
  function drawSummary(series) {
    if (series.length !== 1) return summary.replaceChildren();
    const known = series[0].values.filter((value) => value !== null);
    if (!known.length) return summary.replaceChildren();
    const change = known[known.length - 1] - known[0];
    summary.replaceChildren(
      `${series[0].label} : `,
      h("strong", {}, `${fmt(known[known.length - 1])} points`),
      h(
        "span",
        { class: "muted" },
        ` · ${change > 0 ? "+" : change < 0 ? "−" : ""}${fmt(Math.abs(change))} sur la période`
      )
    );
  }

  // La même chose en chiffres, pour qui ne distingue pas les couleurs.
  function valuesTable(series) {
    const last = data.times.length - 1;
    const rows = [
      ...new Set(
        Array.from({ length: TABLE_ROWS }, (_, index) =>
          Math.round((index * last) / (TABLE_ROWS - 1))
        )
      ),
    ];
    const moment = (time) =>
      new Date(time).toLocaleString("fr-FR", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    return h(
      "table",
      { class: "rules-table" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", {}, "Date"),
          series.map((entry) => h("th", {}, entry.label))
        )
      ),
      h(
        "tbody",
        {},
        rows.map((index) =>
          h(
            "tr",
            {},
            h("td", {}, moment(data.times[index])),
            series.map((entry) =>
              h("td", {}, entry.values[index] === null ? "—" : fmt(entry.values[index]))
            )
          )
        )
      )
    );
  }

  // Les dresseurs du plus riche au plus pauvre, filtrés par le champ de
  // recherche. Cocher ne redessine que la courbe : la liste garde le focus.
  function drawList() {
    const needle = normalize(query.trim());
    const visible = data.trainers.filter(
      (entry) => !needle || normalize(entry.name).includes(needle)
    );
    keys.clear();
    list.replaceChildren(
      ...(visible.length
        ? visible.map((entry) => {
            const key = h("span", { class: "points-key" });
            keys.set(entry.id, key);
            return h(
              "label",
              { class: "points-row" },
              h("input", {
                type: "checkbox",
                checked: checked.has(entry.id),
                onchange: (event) => {
                  if (event.target.checked) checked.add(entry.id);
                  else checked.delete(entry.id);
                  drawChart();
                },
              }),
              key,
              h("span", { class: "points-name" }, entry.name),
              h("span", { class: "points-balance muted" }, fmt(entry.balance))
            );
          })
        : [h("p", { class: "muted" }, "Aucun dresseur ne correspond.")])
    );
  }

  // Tout cocher ou tout décocher agit sur les dresseurs que le filtre montre.
  function checkVisible(value) {
    if (!data) return;
    const needle = normalize(query.trim());
    for (const entry of data.trainers) {
      if (needle && !normalize(entry.name).includes(needle)) continue;
      if (value) checked.add(entry.id);
      else checked.delete(entry.id);
    }
    drawList();
    drawChart();
  }

  // Des boutons à choix unique. Le bouton cliqué s'allume tout de suite ;
  // `sync` rallume celui que `isActive` désigne.
  const segmented = (options, isActive, choose) => {
    const mark = (current) =>
      buttons.forEach((button, index) => {
        const on = options[index][0] === current;
        button.classList.toggle("active", on);
        button.setAttribute("aria-pressed", String(on));
      });
    const buttons = options.map(([value, label]) =>
      h(
        "button",
        {
          type: "button",
          onclick: () => {
            mark(value);
            choose(value);
          },
        },
        label
      )
    );
    const sync = () => mark(options.find(([value]) => isActive(value))?.[0]);
    sync();
    return { element: h("div", { class: "segmented" }, buttons), sync };
  };

  const periods = segmented(
    PERIODS,
    (value) => value === days,
    (value) => load(value)
  );
  const modes = segmented(
    [
      [false, "Somme"],
      [true, "Séparées"],
    ],
    (value) => value === split,
    (value) => {
      split = value;
      if (data) drawChart();
    }
  );

  load(days);
  return h(
    "section",
    { class: "admin-section points" },
    h("h2", {}, "Points"),
    h("div", { class: "toolbar" }, periods.element, modes.element),
    summary,
    chartBox,
    table,
    h(
      "div",
      { class: "toolbar" },
      h("input", {
        type: "search",
        placeholder: "Filtrer les dresseurs",
        "aria-label": "Filtrer les dresseurs",
        // Le filtre ne change que la liste : la courbe reste celle des cochés.
        oninput: (event) => {
          query = event.target.value;
          if (!data) return;
          drawList();
          drawKeys();
        },
      }),
      h(
        "button",
        { type: "button", class: "button small", onclick: () => checkVisible(true) },
        "Tout cocher"
      ),
      h(
        "button",
        { type: "button", class: "button small", onclick: () => checkVisible(false) },
        "Tout décocher"
      )
    ),
    list
  );
}

// Le champ d'un réglage selon son type, et de quoi lire sa saisie comme
// /admin config l'attend : un nombre, oui/non, du texte, une liste séparée par
// des virgules.
function control(leaf) {
  if (leaf.type === "booléen") {
    const input = h("input", {
      type: "checkbox",
      checked: leaf.current === true,
      "aria-label": leaf.path,
    });
    return { input, read: () => input.checked };
  }
  if (leaf.type === "nombre") {
    const input = h("input", {
      type: "number",
      step: "any",
      value: String(leaf.current),
      min: leaf.min,
      max: leaf.max,
      required: true,
      "aria-label": leaf.path,
    });
    return { input, read: () => input.value };
  }
  const input = h("input", {
    type: "text",
    value: display(leaf.current),
    placeholder: leaf.type === "liste" ? "séparées par des virgules" : null,
    required: true,
    "aria-label": leaf.path,
  });
  return { input, read: () => input.value };
}
