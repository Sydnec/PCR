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
import { addPoints } from "../economy.js";
import { handleException, log } from "../utils.js";
import { getBall, getPokemonConfig } from "./config.js";
import { activeGeneration } from "./data.js";

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

// Une définition, et pas un reste : la configuration fusionne aussi les clés
// que les défauts n'ont plus, si bien qu'un objet retiré du catalogue mais
// retouché un jour depuis Discord y reviendrait en fragment ({ dropWeight }),
// sans nom. Un objet se nomme, ou emprunte le nom de sa ball.
const isDefined = (item) => Boolean(item && (item.label || item.ball));

export function getItems() {
  const items = getPokemonConfig().items ?? {};
  return Object.entries(items)
    .filter(([, item]) => isDefined(item))
    .map(([key, item]) => resolve(key, item));
}

// Renvoie la définition d'un objet, ou null si la clé est inconnue.
// hasOwnProperty et pas `items[key]` : sans lui, « constructor » renvoyait un
// objet tronqué au lieu de null — la même chicane que getBall.
export function getItem(key) {
  const items = getPokemonConfig().items ?? {};
  if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(items, key)) {
    return null;
  }
  return isDefined(items[key]) ? resolve(key, items[key]) : null;
}

// Tous les objets s'échangent, sauf les charmes : ils se gagnent en complétant un
// Pokédex, et checkCharms les redonne à qui le complète encore. Cédé, un charme
// reviendrait à son premier porteur à la prochaine arrivée d'une espèce : un
// échange le dupliquerait. Les Charmes Chroma s'obtiennent, ils ne se transmettent pas.
// La Canne de base se donne à tous une fois (grantItemOnce) : échangée, elle serait
// redonnée, comme un charme.
export const isTradable = (item) => Boolean(item) && !item.charm && !item.rod?.base;

// Le Charme Chroma d'une génération, tel que le catalogue le déclare
// (`charm.generation`), ou null.
export const getCharmItem = (generation) =>
  getItems().find((item) => Number(item.charm?.generation) === Number(generation)) ?? null;

// Ce qui se revend, et à combien. Un objet sans sellValue ne se revend pas :
// c'est le catalogue qui décide, pas la commande.
export const itemSellValue = (item) => {
  const value = Math.round(Number(item?.sellValue) || 0);
  return value > 0 ? value : 0;
};

// Combien un dresseur peut en garder (`maxHeld`), ou null sans limite. La
// Master Ball n'en garde qu'une : en accumuler retirait toute tension aux
// légendaires.
export const itemCap = (item) => {
  const cap = Math.round(Number(item?.maxHeld) || 0);
  return cap > 0 ? cap : null;
};

// Ce que rapporte un exemplaire reçu au-delà de la limite (`overflowValue`).
export const itemOverflowValue = (item) => {
  const value = Math.round(Number(item?.overflowValue) || 0);
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

// Combien de lancers de `ballKey` un dresseur a en poche, lu dans ses lignes
// d'inventaire (getInventory) : ceux de l'objet que le lancer consommera
// (getBallItem), pour que ce qui s'annonce offert soit ce qui se lance.
export function freeBallCount(inventory, ballKey) {
  const item = getBallItem(ballKey);
  return item ? (inventory.find((row) => row.item_key === item.key)?.count ?? 0) : 0;
}

// ====================== BUTIN ======================

// Un objet ne tombe que si le catalogue lui donne un poids. Celui dont l'effet
// n'est pas encore branché n'en a pas, donc personne ne peut se retrouver avec
// un objet qui ne fait rien.
//
// Un objet d'une génération encore fermée ne tombe pas non plus : la Pierre
// Soleil n'a rien à faire évoluer tant que Joliflor n'existe pas.
// Une canne s'ouvre avec la pêche (`fishing.generation`), pas avec une génération écrite à
// part sur l'objet : les deux ne peuvent pas diverger.
export const itemGeneration = (item) =>
  Number(item?.rod ? getPokemonConfig().fishing?.generation : (item?.generation ?? 1));

export const itemOpen = (item) => itemGeneration(item) <= activeGeneration();

export const itemDropWeight = (item) =>
  itemOpen(item) ? Math.max(0, Number(item?.dropWeight) || 0) : 0;

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
  if (!itemOpen(item)) return 0;
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

// La part des tirages qui donnent un objet, pour une table (`weightOf`). Le
// réglage vaut pour les objets de la première génération ; ceux d'une
// génération ouverte ensuite s'ajoutent par-dessus sans rien retirer aux
// autres : chaque objet garde exactement sa chance d'avant, et les nouveaux
// prennent leur place sur « rien ». Plafonnée à 1 ; sans objet de première
// génération dans la table, le réglage s'applique tel quel.
function openedChance(chance, weightOf) {
  const setting = Math.max(0, Math.min(1, Number(chance) || 0));
  const items = getItems();
  const base = items
    .filter((item) => itemGeneration(item) <= 1)
    .reduce((sum, item) => sum + weightOf(item), 0);
  if (!base) return setting;
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  return Math.min(1, (setting * total) / base);
}

// Combien de Pokémon tiennent un objet (`spawn.heldItemChance` en première
// génération), et combien de tirages de loterie donnent un lot
// (`lottery.winChance`) : ce que tirent l'apparition et /pk loterie, et ce
// qu'affichent la page Infos et /admin poids.
export const heldItemChance = () =>
  openedChance(getPokemonConfig().spawn?.heldItemChance, itemDropWeight);
export const lotteryWinChance = () =>
  openedChance(getPokemonConfig().lottery?.winChance, itemLotteryWeight);

// Ce que tient un Pokémon qui vient d'apparaître, ou null. Tiré à l'apparition
// et figé dans la ligne : ce qu'il porte lui appartient, ça ne se décide pas au
// moment où quelqu'un l'attrape.
export function rollHeldItem() {
  const chance = heldItemChance();
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

// Le crédit lui-même. `cap` : la garde du plafond, dans la même instruction —
// le compte après crédit ne doit pas le dépasser, et this.changes dit si c'est
// passé. Deux gains simultanés, un seul sous la limite.
function credit(userId, key, quantity, source, cap, cb) {
  if (cap !== null && quantity > cap) return cb(null, false);
  const now = Date.now();
  db.run(
    `INSERT INTO pokemon_inventory (user_id, item_key, count, first_obtained_at, last_obtained_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, item_key) DO UPDATE SET
       count = count + excluded.count,
       first_obtained_at = COALESCE(first_obtained_at, excluded.first_obtained_at),
       last_obtained_at = excluded.last_obtained_at
     ${cap === null ? "" : "WHERE count + excluded.count <= ?"}`,
    [userId, key, quantity, now, now, ...(cap === null ? [] : [cap])],
    function (err) {
      if (err) return cb(err, false);
      const credited = this.changes === 1;
      if (credited) logMovement(userId, key, quantity, source);
      cb(null, credited);
    }
  );
}

// Chemin unique de crédit — trésor, compensation d'administrateur, récompense
// de visite : tout passe ici, sinon la règle « on garde la ligne à zéro » finit
// par diverger entre les copies.
//
// Un objet plafonné (`maxHeld`) se crédite à l'unité sous sa garde, et ce qui
// dépasse se vend `overflowValue` points pièce : on ne refuse pas un butin. Si
// ces points ne passent pas, l'exemplaire se garde au-delà de la limite plutôt
// que de se perdre. `overflow` règle les autres cas :
// - « ignore » : rendre ce qu'on vient de prendre (une compensation) ou ce
//   qu'un administrateur donne — la limite ne joue pas ;
// - « refuse » : tout ou rien, sans vente — l'échange, qui a vérifié avant et
//   compense si une course l'a pris de vitesse.
// `cb(err, { kept, sold, points })`, ou `cb(null, null)` pour un refus.
export function grantItem(
  userId,
  key,
  quantity = 1,
  { source, overflow = "sell" } = {},
  cb = () => {}
) {
  const invalid = check(key, quantity);
  if (invalid) return cb(invalid);

  const item = getItem(key);
  const cap = overflow === "ignore" ? null : itemCap(item);
  const whole = (err, credited) =>
    err ? cb(err) : cb(null, credited ? { kept: quantity, sold: 0, points: 0 } : null);
  if (cap === null || overflow === "refuse") {
    return credit(userId, key, quantity, source, cap, whole);
  }

  const value = itemOverflowValue(item);
  const result = { kept: 0, sold: 0, points: 0 };
  const next = (remaining) => {
    if (!remaining) return cb(null, result);
    credit(userId, key, 1, source, cap, (err, credited) => {
      if (err) return cb(err);
      if (credited) {
        result.kept++;
        return next(remaining - 1);
      }
      addPoints(userId, value, (err) => {
        if (!err) {
          result.sold++;
          result.points += value;
          logMovement(userId, key, 0, `vente-auto:${source || SOURCE_INCONNUE}`);
          return next(remaining - 1);
        }
        handleException(`Vente automatique d'un objet au-delà de la limite (${key}) :`, err);
        credit(userId, key, 1, source, null, (err) => {
          if (err) return cb(err);
          result.kept++;
          next(remaining - 1);
        });
      });
    });
  };
  next(quantity);
}

// Ce que dit un gain dont une part a été vendue d'office : la même phrase sur
// Discord et sur le site. null quand tout a été gardé.
export function overflowNotice(item, granted) {
  if (!granted?.sold) return null;
  const cap = itemCap(item);
  const label = item?.label ?? "cet objet";
  return (
    `Tu as déjà ${cap > 1 ? `${cap} ${label}` : `une ${label}`}, le maximum : ` +
    `${granted.sold > 1 ? `les ${granted.sold} de plus sont vendues` : "celle-ci est vendue"} ` +
    `**${granted.points.toLocaleString("fr-FR")}** points.`
  );
}

// Un objet qu'on ne possède qu'une fois, comme le Charme Chroma : l'écriture ne
// passe que s'il est absent — une ligne à zéro compte comme absente —, et
// `granted` dit si c'est elle qui l'a donné. Deux crédits simultanés, un seul
// gagnant, et une seule annonce.
export function grantItemOnce(userId, key, { source } = {}, cb = () => {}) {
  const invalid = check(key, 1);
  if (invalid) return cb(invalid, false);

  const now = Date.now();
  db.run(
    `INSERT INTO pokemon_inventory (user_id, item_key, count, first_obtained_at, last_obtained_at)
     VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(user_id, item_key) DO UPDATE SET
       count = 1,
       first_obtained_at = COALESCE(first_obtained_at, excluded.first_obtained_at),
       last_obtained_at = excluded.last_obtained_at
     WHERE count = 0`,
    [userId, key, now, now],
    function (err) {
      if (err) return cb(err, false);
      const granted = this.changes === 1;
      if (granted) logMovement(userId, key, 1, source);
      cb(null, granted);
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

// ====================== MIGRATION ======================

// Les Pierres Feu, Foudre et Eau deviennent des Évolytes, une pour une : elles
// ne servaient qu'à Évoli, et l'Évolyte y choisit n'importe laquelle de ses
// formes. Les objets tombés par terre et ceux que tient un Pokémon encore là
// suivent, pour qu'aucun ramassage ne donne un objet sorti du catalogue.
//
// Pas de transaction : la connexion est partagée, un ROLLBACK emporterait les
// écritures des autres (voir economy.js). Chaque lot se retire d'abord — gardé
// sur le compte lu, this.changes tranche —, puis l'Évolyte se crédite par
// grantItem, et la pierre revient si ce crédit échoue. Rejouable sans effet :
// un lot converti est à zéro, un second passage n'a plus rien à prendre. À
// retirer une fois déployé.
const RETIRED_STONES = ["pierre_feu", "pierre_foudre", "pierre_eau"];
const CONVERSION = "conversion-evolyte";

export function migrateRetiredStones(cb = () => {}) {
  const marks = RETIRED_STONES.map(() => "?").join(", ");
  const run = (sql, params = []) =>
    new Promise((resolve, reject) =>
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      })
    );
  const all = (sql, params = []) =>
    new Promise((resolve, reject) =>
      db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows ?? [])))
    );

  const convert = async ({ user_id: userId, item_key: key, count }) => {
    const taken = await run(
      "UPDATE pokemon_inventory SET count = 0 WHERE user_id = ? AND item_key = ? AND count = ?",
      [userId, key, count]
    );
    if (taken !== 1) return 0;
    logMovement(userId, key, -count, CONVERSION);
    try {
      await new Promise((resolve, reject) =>
        grantItem(userId, "evolyte", count, { source: CONVERSION }, (err) =>
          err ? reject(err) : resolve()
        )
      );
      return 1;
    } catch (error) {
      // La pierre revient telle quelle : rien ne se perd, on retentera au
      // prochain démarrage.
      await run(
        "UPDATE pokemon_inventory SET count = count + ? WHERE user_id = ? AND item_key = ?",
        [count, userId, key]
      );
      logMovement(userId, key, count, CONVERSION);
      throw error;
    }
  };

  (async () => {
    const lots = await all(
      `SELECT user_id, item_key, count FROM pokemon_inventory
        WHERE item_key IN (${marks}) AND count > 0`,
      RETIRED_STONES
    );
    let converted = 0;
    for (const lot of lots) converted += await convert(lot);
    await run(
      `UPDATE pokemon_drops SET item_key = 'evolyte' WHERE item_key IN (${marks}) AND status = 'OPEN'`,
      RETIRED_STONES
    );
    await run(
      `UPDATE pokemon_spawns SET held_item = 'evolyte'
        WHERE held_item IN (${marks}) AND status = 'ACTIVE'`,
      RETIRED_STONES
    );
    if (converted) log(`Évolyte : ${converted} lot(s) de Pierres Feu, Foudre ou Eau convertis`);
  })().then(
    () => cb(null),
    (error) => {
      handleException("Conversion des pierres en Évolytes :", error);
      cb(error);
    }
  );
}

// La limite de détention arrive après coup : ce que les dresseurs gardent déjà
// au-delà se vend d'office, au même prix qu'un gain de trop. Une seule fois — la
// ligne de pokemon_migrations le retient —, sans quoi chaque redémarrage
// revendrait aussi ce qu'un administrateur a donné en passant outre.
//
// Chaque surplus se retire d'abord, gardé sur le compte lu, puis se paie ; si
// les points ne passent pas, il revient. La marque ne se pose qu'une fois tout
// traité sans erreur : un passage interrompu se rejoue, et ne trouve plus que ce
// qui reste au-delà.
const CAP_MIGRATION = "plafond-detention";

export function sellHeldOverCap(cb = () => {}) {
  db.get("SELECT 1 FROM pokemon_migrations WHERE name = ?", [CAP_MIGRATION], (err, done) => {
    if (err) return cb(err);
    if (done) return cb(null, { sold: 0 });
    const capped = getItems().filter((item) => itemCap(item));
    let sold = 0;
    let failed = null;

    const sellRow = (item, row, next) => {
      const extra = row.count - itemCap(item);
      db.run(
        `UPDATE pokemon_inventory SET count = count - ?
          WHERE user_id = ? AND item_key = ? AND count = ?`,
        [extra, row.user_id, item.key, row.count],
        function (err) {
          if (err) {
            failed = err;
            return next();
          }
          // Le compte a bougé entre-temps : le prochain passage le reprendra.
          if (this.changes !== 1) {
            failed = new Error(`Inventaire modifié pendant la limite : ${row.user_id}`);
            return next();
          }
          addPoints(row.user_id, extra * itemOverflowValue(item), (err) => {
            if (err) {
              failed = err;
              return credit(row.user_id, item.key, extra, "plafond-annule", null, (restoreError) => {
                if (restoreError) handleException("Restitution d'un surplus :", restoreError);
                next();
              });
            }
            logMovement(row.user_id, item.key, -extra, `vente-auto:${CAP_MIGRATION}`);
            sold += extra;
            next();
          });
        }
      );
    };

    const nextItem = (index) => {
      if (index >= capped.length) {
        if (failed) return cb(failed);
        return db.run(
          "INSERT OR IGNORE INTO pokemon_migrations (name, done_at) VALUES (?, ?)",
          [CAP_MIGRATION, Date.now()],
          (err) => {
            if (err) return cb(err);
            if (sold) log(`Limite de détention : ${sold} objet(s) au-delà vendu(s) d'office`);
            cb(null, { sold });
          }
        );
      }
      const item = capped[index];
      db.all(
        "SELECT user_id, count FROM pokemon_inventory WHERE item_key = ? AND count > ?",
        [item.key, itemCap(item)],
        (err, rows) => {
          if (err) return cb(err);
          const nextRow = (i) =>
            i >= rows.length ? nextItem(index + 1) : sellRow(item, rows[i], () => nextRow(i + 1));
          nextRow(0);
        }
      );
    };
    nextItem(0);
  });
}
