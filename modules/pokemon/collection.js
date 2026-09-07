// Collection des dresseurs : lecture, fusion (évolution) et échanges.
//
// Règle valable partout : une ligne de pokemon_collection peut retomber à
// count = 0 après une fusion ou un échange. On la conserve pour préserver
// first_caught_at, donc TOUTE lecture filtre sur count > 0.
import db from "../points-db.js";
import { spendPoints } from "../economy.js";
import { handleException } from "../utils.js";
import { getPokemonConfig } from "./config.js";
import { evolutionTargets, getSpecies } from "./data.js";
import { recordFusion, recordTrade } from "./stats.js";

export function getCollection(userId, cb) {
  db.all(
    `SELECT species_id, is_shiny, count, first_caught_at
       FROM pokemon_collection
      WHERE user_id = ? AND count > 0
      ORDER BY species_id`,
    [userId],
    cb
  );
}

export function getOwned(userId, speciesId, isShiny, cb) {
  db.get(
    "SELECT count FROM pokemon_collection WHERE user_id = ? AND species_id = ? AND is_shiny = ?",
    [userId, speciesId, isShiny ? 1 : 0],
    (err, row) => cb(err, row ? row.count : 0)
  );
}

// Les deux variantes d'une espèce en une requête : un shiny est une entrée de
// Pokédex distincte, donc « est-ce que je l'ai ? » a deux réponses possibles.
export function getOwnedVariants(userId, speciesId, cb) {
  db.all(
    `SELECT is_shiny, count FROM pokemon_collection
      WHERE user_id = ? AND species_id = ? AND count > 0`,
    [userId, speciesId],
    (err, rows) => {
      if (err) return cb(err, { normal: 0, shiny: 0 });
      const counts = { normal: 0, shiny: 0 };
      for (const row of rows || []) {
        if (row.is_shiny) counts.shiny = row.count;
        else counts.normal = row.count;
      }
      cb(null, counts);
    }
  );
}

export function getLeaderboard(limit, cb) {
  db.all(
    `SELECT user_id,
            COUNT(DISTINCT CASE WHEN is_shiny = 0 THEN species_id END) AS dex,
            COUNT(DISTINCT CASE WHEN is_shiny = 1 THEN species_id END) AS shinies,
            SUM(count) AS total
       FROM pokemon_collection
      WHERE count > 0
      GROUP BY user_id
      ORDER BY dex DESC, shinies DESC, total DESC
      LIMIT ?`,
    [limit],
    cb
  );
}

function creditSpecies(userId, speciesId, isShiny, cb) {
  const now = Date.now();
  db.run(
    `INSERT INTO pokemon_collection (user_id, species_id, is_shiny, count, first_caught_at, last_caught_at)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(user_id, species_id, is_shiny) DO UPDATE SET
       count = count + 1,
       first_caught_at = COALESCE(first_caught_at, excluded.first_caught_at),
       last_caught_at = excluded.last_caught_at`,
    [userId, speciesId, isShiny ? 1 : 0, now, now],
    cb
  );
}

// ====================== FUSION / ÉVOLUTION ======================

// Décrit ce que coûte une évolution, sans rien modifier.
// `chosenTargetId` non nul sur une lignée à embranchement (Évoli) déclenche le
// tarif « choix », plus cher que le tirage au sort.
export function describeEvolution(speciesId, chosenTargetId = null) {
  const config = getPokemonConfig().evolution;
  const species = getSpecies(speciesId);
  if (!species) return { error: "Espèce inconnue." };
  if (species.tradeEvolution) {
    // Sécurité : une évolution par échange est une CIBLE de fusion, jamais une
    // source. Le cas ne devrait pas se produire, mais autant être explicite.
    return { error: `${species.name} ne peut pas évoluer davantage.` };
  }

  const targets = evolutionTargets(species);
  if (!targets.length) return { error: `${species.name} n'a pas d'évolution.` };

  const branching = targets.length > 1;
  const target = chosenTargetId
    ? targets.find((t) => t.id === Number(chosenTargetId))
    : branching
    ? null
    : targets[0];

  if (chosenTargetId && !target) {
    return { error: `${species.name} ne peut pas évoluer en cette forme.` };
  }

  // Sur une lignée à embranchement, le coût en points dépend de la cible :
  // un tirage aléatoire coûte le tarif normal du stade, choisir coûte plus cher.
  const referenceStage = (target ?? targets[0]).stage;
  const stageCost = config[referenceStage];
  if (!stageCost) return { error: "Aucun coût configuré pour ce stade." };

  const points =
    branching && chosenTargetId ? config.branchChoicePoints : stageCost.points;

  return {
    species,
    targets,
    target,
    branching,
    duplicates: stageCost.duplicates,
    points,
    // On exige un exemplaire de plus que les doublons consommés : l'entrée du
    // Pokédex n'est jamais perdue à cause d'une fusion.
    required: stageCost.duplicates + 1,
  };
}

// Exécute la fusion. Enchaînement ordonné avec compensation : si le débit des
// points échoue après la réservation des doublons, on les rend.
export function evolve(userId, speciesId, isShiny, chosenTargetId, cb) {
  const plan = describeEvolution(speciesId, chosenTargetId);
  if (plan.error) return cb(null, { ok: false, reason: plan.error });

  const target =
    plan.target ?? plan.targets[Math.floor(Math.random() * plan.targets.length)];

  db.run(
    `UPDATE pokemon_collection SET count = count - ?
      WHERE user_id = ? AND species_id = ? AND is_shiny = ? AND count >= ?`,
    [plan.duplicates, userId, speciesId, isShiny ? 1 : 0, plan.required],
    function (err) {
      if (err) return cb(err);
      if (this.changes === 0) {
        return cb(null, {
          ok: false,
          reason: `Il te faut **${plan.required}** exemplaires de ${plan.species.name} (${plan.duplicates} consommés + 1 conservé).`,
        });
      }

      spendPoints(userId, plan.points, (err, debited) => {
        if (err || !debited) {
          // Compensation : les doublons réservés sont rendus.
          db.run(
            "UPDATE pokemon_collection SET count = count + ? WHERE user_id = ? AND species_id = ? AND is_shiny = ?",
            [plan.duplicates, userId, speciesId, isShiny ? 1 : 0],
            (compensationError) => {
              if (compensationError) {
                handleException("Compensation de fusion impossible :", compensationError);
              }
              if (err) return cb(err);
              cb(null, {
                ok: false,
                reason: `Solde insuffisant : cette évolution coûte **${plan.points}** points.`,
              });
            }
          );
          return;
        }

        // Un shiny évolue en shiny : is_shiny est conservé.
        creditSpecies(userId, target.id, isShiny, (err) => {
          if (err) return cb(err);
          db.run(
            `INSERT INTO pokemon_fusions
               (user_id, from_species_id, to_species_id, is_shiny, duplicates_spent, points_spent, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, speciesId, target.id, isShiny ? 1 : 0, plan.duplicates, plan.points, Date.now()],
            (err) => {
              if (err) handleException("Journal de fusion :", err);
              recordFusion({
                userId,
                duplicates: plan.duplicates,
                points: plan.points,
              });
              cb(null, { ok: true, target, plan });
            }
          );
        });
      });
    }
  );
}

// ====================== ÉCHANGES ======================

export function createTrade(trade, cb) {
  const now = Date.now();
  const expiresAt = now + getPokemonConfig().trade.expiryHours * 3600 * 1000;
  db.run(
    `INSERT INTO pokemon_trades
       (from_user_id, to_user_id, offer_species_id, offer_is_shiny,
        request_species_id, request_is_shiny, created_at, expires_at, channel_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      trade.fromUserId,
      trade.toUserId,
      trade.offerSpeciesId,
      trade.offerIsShiny ? 1 : 0,
      trade.requestSpeciesId,
      trade.requestIsShiny ? 1 : 0,
      now,
      expiresAt,
      trade.channelId,
    ],
    function (err) {
      cb(err, this ? this.lastID : null);
    }
  );
}

export function getTrade(tradeId, cb) {
  db.get("SELECT * FROM pokemon_trades WHERE id = ?", [tradeId], cb);
}

export function setTradeMessage(tradeId, messageId) {
  db.run("UPDATE pokemon_trades SET message_id = ? WHERE id = ?", [messageId, tradeId], (err) => {
    if (err) handleException("Enregistrement du message d'échange :", err);
  });
}

function releaseTrade(tradeId, status, cb = () => {}) {
  db.run(
    "UPDATE pokemon_trades SET status = ?, resolved_at = ? WHERE id = ?",
    [status, Date.now(), tradeId],
    cb
  );
}

export function resolveTradeAs(tradeId, userId, status, cb) {
  db.run(
    "UPDATE pokemon_trades SET status = ?, resolved_at = ? WHERE id = ? AND status = 'PENDING'",
    [status, Date.now(), tradeId],
    function (err) {
      cb(err, this ? this.changes === 1 : false);
    }
  );
}

// Acceptation d'un échange. La revendication gardée sert à la fois de verrou
// anti-double-acceptation et de contrôle d'expiration : aucun cron n'est
// nécessaire pour que l'expiration soit correcte.
export function acceptTrade(tradeId, cb) {
  db.run(
    `UPDATE pokemon_trades SET status = 'ACCEPTED', resolved_at = ?
      WHERE id = ? AND status = 'PENDING' AND expires_at > ?`,
    [Date.now(), tradeId, Date.now()],
    function (err) {
      if (err) return cb(err);
      if (this.changes === 0) {
        return cb(null, { ok: false, reason: "Cette offre a expiré ou a déjà été traitée." });
      }

      getTrade(tradeId, (err, trade) => {
        if (err || !trade) return cb(err || new Error("Échange introuvable"));

        // Retrait chez l'initiateur, puis chez la cible, avec compensation si
        // le second échoue (le Pokémon a pu être fusionné entre-temps).
        db.run(
          `UPDATE pokemon_collection SET count = count - 1
            WHERE user_id = ? AND species_id = ? AND is_shiny = ? AND count >= 1`,
          [trade.from_user_id, trade.offer_species_id, trade.offer_is_shiny],
          function (err) {
            if (err) return cb(err);
            if (this.changes === 0) {
              return releaseTrade(tradeId, "FAILED", () =>
                cb(null, {
                  ok: false,
                  reason: "L'initiateur ne possède plus le Pokémon proposé.",
                })
              );
            }

            db.run(
              `UPDATE pokemon_collection SET count = count - 1
                WHERE user_id = ? AND species_id = ? AND is_shiny = ? AND count >= 1`,
              [trade.to_user_id, trade.request_species_id, trade.request_is_shiny],
              function (err) {
                if (err) return cb(err);
                if (this.changes === 0) {
                  // Compensation : on rend son Pokémon à l'initiateur.
                  return db.run(
                    "UPDATE pokemon_collection SET count = count + 1 WHERE user_id = ? AND species_id = ? AND is_shiny = ?",
                    [trade.from_user_id, trade.offer_species_id, trade.offer_is_shiny],
                    () =>
                      releaseTrade(tradeId, "FAILED", () =>
                        cb(null, {
                          ok: false,
                          reason: "Tu ne possèdes plus le Pokémon demandé.",
                        })
                      )
                  );
                }

                creditSpecies(
                  trade.to_user_id,
                  trade.offer_species_id,
                  trade.offer_is_shiny,
                  (err) => {
                    if (err) return cb(err);
                    creditSpecies(
                      trade.from_user_id,
                      trade.request_species_id,
                      trade.request_is_shiny,
                      (err) => {
                        recordTrade({
                          fromUserId: trade.from_user_id,
                          toUserId: trade.to_user_id,
                        });
                        cb(err, { ok: true, trade });
                      }
                    );
                  }
                );
              }
            );
          }
        );
      });
    }
  );
}
