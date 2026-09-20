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
    // Les emoji des balls sont ceux du serveur, au format Discord `<:nom:id>`.
    // C'est l'identifiant qui décide de l'image affichée, jamais le nom : le
    // renommer côté serveur ne casse rien, le supprimer si. Ce format-là rend
    // aussi bien dans le texte d'un embed que sur un bouton, là où l'identifiant
    // nu ne marcherait que sur le bouton. Un emoji unicode ordinaire reste une
    // valeur valide, ce qui laisse de quoi dépanner depuis /admin config si le
    // bot perd l'accès au serveur qui les héberge.
    balls: {
      poke: { label: "Poké Ball", emoji: "<:pokeball:1551325915160514690>", price: 150, multiplier: 1 },
      super: { label: "Super Ball", emoji: "<:superball:1551325951361679411>", price: 400, multiplier: 2 },
      hyper: { label: "Hyper Ball", emoji: "<:hyperball:1551326031431077898>", price: 1000, multiplier: 4 },
      master: {
        label: "Master Ball",
        emoji: "<:masterball:1551326387455926432>",
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
    ball: { label: "Safari Ball", emoji: "\u{1F7E2}", multiplier: 1.5 },
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
    weightsByStage: { 1: 100, 2: 70, 3: 40 },
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
  // Math.floor(Math.random() * odds) === 0 : à 0, tout devient shiny.
  "pokemon.spawn.shinyOdds": { min: 1 },
  "pokemon.safari.shinyOdds": { min: 1 },
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
