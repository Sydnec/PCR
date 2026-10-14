// La boutique des balls spéciales. On les achète en points, et chacune est une
// ligne de pokemon_ball_units portant sa date d'achat : elle ne sert qu'aux
// apparitions qui viennent APRÈS — on n'achète pas pour le Pokémon en cours. Un
// dresseur n'en garde que `maxHeld` de chaque.
//
// Retirer avant de créditer : les points partent d'abord, les balls arrivent
// ensuite, et ce que la garde du plafond refuse se rembourse. Rien ne se perd,
// rien ne se crée.
import db from "../points-db.js";
import { addPoints, getBalance, spendPoints } from "../economy.js";
import { handleException } from "../utils.js";
import { getSpecialBalls, specialBallLimit } from "./config.js";
import { activeGeneration, getSpecies, speciesEvolvingWith } from "./data.js";
import { getItem } from "./items.js";

// Les balls spéciales en vente : celles dont la génération est ouverte. Fermée, une
// ball n'existe pas encore pour les dresseurs — ni en boutique, ni au lancer.
export function openSpecialBalls() {
  const active = activeGeneration();
  return getSpecialBalls().filter((ball) => (ball.generation ?? 1) <= active);
}

export const getOpenSpecialBall = (key) =>
  openSpecialBalls().find((ball) => ball.key === key) ?? null;

// Combien de chaque ball le dresseur a en poche, et combien servent à une apparition
// née à `spawnedAt` (achetées avant elle). Sans `spawnedAt`, tout compte.
export function getUnitCounts(userId, cb, { spawnedAt = null } = {}) {
  db.all(
    `SELECT ball, COUNT(*) AS held,
            SUM(CASE WHEN ? IS NULL OR bought_at < ? THEN 1 ELSE 0 END) AS eligible
       FROM pokemon_ball_units WHERE user_id = ? GROUP BY ball`,
    [spawnedAt, spawnedAt, String(userId)],
    (err, rows) =>
      cb(
        err,
        new Map((rows ?? []).map((row) => [row.ball, { held: row.held, eligible: row.eligible }]))
      )
  );
}

// Achète `quantity` exemplaires de `ballKey`. `cb(err, result)` avec
// { ok: false, reason } pour un refus (chiffres compris), ou { ok: true, bought, cost }.
// Chaque exemplaire s'insère sous la garde du plafond : deux achats simultanés ne le
// dépassent jamais, et ce qui est refusé après le débit se rembourse.
export function buyBalls(userId, ballKey, quantity, cb) {
  const ball = getOpenSpecialBall(ballKey);
  if (!ball) return cb(null, { ok: false, reason: "Cette ball n'est pas en vente." });
  if (!Number.isInteger(quantity) || quantity < 1) {
    return cb(null, { ok: false, reason: "La quantité doit être d'au moins 1." });
  }
  const limit = specialBallLimit();
  const unit = ball.price;
  const cost = unit * quantity;

  getUnitCounts(userId, (err, counts) => {
    if (err) return cb(err);
    const held = counts.get(ball.key)?.held ?? 0;
    if (held + quantity > limit) {
      const room = Math.max(0, limit - held);
      return cb(null, {
        ok: false,
        reason:
          `Tu en as ${held} sur ${limit} : tu peux encore en acheter ${room}, pas ${quantity}.`,
      });
    }
    spendPoints(String(userId), cost, (err, debited) => {
      if (err) return cb(err);
      if (!debited) {
        return getBalance(userId, (err, balance) =>
          err
            ? cb(err)
            : cb(null, {
                ok: false,
                reason:
                  `Il te faut ${cost.toLocaleString("fr-FR")} points, tu en as ` +
                  `${balance.toLocaleString("fr-FR")}.`,
              })
        );
      }
      const now = Date.now();
      let bought = 0;
      const insertNext = () => {
        if (bought >= quantity) return finish(null);
        db.run(
          `INSERT INTO pokemon_ball_units (user_id, ball, bought_at)
           SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM pokemon_ball_units WHERE user_id = ? AND ball = ?) < ?`,
          [String(userId), ball.key, now, String(userId), ball.key, limit],
          function (err) {
            if (err) return finish(err);
            // Refusé par la garde : un achat simultané a rempli la poche.
            if (this.changes === 0) return finish(null);
            bought++;
            insertNext();
          }
        );
      };
      const finish = (error) => {
        const missing = quantity - bought;
        if (!missing) return cb(null, { ok: true, bought, cost });
        // Rendre ce qui n'a pas été livré, au prix payé.
        addPoints(String(userId), unit * missing, (refundError) => {
          if (refundError) handleException("Remboursement d'un achat de balls :", refundError);
          if (error) return cb(error);
          cb(null, {
            ok: bought > 0,
            partial: bought > 0,
            bought,
            cost: unit * bought,
            reason: `Ta poche est pleine : ${bought} sur ${quantity} achetée${bought > 1 ? "s" : ""}, le reste est remboursé.`,
          });
        });
      };
      insertNext();
    });
  });
}

// Prend la plus ancienne ball de `ballKey` achetée avant `spawnedAt`, d'un seul
// geste : deux lancers simultanés ne prennent jamais la même. Rend la ligne prise,
// ou null s'il n'y en a aucune d'éligible.
export function takeUnit(userId, ballKey, spawnedAt, cb) {
  db.get(
    `DELETE FROM pokemon_ball_units
      WHERE id = (SELECT id FROM pokemon_ball_units
                   WHERE user_id = ? AND ball = ? AND bought_at < ?
                   ORDER BY bought_at, id LIMIT 1)
      RETURNING *`,
    [String(userId), ballKey, spawnedAt],
    (err, row) => cb(err, row ?? null)
  );
}

// Rend une ball prise, à l'identique : même date d'achat, donc même éligibilité.
export function restoreUnit(unit, cb = () => {}) {
  db.run(
    "INSERT INTO pokemon_ball_units (user_id, ball, bought_at) VALUES (?, ?, ?)",
    [unit.user_id, unit.ball, unit.bought_at],
    (err) => cb(err)
  );
}

// Ce que fait une ball spéciale, en une phrase : lue dans son `bonus`, pour que la
// boutique de Discord et celle du site disent la même chose et suivent la config.
export function ballEffectText(ball) {
  const times = ball.bonus?.multiplier;
  if (!times) return `Capture ×${ball.multiplier}.`;
  if (ball.bonus.fished) return `×${times} sur les Pokémon pêchés, ×${ball.multiplier} sur les autres.`;
  if (ball.bonus.item) {
    const item = getItem(ball.bonus.item);
    const names = [...speciesEvolvingWith(ball.bonus.item)]
      .map((id) => getSpecies(id)?.name)
      .filter(Boolean);
    return (
      `×${times} sur les Pokémon qui évoluent avec ${item ? `le ${item.label}` : "cet objet"}` +
      `${names.length ? ` (${names.join(", ")})` : ""}, ×${ball.multiplier} sur les autres.`
    );
  }
  return `Capture ×${ball.multiplier}.`;
}

// Tout ce que montre la boutique à un dresseur : son solde, le plafond, et pour
// chaque ball en vente son prix, son effet et ce qu'il en a. Une seule lecture pour
// Discord et pour le site.
export function getShopView(userId, cb) {
  getBalance(userId, (err, balance) => {
    if (err) return cb(err);
    getUnitCounts(userId, (err, counts) => {
      if (err) return cb(err);
      cb(null, {
        balance,
        limit: specialBallLimit(),
        balls: openSpecialBalls().map((ball) => ({
          key: ball.key,
          label: ball.label,
          emoji: ball.emoji,
          sprite: ball.sprite ?? null,
          price: ball.price,
          effect: ballEffectText(ball),
          held: counts.get(ball.key)?.held ?? 0,
        })),
      });
    });
  });
}
