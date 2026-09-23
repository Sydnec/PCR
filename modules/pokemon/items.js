// L'inventaire des dresseurs : catalogue, crédits, consommations.
//
// Un objet n'est qu'un compteur par clé. Ce qui lui donne un nom et une icône
// vit dans `pokemon.items` de la configuration, comme les balls, donc tout ça se
// règle à chaud ; ce qui lui donne un effet vit dans le code de la
// fonctionnalité qui le consomme, jamais ici. Une clé sans effet reste un objet
// parfaitement valide — un trophée se collectionne très bien.
//
// Même doctrine que le reste du module Pokémon : rien en mémoire, et toute
// dépense passe par un UPDATE gardé dont on inspecte this.changes. Un objet
// consommé deux fois par deux clics simultanés serait exactement le bug que
// spendPoints évite déjà sur les points.
import db from "../points-db.js";
import { handleException } from "../utils.js";
import { getBall, getPokemonConfig } from "./config.js";

// D'où vient le mouvement. Journalisé tel quel : le jour où un dresseur jure
// n'avoir jamais reçu son ticket, c'est cette colonne qui répond.
const SOURCE_INCONNUE = "inconnu";

// ====================== CATALOGUE ======================

// Une définition complète, prête à afficher. Un objet adossé à une ball
// (`ball: "poke"`) en emprunte le libellé et l'icône : changer l'emoji d'une
// ball suffit alors, l'objet suit, et il n'y a pas deux endroits à maintenir
// d'accord. L'objet garde le dernier mot s'il pose les siens.
function resolve(key, item) {
  if (!item) return null;
  const ball = item.ball ? getBall(item.ball) : null;
  return {
    key,
    ...item,
    label: item.label ?? ball?.label ?? key,
    emoji: item.emoji ?? ball?.emoji ?? "\u{1F4E6}",
    sprite: item.sprite ?? ball?.sprite ?? null,
  };
}

export function getItems() {
  const items = getPokemonConfig().items ?? {};
  return Object.entries(items).map(([key, item]) => resolve(key, item));
}

// Renvoie la définition d'un objet, ou null si la clé est inconnue.
// hasOwnProperty et pas `items[key]` : sans lui, « constructor » renvoyait un
// objet tronqué au lieu de null — la même chicane que getBall.
export function getItem(key) {
  const items = getPokemonConfig().items ?? {};
  if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(items, key)) {
    return null;
  }
  return resolve(key, items[key]);
}

// Ce qui se revend, et à combien. Un objet sans sellValue ne se revend pas :
// c'est le catalogue qui décide, pas la commande.
export const itemSellValue = (item) => {
  const value = Math.round(Number(item?.sellValue) || 0);
  return value > 0 ? value : 0;
};

// Trie des lignes d'inventaire dans l'ordre du catalogue. La base rend un tri
// alphabétique sur les clés, où « ball_hyper » précède « ball_poke » — un ordre
// qui n'a de sens pour personne. Les clés hors catalogue ferment la marche
// plutôt que de disparaître.
export function sortByCatalogue(rows) {
  const order = new Map(Object.keys(getPokemonConfig().items ?? {}).map((key, i) => [key, i]));
  const rank = (row) => order.get(row.item_key) ?? Number.MAX_SAFE_INTEGER;
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.item_key.localeCompare(b.item_key));
}

// L'objet qui offre un lancer de cette ball, s'il existe. On interroge le
// catalogue plutôt que de composer « ball_ » + la clé : c'est le catalogue qui
// décide, et une convention de nommage n'est pas un contrat.
export function getBallItem(ballKey) {
  return getItems().find((item) => item.ball === ballKey) ?? null;
}

// ====================== BUTIN ======================

// Un objet ne tombe que si le catalogue lui donne un poids. Celui dont l'effet
// n'est pas encore branché n'en a pas, donc personne ne peut se retrouver avec
// un objet qui ne fait rien.
export const itemDropWeight = (item) => Math.max(0, Number(item?.dropWeight) || 0);

// Le poids d'un objet à la loterie. Il retombe sur `dropWeight` tant que le
// catalogue n'en dit rien, donc seuls les objets réellement retouchés portent la
// clé en plus.
//
// Les deux tables ont longtemps été la même, et c'était juste tant qu'elles
// répondaient à la même question. Elles ont divergé le jour où la loterie a dû
// donner quelque chose sept fois sur dix : ouvrir sa porte rendait du même coup
// les lots rares plus fréquents, alors qu'un Pokémon sur quinze tient toujours un
// objet. On dilue donc la loterie avec du poids de balls, et le butin ne bouge
// pas d'un cheveu.
export const itemLotteryWeight = (item) => {
  const weight = Number(item?.lotteryWeight);
  return Number.isFinite(weight) && weight >= 0 ? weight : itemDropWeight(item);
};

// Tirage pondéré, même forme que pickWeightedSpecies : un cumul, un tirage, et
// le dernier en filet si l'arrondi flottant passe juste au-dessus du total.
//
// `weightOf` se passe explicitement, sans valeur par défaut : deux tables se
// partagent ce tirage, et un appelant qui ne dit pas laquelle il veut est un
// appelant qui n'y a pas pensé.
export function pickWeightedItem(weightOf) {
  const pool = [];
  let total = 0;
  for (const item of getItems()) {
    const weight = weightOf(item);
    if (weight > 0) {
      total += weight;
      pool.push({ item, cumulative: total });
    }
  }
  if (!total) return null;
  const roll = Math.random() * total;
  return (pool.find((entry) => roll < entry.cumulative) ?? pool[pool.length - 1]).item;
}

// Combien d'exemplaires d'un objet forment un lot de loterie. Le catalogue
// donne une fourchette aux objets qui se gagnent par poignées ; les autres n'en
// ont pas et se gagnent à l'unité, ce qui évite d'écrire `lot: { min: 1, max: 1 }`
// sur les deux tiers du catalogue.
//
// Les bornes sont relues à chaque tirage plutôt que figées : `lot.max` se règle
// à chaud comme le reste, et une borne absurde (max sous min, valeur négative)
// se rabat sur quelque chose de jouable au lieu de faire planter la commande.
export function itemLot(item) {
  const borne = (value, fallback) => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) && number > 0 ? number : fallback;
  };
  const min = borne(item?.lot?.min, 1);
  return { min, max: Math.max(min, borne(item?.lot?.max, min)) };
}

// Ce que tient un Pokémon qui vient d'apparaître, ou null. Tiré à l'apparition
// et figé dans la ligne : ce qu'il porte lui appartient, ça ne se décide pas au
// moment où quelqu'un l'attrape.
export function rollHeldItem() {
  const chance = Number(getPokemonConfig().spawn?.heldItemChance) || 0;
  if (chance <= 0 || Math.random() >= chance) return null;
  return pickWeightedItem(itemDropWeight)?.key ?? null;
}

// ====================== LECTURES ======================

// L'inventaire, objets épuisés exclus. La ligne à zéro reste en base pour garder
// first_obtained_at, donc c'est bien au filtre de l'écarter.
export function getInventory(userId, cb) {
  db.all(
    `SELECT item_key, count, first_obtained_at, last_obtained_at
       FROM pokemon_inventory
      WHERE user_id = ? AND count > 0
      ORDER BY item_key`,
    [userId],
    (err, rows) => cb(err, rows || [])
  );
}

// Les balls en poche, dans l'ordre du catalogue : ce qu'on peut lancer sans
// payer. Est une ball tout objet adossé à une ball (`ball: "poke"`), quelle que
// soit sa clé — c'est le catalogue qui décide, comme pour getBallItem. Rend des
// lignes déjà mises en forme ({ label, emoji, count }) : l'embed du solde vit
// dans economy.js, qui n'a pas à connaître le catalogue.
export function getBallStock(userId, cb) {
  getInventory(userId, (err, rows) => {
    if (err) return cb(err, []);
    const stock = [];
    for (const row of sortByCatalogue(rows)) {
      const item = getItem(row.item_key);
      if (item?.ball) {
        const { key, label, emoji, sprite } = item;
        stock.push({ key, label, emoji, sprite, count: row.count });
      }
    }
    cb(null, stock);
  });
}

export function getItemCount(userId, key, cb) {
  db.get(
    "SELECT count FROM pokemon_inventory WHERE user_id = ? AND item_key = ?",
    [userId, key],
    (err, row) => cb(err, row ? row.count : 0)
  );
}

// ====================== JOURNAL ======================

// Au mieux : un journal qui échoue ne doit pas défaire un objet déjà crédité ou
// déjà consommé. On le signale et on continue, comme pour pokemon_fusions.
function logMovement(userId, key, delta, source) {
  db.run(
    `INSERT INTO pokemon_item_log (user_id, item_key, delta, source, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, key, delta, source || SOURCE_INCONNUE, Date.now()],
    (err) => {
      if (err) handleException("Journal des objets :", err);
    }
  );
}

export function getItemHistory(userId, limit, cb) {
  db.all(
    `SELECT item_key, delta, source, created_at FROM pokemon_item_log
      WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    [userId, limit],
    (err, rows) => cb(err, rows || [])
  );
}

// ====================== ÉCRITURES ======================

// Les deux mutations valident la même chose, et la refusent de la même façon :
// une clé hors catalogue serait une ligne d'inventaire que personne ne saurait
// plus afficher, et une quantité absurde une façon discrète de fabriquer des
// objets. Mieux vaut une erreur bruyante que l'une ou l'autre.
function check(key, quantity) {
  if (!getItem(key)) return new Error(`Objet inconnu : ${key}`);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return new Error(`Quantité invalide : ${quantity}`);
  }
  return null;
}

// Chemin unique de crédit — trésor, compensation d'administrateur, récompense
// de visite : tout passe ici, sinon la règle « on garde la ligne à zéro » finit
// par diverger entre les copies.
export function grantItem(userId, key, quantity = 1, { source } = {}, cb = () => {}) {
  const invalid = check(key, quantity);
  if (invalid) return cb(invalid);

  const now = Date.now();
  db.run(
    `INSERT INTO pokemon_inventory (user_id, item_key, count, first_obtained_at, last_obtained_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, item_key) DO UPDATE SET
       count = count + excluded.count,
       first_obtained_at = COALESCE(first_obtained_at, excluded.first_obtained_at),
       last_obtained_at = excluded.last_obtained_at`,
    [userId, key, quantity, now, now],
    (err) => {
      if (err) return cb(err);
      logMovement(userId, key, quantity, source);
      cb(null, true);
    }
  );
}

// La seule écriture qui retire un objet, et elle ne retire que ce qui existe :
// `count >= ?` dans le WHERE, this.changes qui tranche. Deux clics simultanés
// sur le même ticket, un seul l'emporte — et le perdant reçoit false, pas une
// erreur, parce que « tu ne l'as plus » n'est pas une panne.
export function consumeItem(userId, key, quantity = 1, { source } = {}, cb = () => {}) {
  const invalid = check(key, quantity);
  if (invalid) return cb(invalid, false);

  db.run(
    `UPDATE pokemon_inventory SET count = count - ?
      WHERE user_id = ? AND item_key = ? AND count >= ?`,
    [quantity, userId, key, quantity],
    function (err) {
      if (err) return cb(err, false);
      const consumed = this.changes === 1;
      if (consumed) logMovement(userId, key, -quantity, source);
      cb(null, consumed);
    }
  );
}
