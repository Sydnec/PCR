// Lecture à chaud des réglages Pokémon.
//
// config.json est relu à chaque appel (comme dans messageCreate.js) et jamais
// importé : tous les nombres du jeu — prix, multiplicateurs, taux de shiny,
// cadence, coûts de fusion — sont donc ajustables sans redémarrer le bot.
// Un fichier cassé ne doit jamais arrêter le bot : on retombe sur DEFAULTS.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { handleException } from "../utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, "../../config.json");

export const DEFAULTS = {
  enabled: true,
  spawn: {
    messagesPerSpawn: 40,
    minDelayMinutes: 60,
    shinyOdds: 500,
    weightsByStage: { 1: 100, 2: 35, 3: 10 },
    legendaryWeight: 8,
    pingRarities: ["RARE", "LEGENDAIRE"],
    throwLogSize: 8,
    embedRefreshMs: 2000,
  },
  capture: {
    globalMultiplier: 1,
    throwCooldownSeconds: 5,
    balls: {
      poke: { label: "Poké Ball", emoji: "⚪", price: 150, multiplier: 1 },
      super: { label: "Super Ball", emoji: "🔵", price: 400, multiplier: 2 },
      hyper: { label: "Hyper Ball", emoji: "🟡", price: 1000, multiplier: 4 },
      master: {
        label: "Master Ball",
        emoji: "🟣",
        price: 50000,
        multiplier: 255,
        guaranteed: true,
      },
    },
  },
  evolution: {
    2: { duplicates: 5, points: 500 },
    3: { duplicates: 10, points: 2000 },
    branchChoicePoints: 1000,
  },
  trade: { expiryHours: 24 },
  pokedex: { pageSize: 30 },
};

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Fusion profonde : une clé absente ou en trop dans config.json retombe
// silencieusement sur la valeur par défaut plutôt que de casser le jeu.
function merge(defaults, override) {
  if (!isPlainObject(override)) return defaults;
  const result = { ...defaults };
  for (const [key, value] of Object.entries(override)) {
    result[key] = isPlainObject(defaults[key]) ? merge(defaults[key], value) : value;
  }
  return result;
}

export function getPokemonConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return merge(DEFAULTS, raw.pokemon);
  } catch (error) {
    handleException("Lecture de la config Pokémon impossible :", error);
    return DEFAULTS;
  }
}

// Renvoie la définition d'une ball, ou null si la clé est inconnue.
export function getBall(key) {
  const ball = getPokemonConfig().capture.balls[key];
  return ball ? { key, ...ball } : null;
}

export function getBalls() {
  const balls = getPokemonConfig().capture.balls;
  return Object.entries(balls).map(([key, ball]) => ({ key, ...ball }));
}
