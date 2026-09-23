// Les pictogrammes du site, dessinés en SVG plutôt qu'empruntés aux emojis :
// un emoji change d'allure d'un système à l'autre et crie plus fort que le
// texte qu'il accompagne. Les emoji du serveur Discord, eux, restent des images
// (voir emoji() dans lib.js).
//
// Tracés sur une grille de 24, en `currentColor` : la couleur vient du CSS
// (.icon-<nom>), jamais d'un attribut de style, que la politique de sécurité
// refuse.
const PATHS = {
  check: [["path", { d: "M20 6 9 17l-5-5" }]],
  cross: [["path", { d: "M18 6 6 18M6 6l12 12" }]],
  question: [
    ["circle", { cx: 12, cy: 12, r: 9 }],
    ["path", { d: "M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" }],
  ],
  sparkle: [
    [
      "path",
      { d: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z", fill: "currentColor" },
    ],
    ["path", { d: "M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z", fill: "currentColor" }],
  ],
  lock: [
    ["rect", { x: 5, y: 11, width: 14, height: 10, rx: 2 }],
    ["path", { d: "M8 11V7a4 4 0 0 1 8 0v4" }],
  ],
  egg: [["path", { d: "M12 3C8.5 3 5.5 9 5.5 13.5a6.5 6.5 0 0 0 13 0C18.5 9 15.5 3 12 3z" }]],
  warning: [
    [
      "path",
      { d: "M10.3 4.2 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" },
    ],
    ["path", { d: "M12 10v4M12 17.5h.01" }],
  ],
  pin: [["path", { d: "M12 17v5M8 3h8l-1.5 6 3.5 3.5v1.5H6v-1.5L9.5 9z" }]],
  hourglass: [["path", { d: "M6 2h12M6 22h12M7 2v4l5 6-5 6v4M17 2v4l-5 6 5 6v4" }]],
  wind: [["path", { d: "M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h6" }]],
  star: [
    [
      "path",
      {
        d: "M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z",
        fill: "currentColor",
      },
    ],
  ],
  tent: [["path", { d: "M3 20 12 4l9 16M12 4v16M8.5 20 12 13l3.5 7M2 20h20" }]],
  berry: [
    ["circle", { cx: 12, cy: 14, r: 7 }],
    ["path", { d: "M12 7c0-2.2 1.6-4 4-4" }],
  ],
  chevronLeft: [["path", { d: "M15 18 9 12l6-6" }]],
  chevronRight: [["path", { d: "M9 18l6-6-6-6" }]],
  move: [["path", { d: "M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4" }]],
  pencil: [["path", { d: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" }]],
};

const SVG = "http://www.w3.org/2000/svg";

// Une icône nommée, ou null si le nom est inconnu. `label` la rend lisible par
// un lecteur d'écran ; sans lui, elle est décorative et masquée.
export function icon(name, { label = "", className = "" } = {}) {
  const shapes = PATHS[name];
  if (!shapes) return null;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", `icon icon-${name} ${className}`.trim());
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    const title = document.createElementNS(SVG, "title");
    title.textContent = label;
    svg.append(title);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }
  for (const [tag, attributes] of shapes) {
    const shape = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, String(value));
    svg.append(shape);
  }
  return svg;
}

// Les emojis qu'écrivent les messages du jeu (rédigés pour Discord), et
// l'icône qui les remplace sur le site.
export const EMOJI_ICONS = {
  "✅": "check",
  "❌": "cross",
  "❔": "question",
  "✨": "sparkle",
  "🔒": "lock",
  "🥚": "egg",
  "⚠️": "warning",
  "⚠": "warning",
  "📌": "pin",
  "⏳": "hourglass",
  "💨": "wind",
  "🎉": "star",
  "🏕️": "tent",
  "🍎": "berry",
  "🏃": "wind",
};
