// Propriétaire unique de config.json : lecture à chaud, valeurs par défaut, et
// écriture depuis /admin config.
//
// Le fichier était jusqu'ici lu à deux endroits indépendants — ici pour le bloc
// Pokémon, et dans messageCreate.js en lecture brute sans défauts. Tant que
// personne n'y écrivait, ça tenait. Dès qu'une commande le modifie, un lecteur
// sans repli casse au premier fichier momentanément invalide.
//
// DEFAULTS sert deux rôles : le repli quand le fichier est illisible, et le
// SCHÉMA de /admin config — une clé absente d'ici n'existe pas, et le type de la
// valeur par défaut impose celui qu'on peut écrire. Rien à maintenir en double.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { handleException } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, "../config.json");
// C'est ICI qu'écrit /admin config, jamais dans config.json.
//
// config.json est suivi par git, et le déploiement enchaîne `git checkout main`
// puis `git pull` sous `set -e` : un fichier suivi modifié sur le serveur fait
// échouer le déploiement suivant, et `pcr release` refuse de partir d'un arbre
// sale. Une commande qui écrirait dans config.json casserait donc la chaîne de
// livraison au premier usage.
//
// La surcharge est un troisième étage de la fusion : DEFAULTS, puis config.json
// (le réglage versionné, décidé en revue), puis ce fichier (l'ajustement fait
// depuis Discord). La propriété « clé absente = valeur du dessous » tient à
// chaque étage.
const overridePath = path.join(__dirname, "../config.local.json");

const POKEMON = {
  enabled: true,
  // Dernière génération jouable. Le jeu de données en contient davantage
  // (modules/pokemon-data.json, régénéré à l'avance) : ouvrir la suivante se
  // fait d'une commande, `/admin config pokemon.generation 2`, sans release ni
  // redémarrage. La refermer cache ses espèces sans les retirer des collections.
  generation: 1,
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
    // Le stade 2 pèse 60 % d'un stade 1, le stade 3 un quart : les évolutions
    // restent plus rares que leur forme de base, comme dans les jeux, sans être
    // introuvables. 35 et 10 en faisaient des curiosités — un stade 3 sur 75
    // apparitions.
    weightsByStage: { 1: 100, 2: 60, 3: 25 },
    legendaryWeight: 8,
    pingRarities: ["RARE", "LEGENDAIRE"],
    throwLogSize: 8,
    // Un Pokémon sur quinze tient quelque chose. C'est tiré à l'apparition et
    // figé dans la ligne, comme le shiny et le taux de capture : ce que porte un
    // Pokémon lui appartient, ça ne se retire pas au moment où on l'attrape.
    //
    // Et ce qu'il tient ne finit pas toujours dans la poche de celui qui
    // l'attrape : une fois sur cinq il le lâche en partant — capturé ou enfui —
    // et l'objet reste par terre pour le plus rapide. C'est la seule récompense
    // du jeu qui ne demande pas d'avoir gagné la course, et la seule chose qu'un
    // Pokémon qui s'échappe laisse derrière lui.
    heldItemChance: 0.07,
    itemDropChance: 0.2,
    embedRefreshMs: 2000,
  },
  capture: {
    globalMultiplier: 1,
    throwCooldownSeconds: 5,
    // Les emoji des balls sont ceux du serveur, au format Discord `<:nom:id>`.
    // C'est l'identifiant qui décide de l'image affichée, jamais le nom : le
    // renommer côté serveur ne casse rien, le supprimer si. Ce format-là rend
    // aussi bien dans le texte d'un embed que sur un bouton, là où l'identifiant
    // nu ne marcherait que sur le bouton. Un emoji unicode ordinaire reste une
    // valeur valide, ce qui laisse de quoi dépanner depuis /admin config si le
    // bot perd l'accès au serveur qui les héberge.
    //
    // `sprite` nomme l'image de l'objet dans le dépôt de PokéAPI : le site la
    // montre là où Discord n'a qu'un emoji ordinaire (voir itemImageUrl).
    balls: {
      poke: {
        label: "Poké Ball",
        emoji: "<:pokeball:1551325915160514690>",
        sprite: "poke-ball",
        price: 150,
        multiplier: 1,
      },
      super: {
        label: "Super Ball",
        emoji: "<:superball:1551325951361679411>",
        sprite: "great-ball",
        price: 400,
        multiplier: 2,
      },
      hyper: {
        label: "Hyper Ball",
        emoji: "<:hyperball:1551326031431077898>",
        sprite: "ultra-ball",
        price: 1000,
        multiplier: 4,
      },
      master: {
        label: "Master Ball",
        emoji: "<:masterball:1551326387455926432>",
        sprite: "master-ball",
        price: 50000,
        multiplier: 255,
        guaranteed: true,
      },
    },
  },
  evolution: {
    // Le stade 1 n'est la cible que d'un bébé (Pichu → Pikachu, à partir de la
    // génération 2) : sa forme adulte est aussi commune que lui, d'où un tarif
    // plus doux que celui des vraies évolutions.
    1: { duplicates: 2, points: 250 },
    2: { duplicates: 5, points: 500 },
    3: { duplicates: 10, points: 2000 },
    branchChoicePoints: 1000,
  },
  trade: { expiryHours: 24 },
  // Les œufs, seule porte vers les bébés. Un couple de parents — un mâle et une
  // femelle de la famille, Métamorph pouvant tenir l'un des deux rôles — pond
  // un œuf qui éclot au premier des deux seuils : tant d'heures, ou tant de
  // messages de son propriétaire. Chaque parent ne pond qu'une fois dans sa vie.
  eggs: {
    enabled: true,
    hatchHours: 120,
    hatchMessages: 200,
  },
  pokedex: { pageSize: 30 },
  box: { pageSize: 15 },
  // Catalogue des objets. L'inventaire ne stocke qu'une clé et un compteur :
  // c'est ici que la clé prend un nom et une icône, réglables à chaud comme ceux
  // des balls. L'effet, lui, vit dans le code de la fonctionnalité qui consomme
  // l'objet — une clé sans effet reste un objet de collection valide.
  //
  // `ball` fait pointer l'objet vers une ball de capture : il en emprunte le
  // libellé et l'icône, donc changer l'emoji d'une ball suffit, l'objet suit.
  // `sellValue` rend l'objet revendable, et rien d'autre ne le rend revendable.
  // `dropWeight` le fait tomber des Pokémon, et rien d'autre : un objet sans
  // poids ne se trouve pas. L'ordre des clés est celui de l'affichage, et les
  // poids vont du plus commun au plus rare.
  //
  // `lot` est la fourchette dans laquelle la loterie tire une quantité. Un objet
  // sans `lot` se gagne à l'unité, ce qui est le cas de tout ce qui ne se joue
  // pas par poignées : une pierre, une pépite, un ticket, une Master Ball.
  //
  // `lotteryWeight` remplace `dropWeight` à la loterie, et seulement là. Les deux
  // tables ont été la même jusqu'à ce que la loterie doive donner quelque chose
  // sept fois sur dix : ouvrir sa porte rendait les lots rares d'autant plus
  // fréquents, alors qu'un Pokémon sur quinze tient toujours un objet. Les balls
  // y pèsent donc plus lourd (640 et 330 contre 400 et 200), ce qui ramène la
  // Pépite et la Master Ball à la cadence qu'elles avaient à 50 % — une tous les
  // 92 jours, une tous les 615 — sans toucher à ce que tiennent les Pokémon.
  //
  // `evolution` le rend utilisable dans une fusion : `quantity` exemplaires de
  // l'objet tiennent lieu de `copies` exemplaires du Pokémon, `freePoints`
  // dispense du coût en points, et `from`/`target` l'enferment dans une lignée
  // précise — c'est ce qui fait des pierres des objets à Évoli.
  //
  // Repère : avec 10 % de porteurs et 921 de poids total, la Master Ball tombe
  // une fois sur trois mille apparitions environ.
  //
  // Ajouter un objet demande de toucher ici ET au code qui le consomme :
  // /admin config modifie une valeur existante, il n'invente pas de clé.
  items: {
    ball_poke: {
      ball: "poke",
      description: "Un lancer offert : tu la tiens déjà, elle ne te coûtera rien.",
      dropWeight: 400,
      lotteryWeight: 640,
      lot: { min: 1, max: 5 },
    },
    ball_super: {
      ball: "super",
      description: "Un lancer offert : tu la tiens déjà, elle ne te coûtera rien.",
      dropWeight: 200,
      lotteryWeight: 330,
      lot: { min: 1, max: 3 },
    },
    super_bonbon: {
      label: "Super Bonbon",
      emoji: "🍬",
      sprite: "rare-candy",
      description: "Trois d'entre eux tiennent lieu d'un exemplaire manquant dans une fusion.",
      sellValue: 300,
      dropWeight: 120,
      evolution: { copies: 1, quantity: 3 },
      lot: { min: 1, max: 2 },
    },
    ball_hyper: {
      ball: "hyper",
      description: "Un lancer offert : tu la tiens déjà, elle ne te coûtera rien.",
      dropWeight: 80,
      lot: { min: 1, max: 2 },
    },
    pierre_feu: {
      label: "Pierre Feu",
      emoji: "🔥",
      sprite: "fire-stone",
      description: "Fait évoluer un Évoli en Pyroli : un exemplaire suffit, et c'est gratuit.",
      sellValue: 500,
      dropWeight: 30,
      evolution: { copies: 1, quantity: 1, freePoints: true, from: 133, target: 136 },
    },
    pierre_foudre: {
      label: "Pierre Foudre",
      emoji: "⚡",
      sprite: "thunder-stone",
      description: "Fait évoluer un Évoli en Voltali : un exemplaire suffit, et c'est gratuit.",
      sellValue: 500,
      dropWeight: 30,
      evolution: { copies: 1, quantity: 1, freePoints: true, from: 133, target: 135 },
    },
    pierre_eau: {
      label: "Pierre Eau",
      emoji: "💧",
      sprite: "water-stone",
      description: "Fait évoluer un Évoli en Aquali : un exemplaire suffit, et c'est gratuit.",
      sellValue: 500,
      dropWeight: 30,
      evolution: { copies: 1, quantity: 1, freePoints: true, from: 133, target: 134 },
    },
    pepite: {
      label: "Pépite",
      emoji: "💎",
      sprite: "nugget",
      description: "Ça brille, et ça ne sert qu'à ça : se revendre.",
      sellValue: 2000,
      dropWeight: 20,
    },
    ticket_safari: {
      label: "Ticket Safari",
      emoji: "🎟️",
      sprite: "pass",
      description: "Une entrée pour le parc safari. Elle s'utilise, elle ne se monnaie pas.",
      dropWeight: 8,
    },
    ball_master: {
      ball: "master",
      description: "La capture garantie, offerte. Autant dire qu'elle ne se trouve pas.",
      dropWeight: 3,
    },
  },
  // Revente d'un doublon, par rareté. C'est une consolation, pas un commerce :
  // au taux moyen de chaque tranche et à l'Hyper Ball, une capture coûte ~510,
  // ~1 030 et ~1 690 points. Aucun tarif ne doit jamais dépasser ce coût espéré,
  // sans quoi la chasse devient une imprimerie à points.
  //
  // Le barème suit la rareté affichée partout ailleurs (la pastille de couleur)
  // plutôt que le taux de capture : c'est le repère que les dresseurs ont déjà.
  // Une rareté absente du barème ne se revend pas — c'est le cas des
  // légendaires, qu'on ne monnaie pas.
  sell: {
    byRarity: { COMMUN: 250, PEU_COMMUN: 600, RARE: 1500 },
    // 0 : un shiny ne se revend pas. C'est une entrée de Pokédex qu'on ne
    // retrouve pas, et personne ne doit pouvoir la brader d'un clic.
    shinyMultiplier: 0,
  },
  // Le tirage quotidien. Un seul par dresseur et par jour UTC, comme le
  // classement des messages qui se remet à zéro sur la même journée : deux
  // découpages différents du mot « jour » dans le même bot seraient ingérables.
  //
  // Il tire dans la même table que le butin des Pokémon, `dropWeight`, parce
  // qu'il n'y a qu'un ordre de rareté dans le jeu et qu'en maintenir deux, c'est
  // les voir diverger. Seule la porte d'entrée change : 7 % des Pokémon tiennent
  // un objet, la moitié des tirages en donnent un.
  //
  // `lotDecay` donne sa forme au lot : chaque exemplaire de plus est `lotDecay`
  // fois moins probable que le précédent. À 1 le tirage est uniforme, et c'était
  // son défaut d'origine — cinq Poké Balls tombaient aussi souvent qu'une seule.
  // À 0,5, un lot sur deux est le plus petit possible, et le gros lot redevient
  // un événement.
  //
  // Repère aux réglages actuels : ~267 points de valeur par jour et par dresseur,
  // un dixième d'une journée de messages. Un gain sur deux est une ou deux Poké
  // Balls, ou une Super Ball.
  lottery: {
    enabled: true,
    winChance: 0.7,
    lotDecay: 0.5,
  },
  safari: {
    enabled: true,
    randomChancePerHour: 0.01,
    minHoursBetweenParks: 48,
    parkDurationHours: 24,
    spawnPauseHours: 6,
    // Une visite court jusqu'à la fermeture du parc ; ceci n'en est que le
    // plancher, pour qui entre juste avant la fin — et toute la durée d'une
    // entrée payante, qui n'a pas de parc derrière elle.
    sessionMinDurationMinutes: 60,
    actionsPerSession: 25,
    entryPrice: 5000,
    entryCooldownHours: 24,
    ball: { label: "Safari Ball", emoji: "\u{1F7E2}", sprite: "safari-ball", multiplier: 1.5 },
    // Multiplicatif et cumulable, mais plafonné : deux appâts atteignent le
    // plafond, le troisième est une action gaspillée. C'est là qu'est le choix.
    baitMultiplier: 2,
    baitMaxMultiplier: 4,
    fleeFailChance: 0.1,
    // La fuite part de wildFleeChance et monte de wildFleeChancePerBait par
    // baie avalée : 5 % à jeun, 11 % après deux appâts.
    wildFleeChance: 0.05,
    wildFleeChancePerBait: 0.03,
    shinyOdds: 250,
    // La compensation suit le malus sauvage, qui s'est adouci : ×1,5 au
    // stade 2, ×2,4 au stade 3, ×3 pour un légendaire.
    weightsByStage: { 1: 100, 2: 90, 3: 60 },
    legendaryWeight: 24,
  },
};
export const DEFAULTS = {
  // Points gagnés selon le rang du message dans la journée du dresseur.
  messagePointsDistribution: {
    1: 750,
    2: 600,
    3: 500,
    4: 400,
    5: 350,
    6: 300,
    default: 300,
  },
  pokemon: POKEMON,
  // L'API de l'interface web (modules/web). Elle ne démarre que si WEB_PORT est
  // défini ; ces réglages ne jouent qu'ensuite.
  web: {
    // Durée d'une session avant qu'il faille se reconnecter par Discord.
    sessionHours: 168,
    // Garde-fou contre une boucle ou un script, par dresseur.
    writesPerMinute: 30,
    // Cadence à laquelle l'onglet Capture relit l'apparition en cours : assez
    // vif pour suivre une course, assez lent pour ne pas marteler le serveur à
    // chaque onglet ouvert.
    spawnRefreshSeconds: 5,
  },
  // Pot commun : chacun cotise une part de sa fortune, et la cagnotte repart en
  // parts égales. Un impôt sur le capital, en somme — les gros soldes financent,
  // tout le monde reçoit la même chose.
  //
  // Le prélèvement est obligatoire, automatique et SILENCIEUX : rien n'est
  // annoncé, aucun joueur n'est notifié. C'est un réglage de l'économie, pas un
  // événement. D'où l'absence de toute option d'annonce ici.
  redistribution: {
    enabled: true,
    // Une fois par semaine. Changer cette valeur ne déplace pas l'échéance déjà
    // posée : elle s'applique à partir du pot suivant.
    intervalHours: 168,
    // Part de la fortune prélevée, en pourcentage. Les soldes négatifs ou nuls
    // ne cotisent pas, mais reçoivent leur part comme les autres.
    contributionPercent: 5,
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

// Le fichier tel qu'il est sur le disque, sans fusion. C'est lui qu'on réécrit :
// sauvegarder la version fusionnée figerait tous les défauts dans le fichier et
// détruirait la propriété « clé absente = valeur par défaut ».
// Une couche du fichier, sans fusion. C'est la lecture STRICTE : elle lève.
// L'écriture en dépend — repartir d'un {} sur un fichier illisible effacerait
// en silence toutes les surcharges déjà posées.
function readLayer(file, { optional = false, strict = false } = {}) {
  // La surcharge n'existe pas tant que personne n'a rien réglé, ce qui est le
  // cas courant : on l'écarte par un stat plutôt que par une exception, dont la
  // pile coûterait cher sur un chemin parcouru à chaque message.
  if (optional && !fs.existsSync(file)) return {};
  // `strict` lève au lieu de rendre {}. La lecture en est le seul usage
  // tolérant : l'écriture, elle, doit échouer plutôt que de repartir d'une page
  // blanche qui effacerait en silence toutes les surcharges déjà posées.
  if (strict) return JSON.parse(fs.readFileSync(file, "utf8"));
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    handleException(`Lecture de ${path.basename(file)} impossible :`, error);
    return {};
  }
}

// La surcharge est-elle lisible ? Sans cette question, un fichier corrompu fait
// silencieusement retomber tous les réglages sur leurs défauts, et
// /admin config-voir affiche ces défauts comme valeur courante sans un mot.
export function configOverrideStatus() {
  if (!fs.existsSync(overridePath)) return { ok: true, exists: false };
  try {
    readLayer(overridePath, { strict: true });
    return { ok: true, exists: true };
  } catch (error) {
    return {
      ok: false,
      exists: true,
      reason:
        "⚠️ `config.local.json` est illisible : **tous les réglages modifiés depuis Discord sont " +
        `ignorés** et les valeurs par défaut s'appliquent. Détail : ${error.message}`,
    };
  }
}

// Relu à chaque appel : tous les nombres du bot sont ajustables sans redémarrer.
export function getConfig() {
  return merge(merge(DEFAULTS, readLayer(configPath)), readLayer(overridePath, { optional: true }));
}

// ====================== SCHÉMA ======================

// Type d'une valeur par défaut, qui est aussi le type imposé à la nouvelle.
// Les tableaux ne contiennent aujourd'hui que des chaînes (pingRarities), qu'on
// saisit séparées par des virgules.
function typeOf(value) {
  if (Array.isArray(value)) return "liste";
  if (isPlainObject(value)) return "objet";
  return typeof value === "number" ? "nombre" : typeof value === "boolean" ? "booléen" : "texte";
}

function walk(node, prefix, out) {
  for (const [key, value] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) walk(value, full, out);
    else out.push({ path: full, type: typeOf(value) });
  }
  return out;
}

// Tous les chemins modifiables, filtrés sur la saisie en cours. Les nœuds
// intermédiaires en sont absents : ils se parcourent, ils ne s'écrivent pas.
export function listConfigPaths(query = "") {
  const needle = String(query).toLowerCase();
  return walk(DEFAULTS, "", []).filter((entry) => entry.path.toLowerCase().includes(needle));
}

function descend(root, segments) {
  let node = root;
  for (const segment of segments) {
    if (!isPlainObject(node) || !Object.prototype.hasOwnProperty.call(node, segment)) return undefined;
    node = node[segment];
  }
  return node;
}

// Valeur courante face à la valeur par défaut. `path` peut désigner une branche
// entière, ce dont /admin config-voir se sert pour afficher un bloc.
export function readConfigValue(path) {
  const segments = String(path).split(".").filter(Boolean);
  const fallback = descend(DEFAULTS, segments);
  if (fallback === undefined) return { ok: false, reason: `Réglage inconnu : \`${path}\`` };
  return {
    ok: true,
    path: segments.join("."),
    type: typeOf(fallback),
    current: descend(getConfig(), segments),
    fallback,
  };
}

// ====================== ÉCRITURE ======================

// La dernière génération que contient le jeu de données Pokémon. Lue une fois,
// et sans faire tomber le bot si le fichier manque : data.js, qui en dépend
// vraiment, s'en chargera bien assez tôt.
function datasetMaxGeneration() {
  try {
    const file = path.join(__dirname, "pokemon-data.json");
    return JSON.parse(fs.readFileSync(file, "utf8")).maxGeneration;
  } catch (error) {
    handleException("Lecture du jeu de données Pokémon :", error);
    return undefined;
  }
}

// Bornes des réglages dont une faute de frappe ne se rattrape pas. Le type seul
// ne protège de rien : `contributionPercent: 50` est un nombre parfaitement
// valide, et couperait en deux la fortune de tout le monde à l'échéance
// suivante — sans annonce, sans confirmation et sans opération inverse.
const BOUNDS = {
  "redistribution.contributionPercent": { min: 0, max: 100 },
  "redistribution.intervalHours": { min: 1 },
  // Diviseur : embeds.js fait Math.ceil(dexSize() / pageSize), donc 0 donne un
  // Pokédex au nombre de pages infini et vide.
  "pokemon.pokedex.pageSize": { min: 1 },
  "pokemon.box.pageSize": { min: 1, max: 25 },
  // À 0, chaque onglet ouvert relirait l'apparition en boucle.
  "web.spawnRefreshSeconds": { min: 2, max: 60 },
  // Math.floor(Math.random() * odds) === 0 : à 0, tout devient shiny.
  "pokemon.spawn.shinyOdds": { min: 1 },
  "pokemon.safari.shinyOdds": { min: 1 },
  // On n'ouvre que ce que le jeu de données contient. Le plafond est lu dans le
  // fichier plutôt qu'écrit ici : préparer la génération suivante, c'est
  // régénérer ce fichier, et rien d'autre ne doit avoir à suivre.
  "pokemon.generation": { min: 1, max: datasetMaxGeneration() },
};

// Plancher déduit du défaut : un réglage dont la valeur par défaut est positive
// ou nulle refuse le négatif. Rien de plus.
//
// Déduire un plancher de 1 des défauts valant au moins 1 était tentant et faux :
// cela interdisait du même coup toute valeur fractionnaire en dessous de 1, donc
// globalMultiplier à 0,5 — le seul levier pour durcir les captures — et
// ball.multiplier en dessous de son défaut. Le zéro aussi est légitime presque
// partout : un poids de stade à 0 exclut ce stade, un prix d'entrée à 0 rend le
// parc gratuit. Les vrais pièges sont nommés un par un dans BOUNDS.
function checkBounds(key, value, fallback) {
  const bounds = BOUNDS[key] ?? {};
  const min = bounds.min ?? (fallback >= 0 ? 0 : undefined);
  if (min !== undefined && value < min) {
    return `\`${value}\` est en dessous du minimum autorisé (${min}).`;
  }
  if (bounds.max !== undefined && value > bounds.max) {
    return `\`${value}\` dépasse le maximum autorisé (${bounds.max}).`;
  }
  return null;
}

// Convertit la saisie brute au type qu'impose la valeur par défaut, ou explique
// le refus. C'est ici, et nulle part ailleurs, que se décide ce qui est écrivable.
function coerce(raw, fallback, key) {
  const type = typeOf(fallback);
  if (type === "objet") {
    return { ok: false, reason: "Ce réglage est une branche, pas une valeur : précise une clé dedans." };
  }
  if (type === "nombre") {
    const value = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(value)) return { ok: false, reason: `\`${raw}\` n'est pas un nombre.` };
    const outOfBounds = checkBounds(key, value, fallback);
    if (outOfBounds) return { ok: false, reason: outOfBounds };
    return { ok: true, value };
  }
  if (type === "booléen") {
    const normalized = String(raw).trim().toLowerCase();
    if (["true", "vrai", "oui", "1"].includes(normalized)) return { ok: true, value: true };
    if (["false", "faux", "non", "0"].includes(normalized)) return { ok: true, value: false };
    return { ok: false, reason: `\`${raw}\` n'est ni vrai ni faux.` };
  }
  if (type === "liste") {
    const value = String(raw).split(",").map((part) => part.trim()).filter(Boolean);
    if (!value.length) return { ok: false, reason: "Liste vide : sépare les valeurs par des virgules." };
    return { ok: true, value };
  }
  return { ok: true, value: String(raw) };
}

// Écriture atomique : le bot relit ce fichier en permanence, il ne doit jamais
// en voir une version tronquée. On écrit à côté, on relit pour prouver que c'est
// du JSON valide, puis on renomme — atomique sur le même système de fichiers.
function saveOverride(next) {
  const temp = `${overridePath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(next, null, "\t")}\n`, "utf8");
  JSON.parse(fs.readFileSync(temp, "utf8"));
  fs.renameSync(temp, overridePath);
}

export function writeConfigValue(path, raw) {
  const segments = String(path).split(".").filter(Boolean);
  if (!segments.length) return { ok: false, reason: "Aucun réglage indiqué." };
  if (segments.some((segment) => FORBIDDEN_KEYS.has(segment))) {
    return { ok: false, reason: "Chemin interdit." };
  }

  // Le schéma valide AVANT toute écriture : clé inconnue ou mauvais type sont
  // refusés sans que le fichier soit touché.
  const fallback = descend(DEFAULTS, segments);
  if (fallback === undefined) return { ok: false, reason: `Réglage inconnu : \`${path}\`` };
  const key = segments.join(".");
  const coerced = coerce(raw, fallback, key);
  if (!coerced.ok) return coerced;

  const before = descend(getConfig(), segments);
  try {
    // On repart de la surcharge SEULE, pas de la config fusionnée : réécrire la
    // fusion figerait tous les défauts dans le fichier et détruirait la
    // propriété « clé absente = valeur du dessous ».
    //
    // Et en lecture STRICTE : une surcharge illisible doit faire échouer la
    // commande, pas repartir d'une page blanche qui effacerait sans un mot tous
    // les réglages déjà posés.
    const next = readLayer(overridePath, { optional: true, strict: true });
    let node = next;
    for (const segment of segments.slice(0, -1)) {
      if (!isPlainObject(node[segment])) node[segment] = {};
      node = node[segment];
    }
    node[segments.at(-1)] = coerced.value;
    saveOverride(next);
  } catch (error) {
    handleException("Écriture de config.local.json impossible :", error);
    return {
      ok: false,
      reason:
        "Impossible d'écrire la surcharge de configuration — `config.local.json` est peut-être illisible.",
    };
  }

  return { ok: true, path: key, before, after: coerced.value };
}

// ====================== RENDU ======================
//
// Deux formats, une seule définition. Les commandes en avaient chacune leur
// version, et les trois divergeaient déjà sur le séparateur de liste.

// Forme courte, sur une ligne, sans décoration : pour une liste ou un libellé
// d'autocomplétion.
export function previewConfigValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (isPlainObject(value)) return `{ ${Object.keys(value).length} réglage(s) }`;
  return String(value);
}

// Forme détaillée, pour l'affichage d'une valeur seule.
export function formatConfigValue(value) {
  if (isPlainObject(value)) return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
  if (Array.isArray(value)) return previewConfigValue(value);
  return `\`${value}\``;
}

// Les chemins avec leur valeur courante, la config n'étant lue QU'UNE FOIS.
// readConfigValue relit et refusionne le fichier à chaque appel : l'enchaîner
// sur les septante-deux feuilles, c'est autant de lectures synchrones qui
// bloquent la boucle d'événements — et le bot n'en a qu'une.
export function listConfigEntries(query = "") {
  const config = getConfig();
  return listConfigPaths(query).map((entry) => ({
    ...entry,
    current: descend(config, entry.path.split(".")),
  }));
}

// Les 25 propositions d'autocomplétion, prêtes pour interaction.respond().
// Chacune montre sa valeur courante : on choisit un réglage en voyant ce qu'on
// s'apprête à remplacer. Discord plafonne un libellé à 100 caractères.
export function configChoices(query) {
  return listConfigEntries(query)
    .slice(0, 25)
    .map(({ path, type, current }) => {
      const name = `${path} — ${previewConfigValue(current)} (${type})`;
      return { name: name.length > 100 ? `${name.slice(0, 97)}...` : name, value: path };
    });
}
