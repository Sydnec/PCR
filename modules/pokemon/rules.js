// Les règles du jeu en chiffres, pour la page Infos du site. Chaque nombre est
// lu dans la configuration en cours, ou calculé par la fonction même qui tire
// au sort : rien n'est recopié, et un réglage changé par /admin config change
// la page au prochain affichage.
//
// Les parts (rareté, objets, loterie) sont des poids rapportés à leur total,
// exactement ceux que pickWeightedSpecies et pickWeightedItem cumulent.
import { getConfig } from "../config.js";
import {
  getBalls,
  getPokemonConfig,
  getSafariConfig,
  hasPersonalPrice,
  specialBallDailyLimit,
  specialBallLimit,
} from "./config.js";
import {
  RARITIES,
  activeGeneration,
  allSpecies,
  charmMultiplier,
  difficultyOf,
  dittoSpecies,
  effectiveCatchRate,
  fishingOpen,
  fishingPool,
  fishingRarity,
  itemImageUrl,
  probabilitiesByBall,
  rarityOf,
  safariBaitFactor,
  safariFleeChance,
  itemOnlySpecies,
  spawnWeight,
  tradeEvolutionTarget,
} from "./data.js";
import {
  getCharmItem,
  getItems,
  heldItemChance,
  itemDropWeight,
  itemLot,
  itemLotteryWeight,
  itemCap,
  itemOpen,
  itemOverflowValue,
  itemSellValue,
  lotteryWinChance,
} from "./items.js";
import { getLotteryConfig } from "./lottery.js";
import { describeEvolution } from "./collection.js";
import { pokemonSellValue } from "./sell.js";
import { eggShinyFactor } from "./eggs.js";
import { charmSpecies } from "./charms.js";
import { getRods } from "./fishing.js";
import { ballEffectText, openSpecialBalls } from "./shop.js";
import { lineageAt, starterGenerations, starterChoices, starterTiers } from "./starters.js";

// La part de chaque rareté dans un tirage d'apparition (sauvage ou parc), et
// combien d'espèces elle compte.
function rarityShares(spawnConfig) {
  const byRarity = new Map();
  let total = 0;
  const itemOnly = itemOnlySpecies();
  for (const species of allSpecies()) {
    const weight = spawnWeight(species, spawnConfig, itemOnly);
    if (weight <= 0) continue;
    total += weight;
    const entry = byRarity.get(rarityOf(species)) ?? { weight: 0, species: 0 };
    entry.weight += weight;
    entry.species++;
    byRarity.set(rarityOf(species), entry);
  }
  return Object.keys(RARITIES)
    .filter((key) => byRarity.has(key))
    .map((key) => ({
      key,
      label: RARITIES[key].label,
      share: byRarity.get(key).weight / total,
      species: byRarity.get(key).species,
    }));
}

// Les chances de chaque ball selon la difficulté, bornées par les taux de
// capture des espèces qu'on croise vraiment à l'état sauvage : « de 25 à 33 % »
// plutôt qu'une formule.
function catchTable(spawnConfig) {
  const bands = new Map();
  const itemOnly = itemOnlySpecies();
  for (const species of allSpecies()) {
    if (spawnWeight(species, spawnConfig, itemOnly) <= 0) continue;
    const rate = effectiveCatchRate(species.catchRate);
    const { level, label } = difficultyOf(rate);
    const band = bands.get(level) ?? { level, label, min: Infinity, max: -Infinity };
    band.min = Math.min(band.min, rate);
    band.max = Math.max(band.max, rate);
    bands.set(level, band);
  }
  return [...bands.values()]
    .sort((a, b) => a.level - b.level)
    .map(({ level, label, min, max }) => {
      const low = probabilitiesByBall(min);
      const high = probabilitiesByBall(max);
      return {
        level,
        label,
        balls: low.map((ball, index) => ({
          key: ball.key,
          min: ball.probability,
          max: high[index].probability,
        })),
      };
    });
}

// Chaque objet du catalogue : sur quelle part des apparitions on le trouve, à
// quelle part des tirages de loterie il sort, par quels lots, et ce qu'il
// rapporte revendu. Un objet d'une génération pas encore ouverte n'y figure
// pas : il n'existe pas encore pour les joueurs.
function itemTable() {
  const items = getItems().filter(itemOpen);
  const dropTotal = items.reduce((sum, item) => sum + itemDropWeight(item), 0);
  const lotteryTotal = items.reduce((sum, item) => sum + itemLotteryWeight(item), 0);
  const heldChance = heldItemChance();
  const winChance = lotteryWinChance();
  return items.map((item) => ({
    key: item.key,
    label: item.label,
    emoji: item.emoji,
    image: itemImageUrl(item.sprite),
    description: item.description ?? null,
    held: dropTotal ? (heldChance * itemDropWeight(item)) / dropTotal : 0,
    lottery: lotteryTotal ? (winChance * itemLotteryWeight(item)) / lotteryTotal : 0,
    lot: itemLot(item),
    sellValue: itemSellValue(item),
    // La limite de détention, et ce que rapporte un exemplaire au-delà.
    maxHeld: itemCap(item),
    overflowValue: itemOverflowValue(item),
  }));
}

// Le tarif d'une évolution par stade atteint, lu par describeEvolution sur une
// espèce qui y mène sans embranchement ; et, pour les lignées à embranchement
// (Évoli…), leurs noms, le prix du hasard et celui du choix — groupées par
// prix : le hasard coûte le tarif du stade atteint, qui n'est pas le même pour
// Évoli et pour Ortide.
function evolutionTable() {
  const stages = new Map();
  const branches = new Map();
  for (const species of allSpecies()) {
    const plan = describeEvolution(species.id);
    if (plan.error) continue;
    if (plan.branching) {
      const choose = describeEvolution(species.id, plan.targets[0].id).points;
      const key = `${plan.points}|${choose}`;
      if (!branches.has(key)) branches.set(key, { species: [], random: plan.points, choose });
      branches.get(key).species.push(species.name);
      continue;
    }
    const stage = Math.max(2, plan.target.stage);
    if (!stages.has(stage)) {
      stages.set(stage, {
        stage,
        sacrifices: plan.sacrifices,
        required: plan.required,
        points: plan.points,
      });
    }
  }
  return {
    stages: [...stages.values()].sort((a, b) => a.stage - b.stage),
    branches: [...branches.values()],
  };
}

// Le prix de revente par rareté, lu sur une espèce de chaque rareté ; null
// pour une rareté qui ne se revend pas.
function sellTable() {
  const seen = new Map();
  for (const species of allSpecies()) {
    const key = rarityOf(species);
    if (!seen.has(key)) seen.set(key, species);
  }
  const shinySellable = [...seen.values()].some((species) => pokemonSellValue(species, true) > 0);
  return {
    byRarity: Object.keys(RARITIES)
      .filter((key) => seen.has(key))
      .map((key) => ({
        key,
        label: RARITIES[key].label,
        price: pokemonSellValue(seen.get(key), false) || null,
      })),
    shinySellable,
  };
}

// Les cannes ouvertes, chacune avec les espèces qu'elle pêche le plus : les poids
// mêmes que pickFished cumule, rapportés à leur total. La page n'en montre que la
// tête, le reste se compte.
function fishingTable() {
  if (!fishingOpen()) return { enabled: false, rods: [] };
  return {
    enabled: true,
    fleeSeconds: getPokemonConfig().fishing.fleeSeconds,
    // Le facteur que subissent ses espèces à l'état sauvage (1 : aucun).
    wildRarityFactor: fishingRarity().factor,
    rods: getRods().map((rod) => {
      const pool = fishingPool(rod.rod.pool);
      const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
      return {
        key: rod.key,
        label: rod.label,
        emoji: rod.emoji,
        image: itemImageUrl(rod.sprite),
        description: rod.description ?? null,
        price: rod.rod.price,
        base: Boolean(rod.rod.base),
        species: pool.length,
        top: total
          ? pool
              .slice()
              .sort((a, b) => b.weight - a.weight)
              .slice(0, 4)
              .map((entry) => ({ name: entry.species.name, share: entry.weight / total }))
          : [],
      };
    }),
  };
}

// Les starters des générations ouvertes, chacun avec sa lignée, et ce que rapporte
// chaque palier du Pokédex : un stade de la lignée choisie, shiny ou non.
function starterTable() {
  const tiers = starterTiers().map((tier) => ({
    percent: tier.percent,
    stage: tier.stage,
    shiny: Boolean(tier.shiny),
  }));
  const line = (starter) => {
    const names = [];
    for (let stage = 1; ; stage++) {
      const species = lineageAt(starter, stage);
      if (!species) return names;
      names.push(species.name);
    }
  };
  return {
    tiers,
    generations: starterGenerations().map((generation) => ({
      generation,
      choices: starterChoices(generation).map((species) => ({
        name: species.name,
        line: line(species),
      })),
    })),
  };
}

// Les balls spéciales en vente, avec la phrase même de la boutique.
function shopTable() {
  return {
    maxHeld: specialBallLimit(),
    dailyLimit: specialBallDailyLimit(),
    balls: openSpecialBalls().map((ball) => ({
      key: ball.key,
      label: ball.label,
      emoji: ball.emoji,
      image: itemImageUrl(ball.sprite),
      price: ball.price,
      effect: ballEffectText(ball),
    })),
  };
}

// La prochaine génération programmée (`generationOpenings`), si sa date est à venir
// et que le jeu de données la contient : activeGeneration, interrogée à cette date,
// dit si elle ouvrira vraiment. Null sinon.
function nextGeneration() {
  const active = activeGeneration();
  const now = Date.now();
  const next = Object.entries(getPokemonConfig().generationOpenings ?? {})
    .map(([generation, date]) => ({ generation: Number(generation), opensAt: Date.parse(date) }))
    .filter(
      ({ generation, opensAt }) =>
        generation > active && opensAt > now && activeGeneration(opensAt) >= generation
    )
    .sort((a, b) => a.opensAt - b.opensAt);
  return next[0] ?? null;
}

// Les commandes /pk, telles que Discord les connaît : le nom, les options et
// la description viennent de la définition des commandes, pas d'une copie.
function pkCommands(bot) {
  const pk = bot?.commands?.get("pk")?.data?.toJSON?.();
  if (!pk) return [];
  const usage = (prefix, command) => ({
    name: `${prefix} ${command.name}`,
    options: (command.options ?? []).map((option) => ({
      name: option.name,
      required: Boolean(option.required),
    })),
    description: command.description,
  });
  return (pk.options ?? []).flatMap((option) =>
    // Un groupe (/pk revendre pokemon…) a ses propres sous-commandes.
    option.type === 2
      ? (option.options ?? []).map((sub) => usage(`/pk ${option.name}`, sub))
      : [usage("/pk", option)]
  );
}

export function describeRules(bot) {
  const config = getPokemonConfig();
  const safari = getSafariConfig();
  const lottery = getLotteryConfig();
  const distribution = getConfig().messagePointsDistribution ?? {};
  const ranks = Object.keys(distribution)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => a - b)
    .map((key) => distribution[key]);
  // Les derniers rangs qui valent déjà le tarif suivant ne disent rien de plus.
  while (ranks.length && ranks[ranks.length - 1] === distribution.default) ranks.pop();
  const baitSteps = [];
  for (let stacks = 0; stacks <= 10; stacks++) {
    baitSteps.push({
      factor: safariBaitFactor(stacks, safari),
      flee: safariFleeChance(stacks, safari),
    });
    if (safariBaitFactor(stacks, safari) >= safari.baitMaxMultiplier) break;
  }
  const metamorph = dittoSpecies();

  return {
    commands: pkCommands(bot),
    generation: activeGeneration(),
    nextGeneration: nextGeneration(),
    points: { ranks, then: distribution.default ?? null },
    spawn: {
      messages: config.spawn.messagesPerSpawn,
      minDelayMinutes: config.spawn.minDelayMinutes,
      afterEndMinutes: config.spawn.minDelayAfterEndMinutes,
      fleeMinutes: config.spawn.fleeAfterMinutes,
      legendaryFleeMultiplier: config.spawn.legendaryFleeMultiplier,
      shinyOdds: config.spawn.shinyOdds,
      heldItemChance: heldItemChance(),
      itemDropChance: config.spawn.itemDropChance,
      rarities: rarityShares(config.spawn),
    },
    // Un charme par génération ouverte : combien d'espèces il demande.
    charm: {
      multiplier: charmMultiplier(),
      generations: Array.from({ length: activeGeneration() }, (_, index) => index + 1)
        .filter((generation) => getCharmItem(generation))
        .map((generation) => ({
          generation,
          label: getCharmItem(generation).label,
          required: charmSpecies(generation).length,
        })),
    },
    capture: {
      cooldownSeconds: config.capture.throwCooldownSeconds,
      // `price` est celui du premier achat ; pour une ball au prix personnel,
      // `priceGrowth` dit de combien chacun des suivants renchérit, sinon null.
      balls: getBalls().map((ball) => ({
        key: ball.key,
        label: ball.label,
        emoji: ball.emoji,
        image: itemImageUrl(ball.sprite),
        price: ball.price,
        priceGrowth: hasPersonalPrice(ball) ? Number(ball.priceGrowth) : null,
        multiplier: ball.multiplier,
        guaranteed: Boolean(ball.guaranteed),
      })),
      table: catchTable(config.spawn),
    },
    shop: shopTable(),
    fishing: fishingTable(),
    starters: starterTable(),
    items: itemTable(),
    lottery: {
      enabled: lottery.enabled !== false,
      winChance: lotteryWinChance(),
      lotDecay: lottery.lotDecay,
    },
    evolution: {
      ...evolutionTable(),
      dittosPerCopy: config.evolution.dittosPerCopy,
      metamorph: metamorph?.name ?? null,
    },
    eggs: {
      enabled: config.eggs.enabled !== false,
      hatchHours: config.eggs.hatchHours,
      hatchMessages: config.eggs.hatchMessages,
      shinyFactors: [eggShinyFactor(1), eggShinyFactor(2)],
    },
    trade: {
      expiryHours: config.trade.expiryHours,
      evolutions: allSpecies()
        .filter((species) => tradeEvolutionTarget(species))
        .map((species) => ({ from: species.name, to: tradeEvolutionTarget(species).name })),
    },
    sell: sellTable(),
    lock: config.lockByDefault,
    safari: {
      enabled: safari.enabled !== false,
      chancePerHour: safari.randomChancePerHour,
      minHoursBetween: safari.minHoursBetweenParks,
      durationHours: safari.parkDurationHours,
      spawnPauseHours: safari.spawnPauseHours,
      actions: safari.actionsPerSession,
      entryPrice: safari.entryPrice,
      entryCooldownHours: safari.entryCooldownHours,
      ball: {
        label: safari.ball.label,
        emoji: safari.ball.emoji,
        image: itemImageUrl(safari.ball.sprite),
        multiplier: safari.ball.multiplier,
      },
      bait: baitSteps,
      fleeFailChance: safari.fleeFailChance,
      shinyOdds: safari.shinyOdds,
      rarities: rarityShares(safari),
    },
  };
}
