// L'image de la vitrine : les Pokémon exposés, dessinés en grille dans une
// seule image. Une galerie Discord dispose elle-même ses images, et leur
// taille change avec leur nombre — une seule en grand, trois en déséquilibre ;
// l'image composée garde la même case (`pokemon.showcase.imageCell`) quel que
// soit le nombre, trois par ligne comme sur le site.
import { PNG } from "pngjs";
import { handleException } from "../utils.js";
import { getPokemonConfig } from "./config.js";
import { getSpecies, spriteUrl } from "./data.js";

const COLUMNS = 3;

// Les illustrations déjà réduites, par taille et adresse : une vitrine se
// redessine sans rien retélécharger. Bornées, les moins récemment servies
// sortent d'abord.
const CACHE_SIZE = 200;
const cells = new Map();

// Réduit une image RGBA pour qu'elle tienne dans un carré de `size`, centrée.
// Chaque pixel est la moyenne des pixels qu'il couvre, pondérée par leur
// opacité : les bords transparents ne noircissent pas le contour.
function fit(src, size) {
  const scale = Math.max(src.width, src.height) / size;
  const width = Math.max(1, Math.round(src.width / scale));
  const height = Math.max(1, Math.round(src.height / scale));
  const left = Math.floor((size - width) / 2);
  const top = Math.floor((size - height) / 2);
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < height; y++) {
    const y0 = y * scale;
    const y1 = Math.min(src.height, y0 + scale);
    for (let x = 0; x < width; x++) {
      const x0 = x * scale;
      const x1 = Math.min(src.width, x0 + scale);
      let r = 0;
      let g = 0;
      let b = 0;
      let alpha = 0;
      let area = 0;
      for (let j = Math.floor(y0); j < Math.ceil(y1); j++) {
        const wy = Math.min(y1, j + 1) - Math.max(y0, j);
        for (let i = Math.floor(x0); i < Math.ceil(x1); i++) {
          const weight = wy * (Math.min(x1, i + 1) - Math.max(x0, i));
          const k = (j * src.width + i) * 4;
          const a = src.data[k + 3] * weight;
          r += src.data[k] * a;
          g += src.data[k + 1] * a;
          b += src.data[k + 2] * a;
          alpha += a;
          area += weight;
        }
      }
      const o = ((top + y) * size + left + x) * 4;
      if (alpha > 0) {
        out[o] = Math.round(r / alpha);
        out[o + 1] = Math.round(g / alpha);
        out[o + 2] = Math.round(b / alpha);
      }
      out[o + 3] = area > 0 ? Math.round(alpha / area) : 0;
    }
  }
  return out;
}

async function cellOf(url, size, timeoutSeconds) {
  const key = `${size}|${url}`;
  const cached = cells.get(key);
  if (cached) {
    cells.delete(key);
    cells.set(key, cached);
    return cached;
  }
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PCR-bot/1.0)" },
    // Le délai couvre aussi la lecture du corps.
    signal: AbortSignal.timeout(timeoutSeconds * 1000),
  });
  if (!response.ok) throw new Error(`${url} : ${response.status}`);
  const cell = fit(PNG.sync.read(Buffer.from(await response.arrayBuffer())), size);
  cells.set(key, cell);
  if (cells.size > CACHE_SIZE) cells.delete(cells.keys().next().value);
  return cell;
}

// L'image PNG des Pokémon exposés, dans l'ordre de la vitrine, ou null si
// aucune illustration n'a pu se lire. Ne lève jamais : une illustration
// injoignable laisse sa case vide, et la vitrine s'affiche sans image plutôt
// que pas du tout. Les Pokémon d'une espèce inconnue sont écartés, comme dans
// la liste de buildShowcaseMessage, pour que les deux gardent le même ordre.
export async function renderShowcaseImage(rows) {
  try {
    const config = getPokemonConfig().showcase ?? {};
    const size = Math.max(1, Math.floor(Number(config.imageCell) || 128));
    const timeoutSeconds = Math.max(1, Number(config.imageTimeoutSeconds) || 5);
    const urls = rows
      .map((row) => {
        const species = getSpecies(row.species_id);
        return species ? spriteUrl(species, Boolean(row.is_shiny), row.form) : null;
      })
      .filter(Boolean);
    if (!urls.length) return null;

    const results = await Promise.allSettled(urls.map((url) => cellOf(url, size, timeoutSeconds)));
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length) handleException("Image de la vitrine :", failed[0].reason);
    if (failed.length === results.length) return null;

    // La largeur reste celle de trois cases : les Pokémon gardent leur taille
    // d'une vitrine à l'autre. La dernière ligne, incomplète, se centre.
    const lines = Math.ceil(urls.length / COLUMNS);
    const png = new PNG({ width: COLUMNS * size, height: lines * size });
    results.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const line = Math.floor(index / COLUMNS);
      const inLine = Math.min(COLUMNS, urls.length - line * COLUMNS);
      const left = Math.floor(((COLUMNS - inLine) * size) / 2) + (index % COLUMNS) * size;
      for (let y = 0; y < size; y++) {
        result.value.copy(
          png.data,
          ((line * size + y) * png.width + left) * 4,
          y * size * 4,
          (y + 1) * size * 4
        );
      }
    });
    return PNG.sync.write(png);
  } catch (error) {
    handleException("Image de la vitrine :", error);
    return null;
  }
}
