// Le sac des dresseurs : catalogue, crédits, consommations.
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
import { getPokemonConfig } from "./config.js";

// D'où vient le mouvement. Journalisé tel quel : le jour où un dresseur jure
// n'avoir jamais reçu son ticket, c'est cette colonne qui répond.
const SOURCE_INCONNUE = "inconnu";

// ====================== CATALOGUE ======================

export function getItems() {
  const items = getPokemonConfig().items ?? {};
  return Object.entries(items).map(([key, item]) => ({ key, ...item }));
}

// Renvoie la définition d'un objet, ou null si la clé est inconnue.
// hasOwnProperty et pas `items[key]` : sans lui, « constructor » renvoyait un
// objet tronqué au lieu de null — la même chicane que getBall.
export function getItem(key) {
  const items = getPokemonConfig().items ?? {};
  if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(items, key)) {
    return null;
  }
  const item = items[key];
  return item ? { key, ...item } : null;
}

// Un nom affichable pour une clé qui n'est plus au catalogue. Renommer une clé
// ne doit pas faire disparaître en silence ce que les dresseurs ont en poche :
// mieux vaut afficher la clé brute et qu'on vienne poser la question.
export const itemLabel = (key) => getItem(key)?.label ?? key;

// ====================== LECTURES ======================

// Le sac, objets épuisés exclus. La ligne à zéro reste en base pour garder
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
