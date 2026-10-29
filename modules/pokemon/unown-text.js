// /zarbi : un message écrit en Zarbi, une illustration par lettre, dessiné dans
// une seule image. Seules les lettres s'écrivent et se vérifient : chiffres,
// ponctuation, emojis et mentions n'ont pas de Zarbi, et séparent les mots.
import { PNG } from "pngjs";
import { handleException } from "../utils.js";
import { getUnownTextConfig } from "./config.js";
import { spriteUrl } from "./data.js";
import { cellOf } from "./showcase-image.js";

// Ce que Discord écrit entre chevrons — emojis du serveur, mentions, salons,
// dates, commandes, pages du serveur — n'est pas du texte : « <:pikachu:123> »
// ne demande ni P ni K.
const DISCORD_TOKEN = /<(?:a?:\w+:\d+|@[!&]?\d+|#\d+|t:-?\d+(?::[a-z])?|\/[^<>]+:\d+|id:\w+)>/gi;

// Les ligatures du français, que la décomposition Unicode laisse entières.
const LIGATURES = { œ: "oe", æ: "ae" };

// La pierre des Ruines d'Alpha : un fond clair, où les Zarbi, gris sombre, se
// lisent aussi sur le thème sombre de Discord, que la transparence rendrait
// presque invisibles.
const BACKGROUND = [0xe8, 0xe2, 0xd0];

// Les mots du message, en lettres de Zarbi (les clés de leurs formes, « a » à
// « z ») : « é » s'écrit avec le Zarbi E, l'accent part et la lettre reste. La
// décomposition de compatibilité ramène aussi les lettres pleine chasse (« Ａ »)
// et les ligatures typographiques (« ﬁ ») à leurs lettres. Elle passe avant les
// minuscules : « ᴬ » n'a pas de minuscule, et ne devient « A » qu'en se
// décomposant.
export function unownWords(text) {
  return String(text ?? "")
    .replace(DISCORD_TOKEN, " ")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[œæ]/g, (char) => LIGATURES[char])
    .split(/[^a-z]+/)
    .filter(Boolean);
}

// Les mots rangés en lignes de `perLine` cases au plus, une case vide (null)
// entre deux mots. Un mot qui ne tient pas sur la ligne passe à la suivante,
// et un mot plus long qu'une ligne se coupe.
export function unownLines(words, perLine) {
  const lines = [];
  let line = [];
  for (const word of words) {
    if (line.length && line.length + 1 + word.length <= perLine) {
      line.push(null, ...word);
      continue;
    }
    if (line.length) lines.push(line);
    let rest = word;
    for (; rest.length > perLine; rest = rest.slice(perLine)) {
      lines.push([...rest.slice(0, perLine)]);
    }
    line = [...rest];
  }
  if (line.length) lines.push(line);
  return lines;
}

// L'image PNG des lignes, en Zarbi de `species`, ou null si une seule lettre
// n'a pas pu se lire. Ne lève jamais.
export async function renderUnownText(species, lines) {
  try {
    const { imageCell: size, imageTimeoutSeconds } = getUnownTextConfig();
    const letters = [...new Set(lines.flat().filter(Boolean))];
    if (!letters.length) return null;
    const results = await Promise.allSettled(
      letters.map((key) => cellOf(spriteUrl(species, false, key), size, imageTimeoutSeconds))
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed) {
      handleException("Image de /zarbi :", failed.reason);
      return null;
    }
    const cells = new Map(letters.map((key, index) => [key, results[index].value]));

    // Une marge d'un quart de case autour du texte, pour qu'il ne touche pas
    // le bord de l'image.
    const margin = Math.round(size / 4);
    const width = Math.max(...lines.map((line) => line.length)) * size + 2 * margin;
    const png = new PNG({ width, height: lines.length * size + 2 * margin });
    png.data.fill(Buffer.from([...BACKGROUND, 0xff]));
    lines.forEach((line, row) => {
      line.forEach((key, column) => {
        if (!key) return;
        const cell = cells.get(key);
        const left = margin + column * size;
        const top = margin + row * size;
        // Les bords de l'illustration sont semi-transparents : ils se fondent
        // dans la pierre au lieu de la remplacer.
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const from = (y * size + x) * 4;
            const alpha = cell[from + 3] / 255;
            if (!alpha) continue;
            const to = ((top + y) * width + left + x) * 4;
            for (let channel = 0; channel < 3; channel++) {
              png.data[to + channel] = Math.round(
                cell[from + channel] * alpha + BACKGROUND[channel] * (1 - alpha)
              );
            }
          }
        }
      });
    });
    return PNG.sync.write(png);
  } catch (error) {
    handleException("Image de /zarbi :", error);
    return null;
  }
}
