// L'administration du site : la configuration du bot en arbre. Réservée à
// SYDNEC_USER_ID — l'API le vérifie à chaque requête, le lien du menu n'est
// qu'un confort. Un réglage s'écrit par le même chemin que /admin config
// (writeConfigValue), avec les mêmes refus, et s'applique aussitôt : le bot
// relit sa configuration à chaque usage.
import { api, h, normalize, richText, toast } from "../lib.js";

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
    h(
      "div",
      { class: "view-head" },
      h("h1", {}, "Administration"),
      h(
        "p",
        { class: "muted" },
        "La configuration du bot, appliquée dès l'enregistrement. Comme /admin config sur Discord."
      )
    ),
    status,
    h("div", { class: "toolbar" }, search, modifiedOnly),
    tree
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
