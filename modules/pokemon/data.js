// Accès au dataset Pokémon statique et calculs dérivés.
//
// Le JSON est produit par scripts/generate-pokemon-data.js et commité : rien
// n'est téléchargé à l'exécution. Il est chargé une seule fois à l'import,
// contrairement à config.json qui doit rester modifiable à chaud.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getPokemonConfig } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dataset = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../pokemon-gen1.json"), "utf8")
);

const byId = new Map(dataset.species.map((s) => [s.id, s]));

// Recherche insensible aux accents et à la casse : « evoli » doit trouver
// « Évoli », « mr mime » doit trouver « M. Mime ».
const normalize = (text) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

for (const species of dataset.species) species.searchKey = normalize(species.name);

export const RARITIES = {
  COMMUN: { label: "Commun", icon: "⚪" },
  PEU_COMMUN: { label: "Peu commun", icon: "🟢" },
  RARE: { label: "Rare", icon: "🔵" },
  LEGENDAIRE: { label: "Légendaire", icon: "🟠" },
};

const TYPE_COLORS = {
  Normal: 0xa8a878, Combat: 0xc03028, Vol: 0xa890f0, Poison: 0xa040a0,
  Sol: 0xe0c068, Roche: 0xb8a038, Insecte: 0xa8b820, Spectre: 0x705898,
  Acier: 0xb8b8d0, Feu: 0xf08030, Eau: 0x6890f0, Plante: 0x78c850,
  "Électrik": 0xf8d030, Psy: 0xf85888, Glace: 0x98d8d8, Dragon: 0x7038f8,
  "Ténèbres": 0x705848, "Fée": 0xee99ac,
};

export const allSpecies = () => dataset.species;
export const dexSize = () => dataset.species.length;
export const getSpecies = (id) => byId.get(Number(id)) || null;
export const generation = () => dataset.generation;

export const isLegendary = (species) => species.isLegendary || species.isMythical;

export function rarityOf(species) {
  if (isLegendary(species)) return "LEGENDAIRE";
  if (species.stage >= 3) return "RARE";
  if (species.stage === 2) return "PEU_COMMUN";
  return "COMMUN";
}

export const spriteUrl = (species, isShiny) =>
  isShiny ? species.spriteShiny : species.sprite;

export function embedColor(species, isShiny) {
  if (isShiny) return 0xffd700;
  return TYPE_COLORS[species.types[0]] ?? 0x5865f2;
}

// Poids d'apparition d'une espèce.
// Les évolutions par échange ne se trouvent jamais à l'état sauvage : elles
// s'obtiennent uniquement par fusion de doublons, ce qui donne de la valeur
// aux doublons de leur pré-évolution.
export function spawnWeight(species, spawnConfig) {
  if (species.tradeEvolution) return 0;
  if (isLegendary(species)) return spawnConfig.legendaryWeight;
  return spawnConfig.weightsByStage[species.stage] ?? 0;
}

export function pickWeightedSpecies(spawnConfig) {
  const pool = [];
  let total = 0;
  for (const species of dataset.species) {
    const weight = spawnWeight(species, spawnConfig);
    if (weight > 0) {
      total += weight;
      pool.push({ species, cumulative: total });
    }
  }
  if (!total) return null;
  const roll = Math.random() * total;
  return (pool.find((entry) => roll < entry.cumulative) ?? pool[pool.length - 1])
    .species;
}

// Formule officielle de la génération 3, à PV pleins et sans altération d'état.
// a = (3·PVmax − 2·PVmax) / (3·PVmax) × catch_rate × ball = catch_rate × ball / 3
// P = (b/65536)^4 se simplifie exactement en a/255, d'où le /765.
// Le multiplicateur global permet de rendre tout le jeu plus ou moins dur sans
// jamais toucher à la hiérarchie de difficulté entre espèces.
export function catchProbability(catchRate, ballMultiplier, globalMultiplier) {
  const probability = (catchRate * ballMultiplier * globalMultiplier) / 765;
  return Math.min(1, Math.max(0, probability));
}

// Probabilités affichées dans les embeds, pour que le joueur sache ce qu'il paie.
export function probabilitiesByBall(catchRate) {
  const config = getPokemonConfig();
  return Object.entries(config.capture.balls).map(([key, ball]) => ({
    key,
    ...ball,
    probability: ball.guaranteed
      ? 1
      : catchProbability(catchRate, ball.multiplier, config.capture.globalMultiplier),
  }));
}

// ====================== PARC SAFARI ======================

// L'appât est multiplicatif et cumulable, mais plafonné : avec les réglages par
// défaut (x2, plafond x4) deux appâts suffisent à l'atteindre et un troisième ne
// serait qu'une action perdue. C'est ce plafond qui fait le choix tactique entre
// appâter et lancer.
export function safariBaitFactor(baitStacks, safariConfig) {
  const stacks = Math.max(0, Number(baitStacks) || 0);
  return Math.min(
    safariConfig.baitMaxMultiplier,
    Math.pow(safariConfig.baitMultiplier, stacks)
  );
}

export const safariBaitCapped = (baitStacks, safariConfig) =>
  safariBaitFactor(baitStacks, safariConfig) >= safariConfig.baitMaxMultiplier;

// Une rencontre du parc. pickWeightedSpecies lit exactement weightsByStage et
// legendaryWeight : le bloc safari lui est passé tel quel, il n'y a pas de
// second tirage à maintenir. Les évolutions par échange restent hors pool,
// spawnWeight leur donne déjà un poids nul.
export function rollSafariEncounter(safariConfig) {
  const species = pickWeightedSpecies(safariConfig);
  if (!species) return null;
  return {
    species,
    isShiny: Math.floor(Math.random() * safariConfig.shinyOdds) === 0,
    catchRate: species.catchRate,
  };
}

// Même formule que les captures sauvages : le parc ne change que le
// multiplicateur, jamais la courbe. Le curseur global reste donc pleinement
// opérant sur le parc aussi.
export function safariCatchProbability(catchRate, baitStacks, safariConfig) {
  return catchProbability(
    catchRate,
    safariConfig.ball.multiplier * safariBaitFactor(baitStacks, safariConfig),
    getPokemonConfig().capture.globalMultiplier
  );
}

export function difficultyLabel(catchRate) {
  if (catchRate >= 190) return "Très facile";
  if (catchRate >= 120) return "Facile";
  if (catchRate >= 60) return "Moyenne";
  if (catchRate >= 40) return "Difficile";
  if (catchRate >= 10) return "Très difficile";
  return "Extrême";
}

// Cible d'autocomplétion : jusqu'à `limit` espèces dont le nom contient la requête.
export function searchByName(query, limit = 25) {
  const needle = normalize(query || "");
  const matches = needle
    ? dataset.species.filter((s) => s.searchKey.includes(needle))
    : dataset.species;
  return matches.slice(0, limit);
}

export const evolutionTargets = (species) =>
  species.evolvesInto.map(getSpecies).filter(Boolean);

// Le coût d'une évolution dépend du stade de la CIBLE : passer en stade 2 coûte
// moins cher que passer en stade 3.
export function evolutionCost(targetSpecies, evolutionConfig) {
  return evolutionConfig[targetSpecies.stage] ?? null;
}
