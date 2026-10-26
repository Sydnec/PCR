// La loterie quotidienne : un tirage par dresseur et par jour.
//
// Trois fois sur dix elle ne donne rien, et c'est l'essentiel du jeu — un cadeau
// certain n'est pas un tirage, c'est une allocation. Le reste du temps elle rend
// un lot, et sa forme tient en une phrase : beaucoup de petits, très peu de gros.
// Un gain sur deux est une ou deux Poké Balls, ou une Super Ball.
//
// Deux tirages enchaînés y pourvoient : l'objet, pondéré par `lotteryWeight` (voir
// items.js, qui dit pourquoi la loterie ne partage plus la table du butin), puis
// la quantité, où chaque exemplaire de plus est `lotDecay` fois moins probable
// que le précédent.
//
// Deux règles de sûreté, et ce sont les mêmes que partout ailleurs :
// le tirage du jour se revendique par un UPDATE gardé dont on inspecte
// this.changes, donc deux commandes lancées en même temps n'en obtiennent
// qu'un ; et si le crédit échoue, la revendication est rendue, donc personne ne
// perd sa journée à cause d'une panne de base.
import db from "../points-db.js";
import { handleException, log } from "../utils.js";
import { pseudo } from "../pseudo.js";
import { getPokemonConfig } from "./config.js";
import {
  grantItem,
  itemLot,
  itemLotteryWeight,
  lotteryWinChance,
  pickWeightedItem,
} from "./items.js";

const SOURCE = "loterie";

// Une journée qui n'a pas encore eu lieu : la valeur que prend `last_day` quand
// on rend un tirage. Aucune date réelle ne peut lui être égale, donc le dresseur
// retrouve son droit de tirer quel que soit le jour.
const AUCUN_JOUR = "";

export const getLotteryConfig = () => getPokemonConfig().lottery ?? {};

// Le jour du tirage, en UTC. C'est le découpage que le classement des messages
// utilise déjà (toISOString sur dix caractères) : deux définitions du mot
// « jour » dans le même bot seraient une source de bugs sans fin.
export const lotteryDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

// Le prochain minuit UTC, c'est-à-dire l'instant exact où le tirage revient.
// On l'affiche plutôt qu'un « reviens demain » : le dresseur n'a pas à deviner
// dans quel fuseau le bot compte ses journées.
export function nextDrawAt(now = Date.now()) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

export function getTicket(userId, cb) {
  db.get("SELECT * FROM pokemon_lottery WHERE user_id = ?", [userId], cb);
}

// Le tirage du jour reste-t-il à faire ? La règle de claimDraw, lue sans rien écrire : un
// dresseur sans ligne, ou dont `last_day` n'est pas aujourd'hui, peut tirer. Faux quand la
// loterie est fermée, ou le jeu Pokémon éteint : /pk loterie refuserait alors.
export function lotteryPending(userId, cb) {
  if (!getPokemonConfig().enabled || !getLotteryConfig().enabled) return cb(null, false);
  getTicket(userId, (err, row) => {
    if (err) return cb(err);
    cb(null, (row?.last_day ?? AUCUN_JOUR) !== lotteryDay());
  });
}

// Revendication du tirage du jour. Le WHERE porte sur la journée déjà jouée :
// c'est lui, et rien d'autre, qui tient la règle du « une fois par jour ».
// L'INSERT couvre le premier tirage d'un dresseur, le DO UPDATE tous les
// suivants, et les deux rendent this.changes === 1 quand le tirage est accordé.
function claimDraw(userId, day, cb) {
  db.run(
    `INSERT INTO pokemon_lottery (user_id, last_day, last_draw_at, draws)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(user_id) DO UPDATE SET
       last_day = excluded.last_day,
       last_draw_at = excluded.last_draw_at,
       draws = draws + 1
     WHERE pokemon_lottery.last_day <> excluded.last_day`,
    [userId, day, Date.now()],
    function (err) {
      cb(err, this ? this.changes === 1 : false);
    }
  );
}

// Le journal daté des tirages (pokemon_lottery_draws), dont le bilan de saison lit les
// victoires par période : les compteurs de pokemon_lottery sont cumulés depuis toujours. Une
// ligne par tirage revendiqué, écrite au mieux — un journal qui échoue ne prive personne de son
// tirage — ; rend l'identifiant de la ligne, ou null si elle n'a pas pu être écrite.
function logDraw(userId, cb) {
  db.run(
    "INSERT INTO pokemon_lottery_draws (user_id, won, drawn_at) VALUES (?, 0, ?)",
    [userId, Date.now()],
    function (err) {
      if (err) handleException("Journal des tirages de loterie :", err);
      cb(err ? null : this.lastID);
    }
  );
}

// Compensation : le tirage revendiqué est rendu. La garde sur la journée en
// cours évite de rendre celui d'un autre appel, et `draws` repart avec, sinon le
// compteur raconterait des tirages qui n'ont pas eu lieu. Sa ligne du journal part
// avec lui, pour la même raison — mais seulement si le compteur, lui, a bien reculé :
// les deux doivent continuer à raconter la même chose.
function releaseDraw(userId, day, logged, cb) {
  db.run(
    `UPDATE pokemon_lottery SET last_day = ?, draws = MAX(0, draws - 1)
      WHERE user_id = ? AND last_day = ?`,
    [AUCUN_JOUR, userId, day],
    function (err) {
      if (err) handleException("Restitution d'un tirage de loterie :", err);
      const released = !err && this.changes === 1;
      logged.then((logId) => {
        if (!released || logId === null) return cb();
        db.run("DELETE FROM pokemon_lottery_draws WHERE id = ?", [logId], (err) => {
          if (err) handleException("Retrait d'un tirage rendu du journal :", err);
          cb();
        });
      });
    }
  );
}

// Combien d'exemplaires sortent d'un lot. Le tirage était uniforme à l'origine,
// et c'était son défaut : cinq Poké Balls tombaient aussi souvent qu'une seule,
// si bien que le gros lot n'avait rien d'exceptionnel. Chaque exemplaire de plus
// est désormais `lotDecay` fois moins probable que le précédent — à 0,5, deux
// fois moins, une règle qu'on peut énoncer aux joueurs en une phrase.
//
// Même forme que les deux autres tirages pondérés du jeu : un cumul, un tirage,
// et le dernier en filet si l'arrondi flottant passe juste au-dessus du total.
// À 1, la décroissance disparaît et l'on retrouve exactement l'uniforme.
export function rollLot(item) {
  const { min, max } = itemLot(item);
  if (max <= min) return min;

  const raw = Number(getLotteryConfig().lotDecay);
  const decay = Number.isFinite(raw) && raw > 0 ? raw : 1;
  const cumulative = [];
  let total = 0;
  for (let quantity = min; quantity <= max; quantity++) {
    total += Math.pow(decay, quantity - min);
    cumulative.push(total);
  }
  const roll = Math.random() * total;
  const index = cumulative.findIndex((bound) => roll < bound);
  return min + (index === -1 ? cumulative.length - 1 : index);
}

// Le tirage, et lui seul : deux hasards enchaînés, la porte puis le lot. Sortir
// l'aléatoire de la décision rend le reste testable, comme pour les objets au
// sol. Renvoie null quand le dresseur repart les mains vides.
export function rollLottery() {
  const chance = lotteryWinChance();
  if (!(chance > 0) || Math.random() >= chance) return null;
  const item = pickWeightedItem(itemLotteryWeight);
  if (!item) return null;
  return { item, quantity: rollLot(item) };
}

// Un tirage complet : on revendique la journée, on tire, on crédite.
// L'ordre compte. Revendiquer d'abord coûte la journée si le crédit échoue,
// d'où la restitution ; tirer d'abord ouvrirait la porte à deux commandes
// simultanées qui gagnent chacune leur lot avant que l'une ne perde la course.
export function play(userId, cb) {
  const config = getLotteryConfig();
  const nextAt = nextDrawAt();
  if (!config.enabled) {
    return cb(null, { ok: false, reason: "La loterie est fermée.", nextAt });
  }

  const day = lotteryDay();
  claimDraw(userId, day, (err, claimed) => {
    if (err) return cb(err);
    if (!claimed) {
      return cb(null, {
        ok: false,
        reason: "Tu as déjà tenté ta chance aujourd'hui.",
        played: true,
        nextAt,
      });
    }

    // Écrit en parallèle du tirage : ses suites (gagné, rendu) attendent son identifiant.
    const logged = new Promise((resolve) => logDraw(userId, resolve));
    const prize = rollLottery();
    if (!prize) {
      pseudo(userId).then((name) => log(`Loterie : ${name} repart les mains vides`));
      return cb(null, { ok: true, prize: null, nextAt });
    }

    grantItem(userId, prize.item.key, prize.quantity, { source: SOURCE }, (err, granted) => {
      // Le crédit a échoué : le tirage est rendu plutôt que perdu. Le lot, lui,
      // est oublié — il sera retiré au sort, et c'est bien une loterie.
      if (err) return releaseDraw(userId, day, logged, () => cb(err));

      db.run(
        "UPDATE pokemon_lottery SET wins = wins + 1 WHERE user_id = ?",
        [userId],
        (err) => {
          if (err) handleException("Comptage d'un gain de loterie :", err);
        }
      );
      logged.then((logId) => {
        if (logId === null) return;
        db.run("UPDATE pokemon_lottery_draws SET won = 1 WHERE id = ?", [logId], (err) => {
          if (err) handleException("Marque d'un tirage gagnant dans le journal :", err);
        });
      });
      pseudo(userId).then((name) =>
        log(`Loterie : ${name} gagne ${prize.quantity}× ${prize.item.label}`)
      );
      cb(null, { ok: true, prize: { ...prize, granted }, nextAt });
    });
  });
}
