// Petits outils partagés par les pages du site.
import { EMOJI_ICONS, icon } from "./icons.js";

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

// Des chances, affichées comme sur les annonces Discord.
export function percent(probability) {
  const value = probability * 100;
  if (value >= 10) return `${Math.round(value)} %`;
  if (value >= 1) return `${value.toFixed(1).replace(".", ",")} %`;
  return `${value.toFixed(2).replace(".", ",")} %`;
}

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

// Une ball ou un objet : l'emoji du serveur quand il en a un (c'est le même
// visuel que sur Discord), sinon son image PokéAPI, et l'emoji ordinaire en
// dernier recours.
export function itemIcon(entry, label = entry?.label ?? "") {
  if (/^<a?:\w+:\d+>$/.test(entry?.emoji ?? "")) return emoji(entry.emoji, label);
  if (entry?.image) {
    return h("img", { class: "emoji item-img", src: entry.image, alt: label, title: label });
  }
  return emoji(entry?.emoji ?? "", label);
}

// Les emojis ordinaires des objets, et leur image : un message du jeu qui dit
// « 🍬 Il tenait Super Bonbon » montre alors le bonbon. Rempli au démarrage
// avec le catalogue.
const itemImages = new Map();
export function registerItemImages(entries) {
  for (const entry of entries) {
    if (entry.image && entry.emoji && !entry.emoji.startsWith("<")) {
      itemImages.set(entry.emoji, entry);
    }
  }
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
// dans son nom : on ne le répète pas, sauf sous un surnom, qui le cache.
export function pokemonName(species, shiny = false, sex = null, nickname = null) {
  const name = nickname || (species?.name ?? "?");
  const carries = !nickname && (name.includes("♂") || name.includes("♀"));
  const sexNode = carries ? null : sexMark(sex);
  return h(
    "span",
    { class: "pokemon-name" },
    name,
    sexNode ? [" ", sexNode] : null,
    shiny ? [" ", icon("sparkle", { label: "Shiny" })] : null
  );
}

export const dexNumber = (species) => `n° ${String(species.id).padStart(3, "0")}`;

// « Est-ce que je l'ai déjà ? » La variante qui compte est celle qu'on a sous
// les yeux : un shiny est une entrée de Pokédex à part.
export function ownedMark(owned, shiny = false) {
  const count = shiny ? owned.shiny : owned.normal;
  return count
    ? h("span", { class: "owned" }, icon("check"), ` Déjà dans ta boîte (×${fmt(count)})`)
    : h("span", { class: "pill-new" }, shiny ? "Nouveau shiny" : "Nouveau");
}

// Comment on obtient une espèce qu'on ne croise pas dans la nature : les mêmes
// repères que sur Discord, en icônes.
const OBTENTION_ICONS = {
  evolution: ["lock", "Ne s'obtient qu'en évoluant"],
  egg: ["egg", "Ne sort que d'un œuf"],
};
export function obtentionMark(obtention) {
  const entry = OBTENTION_ICONS[obtention];
  return entry ? icon(entry[0], { label: entry[1] }) : null;
}
export const OBTENTION_LEGENDS = {
  evolution: "🔒 Introuvable à l'état sauvage : par fusion de doublons, ou par échange.",
  egg: "🥚 Ne sort que d'un œuf : /pk oeuf pondre, avec un couple de parents.",
};

// Une pastille colorée. La couleur passe par le CSSOM (--chip) : la politique
// de sécurité du site refuse les attributs `style`.
export function colorChip(content, { color = null, className = "" } = {}) {
  const chip = h("span", { class: `chip chip-color ${className}`.trim() }, content);
  if (color) chip.style.setProperty("--chip", color);
  return chip;
}

// Rareté et types d'une espèce, en pastilles de couleur : la rareté selon les
// repères de Discord, les types de la couleur de leurs embeds.
export function speciesChips(ctx, species, ...extra) {
  return h(
    "div",
    { class: "chips" },
    colorChip(species.rarityLabel, { className: `rarity-${species.rarity}` }),
    species.types.map((type) => colorChip(type, { color: ctx.types[type] })),
    extra
  );
}

// Un message du jeu, écrit pour Discord : le gras (**…**) et les emoji du
// serveur (<:nom:id>) y sont rendus comme là-bas, le reste reste du texte. On
// découpe la chaîne, on ne l'interprète jamais comme du HTML.
export function richText(text) {
  // Les plus longs d'abord : « ⚠️ » doit passer avant « ⚠ ».
  const symbols = [...Object.keys(EMOJI_ICONS), ...itemImages.keys()]
    .sort((a, b) => b.length - a.length)
    .map((symbol) => symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(\\*\\*[^*]+\\*\\*|<a?:\\w+:\\d+>|${symbols.join("|")})`, "u");
  const nodes = [];
  String(text)
    .split("\n")
    .forEach((line, index) => {
      if (index) nodes.push(h("br"));
      for (const part of line.split(pattern)) {
        if (!part) continue;
        // Un gras peut porter un emoji (« **✨ Pikachu** ») : on le rend aussi.
        if (/^\*\*[^*]+\*\*$/.test(part)) nodes.push(h("strong", {}, richText(part.slice(2, -2))));
        else if (/^<a?:\w+:\d+>$/.test(part)) nodes.push(emoji(part));
        else if (EMOJI_ICONS[part]) nodes.push(icon(EMOJI_ICONS[part]));
        else if (itemImages.has(part)) nodes.push(itemIcon(itemImages.get(part)));
        else nodes.push(part.replace(/`/g, ""));
      }
    });
  return nodes;
}

// La réponse d'une action du jeu : la phrase du message Discord, son emoji
// d'ouverture remplacé par une icône qui dit l'issue.
export function outcomePanel(text, iconName, className) {
  return h(
    "p",
    { class: `throw-panel ${className}`, role: "status" },
    icon(iconName ?? "warning"),
    // Un seul bloc de texte : le panneau est une rangée flex, et chaque morceau
    // (gras, emoji) y deviendrait sinon une colonne.
    h("span", {}, richText(text.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, "")))
  );
}

export function toast(message, kind = "info") {
  const box = document.getElementById("toasts");
  const item = h(
    "div",
    { class: `toast toast-${kind}`, role: "status" },
    h("span", {}, richText(message))
  );
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
  return h("div", { class: "notice error" }, h("span", {}, richText(error.message)));
}
