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
    // Délai plancher avant qu'un nouveau Pokémon apparaisse une fois le
    // précédent capturé ou enfui. À 0, il apparaît dès le message suivant.
    minDelayAfterEndMinutes: 0,
    // Durée de vie d'un Pokémon non capturé : il s'enfuit de lui-même après un
    // délai tiré au hasard dans cet intervalle, sans dépendre de l'activité.
    fleeAfterMinutes: { min: 180, max: 360 },
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
  // Parc safari. Les poids d'apparition y compensent partiellement le malus
  // infligé aux évolutions dans le pool naturel : c'est toute la raison d'être
  // du parc, et la seule façon de croiser un stade 3 ou un légendaire sans y
  // passer la semaine. La Safari Ball vit ici et non dans capture.balls, sinon
  // elle apparaîtrait sur les spawns publics et dans /pokeinfo.
  safari: {
    enabled: true,
    randomChancePerHour: 0.015,
    minHoursBetweenParks: 48,
    parkDurationHours: 24,
    spawnPauseHours: 6,
    sessionDurationMinutes: 60,
    actionsPerSession: 25,
    entryPrice: 4000,
    entryCooldownHours: 24,
    ball: { label: "Safari Ball", emoji: "\u{1F7E2}", multiplier: 1.5 },
    // Multiplicatif et cumulable, mais plafonné : deux appâts atteignent le
    // plafond, le troisième est une action gaspillée. C'est là qu'est le choix.
    baitMultiplier: 2,
    baitMaxMultiplier: 4,
    fleeFailChance: 0.1,
    wildFleeChance: 0.05,
    shinyOdds: 250,
    weightsByStage: { 1: 100, 2: 70, 3: 40 },
    legendaryWeight: 24,
  },
};

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Clés qui, affectées sur un objet ordinaire, modifient sa chaîne de
// prototypes au lieu d'ajouter un réglage. config.json est un fichier de
// confiance, mais une fusion profonde qui les recopie est une pollution de
// prototype en attente d'une mauvaise manipulation.
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Fusion profonde : une clé absente ou en trop dans config.json retombe
// silencieusement sur la valeur par défaut plutôt que de casser le jeu.
function merge(defaults, override) {
  if (!isPlainObject(override)) return defaults;
  const result = { ...defaults };
  for (const [key, value] of Object.entries(override)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
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
  const balls = getPokemonConfig().capture.balls;
  // hasOwnProperty : sans lui, une clé héritée (« constructor », par exemple)
  // renvoyait un objet tronqué au lieu de null, et le lancer partait avec un
  // prix indéfini.
  if (!Object.prototype.hasOwnProperty.call(balls, key)) return null;
  const ball = balls[key];
  return ball ? { key, ...ball } : null;
}

export function getBalls() {
  const balls = getPokemonConfig().capture.balls;
  return Object.entries(balls).map(([key, ball]) => ({ key, ...ball }));
}

// Réglages du parc safari, avec la Safari Ball déjà mise en forme comme les
// balls de capture (clé comprise) pour que les embeds n'aient pas à distinguer
// les deux familles.
export function getSafariConfig() {
  const safari = getPokemonConfig().safari;
  return { ...safari, ball: { key: "safari", ...safari.ball } };
}
