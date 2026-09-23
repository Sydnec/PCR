// Petits outils partagés par les pages du site.

// Appel à l'API. Une réponse d'erreur devient une exception qui porte le
// message du serveur, déjà rédigé pour le joueur.
export async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  // Le corps se lit toujours, même vide (204) : un corps laissé en plan, le
  // navigateur finit par annuler la requête et le signale comme une erreur.
  const text = await response.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data?.error ?? `Le serveur a répondu ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return data;
}

// h("div", { class: "x", onclick }, enfants…) : le DOM sans innerHTML, donc
// aucun pseudo ni nom ne peut s'y glisser en HTML.
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on")) element.addEventListener(key.slice(2), value);
    else if (key === "class") element.className = value;
    else element.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : String(child));
  }
  return element;
}

const numbers = new Intl.NumberFormat("fr-FR");
export const fmt = (value) => numbers.format(value);

export const dateFr = (ms) =>
  new Date(ms).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

export const dateTimeFr = (ms) =>
  new Date(ms).toLocaleString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

// Recherche insensible aux accents et à la casse, comme l'autocomplétion du
// bot : « evoli » trouve « Évoli ».
export const normalize = (text) =>
  String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

// Un emoji du serveur (`<:nom:id>`) devient son image sur le CDN de Discord ;
// un emoji ordinaire reste du texte.
export function emoji(text, label = "") {
  const match = /^<(a?):\w+:(\d+)>$/.exec(text ?? "");
  if (!match) return h("span", { class: "emoji", "aria-hidden": "true" }, text ?? "");
  const extension = match[1] ? "gif" : "png";
  return h("img", {
    class: "emoji",
    src: `https://cdn.discordapp.com/emojis/${match[2]}.${extension}?size=48`,
    alt: label,
    title: label,
  });
}

export function avatarUrl(user) {
  if (user.avatar)
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
  // L'avatar par défaut de Discord, choisi comme lui le choisit.
  return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
}

const SEXES = { M: { symbol: "♂", label: "mâle" }, F: { symbol: "♀", label: "femelle" } };

export function sexMark(sex) {
  const info = SEXES[sex];
  return info ? h("span", { class: `sex sex-${sex}`, title: info.label }, info.symbol) : null;
}

// Le nom d'un Pokémon, avec son sexe et son éclat. Nidoran porte déjà le sien
// dans son nom : on ne le répète pas.
export function pokemonName(species, shiny = false, sex = null) {
  const name = species?.name ?? "?";
  const carries = name.includes("♂") || name.includes("♀");
  const sexNode = carries ? null : sexMark(sex);
  return h(
    "span",
    { class: "pokemon-name" },
    name,
    sexNode ? [" ", sexNode] : null,
    shiny ? [" ", h("span", { class: "shiny-mark", title: "Shiny" }, "✨")] : null
  );
}

// Les messages du jeu sont écrits pour Discord : on retire le gras Markdown.
const plain = (text) => String(text).replace(/\*\*|`/g, "");

export function toast(message, kind = "info") {
  const box = document.getElementById("toasts");
  const item = h("div", { class: `toast toast-${kind}`, role: "status" }, plain(message));
  box.append(item);
  setTimeout(() => item.remove(), 5000);
}

// Une fenêtre modale, retirée du DOM à sa fermeture. Échap et un clic à côté la
// ferment, comme on s'y attend.
export function openDialog(...content) {
  const close = h("button", { class: "dialog-close", "aria-label": "Fermer" }, "×");
  const dialog = h("dialog", { class: "dialog" }, close, ...content);
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

// Un bouton qui demande confirmation : le premier clic arme, le second agit.
// Plus doux qu'une boîte `confirm()`, et une revente ne part jamais d'un clic
// malheureux.
export function confirmButton(label, confirmLabel, action, { kind = "danger" } = {}) {
  let armed = false;
  let timer = null;
  const button = h("button", { class: "button" }, label);
  button.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      button.textContent = confirmLabel;
      button.classList.add(kind);
      timer = setTimeout(() => {
        armed = false;
        button.textContent = label;
        button.classList.remove(kind);
      }, 4000);
      return;
    }
    clearTimeout(timer);
    button.disabled = true;
    try {
      await action();
    } finally {
      button.disabled = false;
      armed = false;
      button.textContent = label;
      button.classList.remove(kind);
    }
  });
  return button;
}

// Une barre de progression. La largeur passe par le CSSOM et pas par un
// attribut `style` : la politique de sécurité du site refuse les styles en
// ligne.
export function progressBar(percent) {
  const fill = h("span");
  fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  return h("div", { class: "progress" }, fill);
}

export function errorBox(error) {
  return h("div", { class: "notice error" }, plain(error.message));
}
