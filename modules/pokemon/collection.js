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
import { consumeItem, getItem, grantItem } from "./items.js";
import { recordFusion, recordTrade } from "./stats.js";

// Une entrée de collection, c'est une espèce ET une variante : un shiny est une
// entrée de Pokédex distincte, qui évolue, s'échange et se revend séparément.
// Les commandes encodent donc les deux dans la valeur d'une option — ce couple
// vivait dans commands/evolution.js, que deux autres commandes importaient.
export const encodeEntry = (speciesId, isShiny) => `${speciesId}:${isShiny ? 1 : 0}`;

export const decodeEntry = (value) => {
  const [speciesId, shiny] = String(value).split(":");
  return { speciesId: Number(speciesId), isShiny: shiny === "1" };
};

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

// Les mêmes variantes, pour plusieurs espèces d'un coup. La fiche d'un Pokémon
// affiche toute sa lignée évolutive : une requête par maillon, ce serait quatre
// allers-retours pour une seule réponse. Renvoie une entrée par identifiant
// demandé, même à zéro, pour que l'appelant n'ait aucun cas absent à traiter.
export function getOwnedVariantsFor(userId, speciesIds, cb) {
  const ids = [...new Set(speciesIds.map(Number))].filter(Number.isInteger);
  const counts = new Map(ids.map((id) => [id, { normal: 0, shiny: 0 }]));
  if (!ids.length) return cb(null, counts);

  db.all(
    `SELECT species_id, is_shiny, count FROM pokemon_collection
      WHERE user_id = ? AND count > 0
        AND species_id IN (${ids.map(() => "?").join(", ")})`,
    [userId, ...ids],
    (err, rows) => {
      if (err) return cb(err, counts);
      for (const row of rows || []) {
        const entry = counts.get(row.species_id);
        if (!entry) continue;
        if (row.is_shiny) entry.shiny = row.count;
        else entry.normal = row.count;
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

// Chemin unique de crédit de la collection : capture sauvage, parc safari et
// évolution passent tous par ici, sinon la règle « un shiny est une entrée
// distincte » finit par diverger entre les copies.
export function creditSpecies(userId, speciesId, isShiny, cb) {
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

// ====================== DOUBLONS ======================

// Retire des exemplaires en garantissant qu'il en reste TOUJOURS un. C'est
// l'invariant du Pokédex : une fusion, une revente, rien ne doit pouvoir effacer
// une entrée durement gagnée. Le `count >= quantity + 1` du WHERE le tient en
// une instruction, donc deux retraits simultanés ne peuvent pas passer à deux.

export function reserveDuplicates(userId, speciesId, isShiny, quantity, cb) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return cb(new Error(`Quantité invalide : ${quantity}`), false);
  }
  db.run(
    `UPDATE pokemon_collection SET count = count - ?
      WHERE user_id = ? AND species_id = ? AND is_shiny = ? AND count >= ?`,
    [quantity, userId, speciesId, isShiny ? 1 : 0, quantity + 1],
    function (err) {
      cb(err, this ? this.changes === 1 : false);
    }
  );
}

// Rend des exemplaires réservés, quand la suite de l'opération a échoué. Jamais
// un chemin de crédit ordinaire : creditSpecies l'est, et lui tient
// first_caught_at à jour.
export function restoreDuplicates(userId, speciesId, isShiny, quantity, cb = () => {}) {
  db.run(
    `UPDATE pokemon_collection SET count = count + ?
      WHERE user_id = ? AND species_id = ? AND is_shiny = ?`,
    [quantity, userId, speciesId, isShiny ? 1 : 0],
    cb
  );
}

// ====================== FUSION / ÉVOLUTION ======================

// L'aide qu'un objet apporte à une fusion, ou null. C'est le catalogue qui la
// décrit — combien d'exemplaires de l'objet, combien d'exemplaires du Pokémon
// qu'ils remplacent, et s'ils dispensent du coût en points — et cette fonction
// ne fait que la relire et la refuser quand elle ne s'applique pas.
//
// `from` enferme l'objet dans une lignée : une Pierre Feu ne sert que sur un
// Évoli, et rien n'empêcherait autrement de la jeter sur un Chenipan.
export function describeHelper(helperKey, speciesId) {
  if (!helperKey) return { helper: null };
  const item = getItem(helperKey);
  if (!item?.evolution) return { error: "Cet objet ne sert pas aux évolutions." };

  const { copies = 1, quantity = 1, freePoints = false, from = null, target = null } =
    item.evolution;
  if (from && Number(from) !== Number(speciesId)) {
    const source = getSpecies(from);
    return {
      error: `**${item.label}** ne s'utilise que sur ${source ? source.name : "une autre espèce"}.`,
    };
  }
  if (!Number.isInteger(quantity) || quantity <= 0 || !Number.isInteger(copies) || copies <= 0) {
    return { error: `**${item.label}** est mal configuré.` };
  }
  return { helper: { item, copies, quantity, freePoints, target: target ? Number(target) : null } };
}

// Décrit ce que coûte une évolution, sans rien modifier.
// `chosenTargetId` non nul sur une lignée à embranchement (Évoli) déclenche le
// tarif « choix », plus cher que le tirage au sort.
//
// `helperKey` désigne un objet qui prend une partie de la facture à sa charge :
// il remplace des exemplaires, parfois les points, et peut imposer la cible.
export function describeEvolution(speciesId, chosenTargetId = null, helperKey = null) {
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

  const { helper, error } = describeHelper(helperKey, speciesId);
  if (error) return { error };

  const branching = targets.length > 1;
  // Une pierre désigne sa cible : c'est tout ce qui la distingue d'un bonbon, et
  // ce qui en fait le seul moyen de choisir son Évoli sans payer le supplément.
  const wanted = helper?.target ?? chosenTargetId;
  const target = wanted
    ? targets.find((t) => t.id === Number(wanted))
    : branching
    ? null
    : targets[0];

  if (wanted && !target) {
    return { error: `${species.name} ne peut pas évoluer en cette forme.` };
  }

  // Sur une lignée à embranchement, le coût en points dépend de la cible :
  // un tirage aléatoire coûte le tarif normal du stade, choisir coûte plus cher.
  const referenceStage = (target ?? targets[0]).stage;
  const stageCost = config[referenceStage];
  if (!stageCost) return { error: "Aucun coût configuré pour ce stade." };

  // Le supplément « choix » ne se paie que sur un choix DU JOUEUR : une pierre
  // impose sa cible, ce n'est pas le dresseur qui trie.
  const basePoints =
    branching && chosenTargetId && !helper?.target
      ? config.branchChoicePoints
      : stageCost.points;

  // L'aide retire des exemplaires à fournir, jamais en dessous de zéro : un
  // objet trop généreux ne doit pas rendre une fusion négative.
  const duplicates = Math.max(0, stageCost.duplicates - (helper?.copies ?? 0));

  return {
    species,
    targets,
    target,
    branching,
    helper,
    duplicates,
    points: helper?.freePoints ? 0 : basePoints,
    // On exige un exemplaire de plus que les doublons consommés : l'entrée du
    // Pokédex n'est jamais perdue à cause d'une fusion.
    required: duplicates + 1,
  };
}

// Exécute la fusion. Enchaînement ordonné avec compensation : chaque étape rend
// ce que les précédentes ont réservé si elle échoue. L'ordre n'est pas
// indifférent — on prend d'abord ce qui est le plus probable de manquer, pour
// que le cas courant (« il te manque un exemplaire ») ne déplace rien du tout.
export function evolve(userId, speciesId, isShiny, chosenTargetId, helperKey, cb) {
  const plan = describeEvolution(speciesId, chosenTargetId, helperKey);
  if (plan.error) return cb(null, { ok: false, reason: plan.error });

  const target =
    plan.target ?? plan.targets[Math.floor(Math.random() * plan.targets.length)];
  const helper = plan.helper;

  // Étape 3 : les points. Zéro se saute au lieu de se débiter — spendPoints
  // refuserait un dresseur sans ligne de solde, et une fusion gratuite n'a pas à
  // dépendre de ça.
  const payer = (rendreExemplaires) => {
    const finir = () => {
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
            recordFusion({ userId, duplicates: plan.duplicates, points: plan.points });
            cb(null, { ok: true, target, plan });
          }
        );
      });
    };

    if (plan.points <= 0) return finir();
    spendPoints(userId, plan.points, (err, debited) => {
      if (err || !debited) {
        rendreExemplaires(() => {
          if (err) return cb(err);
          cb(null, {
            ok: false,
            reason: `Solde insuffisant : cette évolution coûte **${plan.points}** points.`,
          });
        });
        return;
      }
      finir();
    });
  };

  // Étape 2 : l'aide, s'il y en a une. Elle est consommée après les exemplaires
  // parce qu'elle est plus rare : mieux vaut rendre un doublon qu'une pierre.
  const prendreAide = (rendreExemplaires) => {
    if (!helper) return payer(rendreExemplaires);
    consumeItem(userId, helper.item.key, helper.quantity, { source: "fusion" }, (err, pris) => {
      if (err) return rendreExemplaires(() => cb(err));
      if (!pris) {
        return rendreExemplaires(() =>
          cb(null, {
            ok: false,
            reason:
              `Il te faut **${helper.quantity}** ${helper.item.emoji} ${helper.item.label} ` +
              `pour cette fusion.`,
          })
        );
      }
      payer((suite) =>
        // Compensation en cascade : l'aide revient, puis les exemplaires.
        grantItem(userId, helper.item.key, helper.quantity, { source: "fusion-annulee" }, (err) => {
          if (err) handleException("Restitution d'une aide de fusion :", err);
          rendreExemplaires(suite);
        })
      );
    });
  };

  // Étape 1 : les exemplaires. `plan.duplicates` peut valoir zéro si une aide
  // couvre tout : il n'y a alors rien à réserver, seulement à vérifier qu'il
  // reste bien le Pokémon qu'on fait évoluer.
  const manque = () =>
    cb(null, {
      ok: false,
      reason:
        `Il te faut **${plan.required}** exemplaires de ${plan.species.name} ` +
        `(${plan.duplicates} consommés + 1 conservé).`,
    });

  if (plan.duplicates <= 0) {
    return getOwned(userId, speciesId, isShiny, (err, owned) => {
      if (err) return cb(err);
      if (owned < 1) return manque();
      prendreAide((suite) => suite());
    });
  }

  reserveDuplicates(userId, speciesId, isShiny, plan.duplicates, (err, reserved) => {
    if (err) return cb(err);
    if (!reserved) return manque();
    prendreAide((suite) =>
      restoreDuplicates(userId, speciesId, isShiny, plan.duplicates, (err) => {
        if (err) handleException("Compensation de fusion impossible :", err);
        suite();
      })
    );
  });
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
