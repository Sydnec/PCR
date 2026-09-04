// Alimentation des statistiques Pokémon de l'année.
//
// Le jeu vit dans points.db (persistante) ; ces statistiques vivent dans
// botdata-<ANNÉE>.db, dont le fichier change au 1er janvier. La base EST donc
// le périmètre de l'année : le récap de fin d'année n'a aucun filtre de date à
// écrire, il lit les tables telles quelles.
//
// Règle absolue : une écriture de statistique ne doit JAMAIS casser une
// capture. Tout est en tir-et-oublie, rien ne remonte à l'appelant, et toute
// erreur est journalisée sans être propagée.
import statsDb from "../db.js";
import pointsDb from "../points-db.js";
import { handleException } from "../utils.js";
import { isLegendary } from "./data.js";

// Même sentinelle que message_stats et emoji_stats pour les totaux du serveur.
const GLOBAL = "__global__";

// Au-delà de ce nombre de balls encaissées, un spawn mérite d'entrer dans les
// moments notables de l'année.
const CONTESTED_SPAWN_THRESHOLD = 10;

const today = () => new Date().toISOString().slice(0, 10);

// Les noms de colonnes proviennent de cette liste blanche, jamais de l'appelant.
const COUNTERS = [
  "throws",
  "catches",
  "points_spent",
  "points_burned",
  "expected_catches",
  "shiny_catches",
  "legendary_catches",
  "fusions",
  "duplicates_spent",
  "fusion_points",
  "trades",
];

function run(sql, params, label) {
  statsDb.run(sql, params, (err) => {
    if (err) handleException(`Statistiques Pokémon (${label}) :`, err);
  });
}

// Incrémente des compteurs pour un dresseur, et par défaut pour la ligne
// globale, afin que les totaux serveur soient lisibles sans agrégation.
// `global: false` sert aux événements qui concernent deux dresseurs à la fois
// (un échange), où le total serveur ne doit être incrémenté qu'une seule fois.
function bumpStats(userId, deltas, { global = true } = {}) {
  const columns = COUNTERS.filter((column) => deltas[column]);
  if (!columns.length) return;

  const sql =
    `INSERT INTO pokemon_stats (user_id, ${columns.join(", ")})
     VALUES (?, ${columns.map(() => "?").join(", ")})
     ON CONFLICT(user_id) DO UPDATE SET ` +
    columns.map((column) => `${column} = ${column} + excluded.${column}`).join(", ");

  const values = columns.map((column) => deltas[column]);
  const targets = global ? [userId, GLOBAL] : [userId];
  for (const target of targets) {
    run(sql, [target, ...values], "compteurs dresseur");
  }
}

function bumpBall(userId, ball, cost) {
  const sql = `INSERT INTO pokemon_ball_stats (user_id, ball, count, cost)
               VALUES (?, ?, 1, ?)
               ON CONFLICT(user_id, ball) DO UPDATE SET
                 count = count + 1,
                 cost = cost + excluded.cost`;
  for (const target of [userId, GLOBAL]) {
    run(sql, [target, ball, cost], "usage des balls");
  }
}

function bumpDaily(deltas) {
  const columns = ["spawns", "throws", "catches", "points_burned"].filter(
    (column) => deltas[column]
  );
  if (!columns.length) return;

  const sql =
    `INSERT INTO pokemon_daily_stats (date, ${columns.join(", ")})
     VALUES (?, ${columns.map(() => "?").join(", ")})
     ON CONFLICT(date) DO UPDATE SET ` +
    columns.map((column) => `${column} = ${column} + excluded.${column}`).join(", ");

  run(sql, [today(), ...columns.map((column) => deltas[column])], "activité quotidienne");
}

function bumpSpecies(speciesId, deltas) {
  const columns = [
    "spawns",
    "catches",
    "escapes",
    "shiny_spawns",
    "shiny_catches",
    "throws_received",
    "points_burned",
  ].filter((column) => deltas[column]);
  if (!columns.length) return;

  const sql =
    `INSERT INTO pokemon_species_stats (species_id, ${columns.join(", ")})
     VALUES (?, ${columns.map(() => "?").join(", ")})
     ON CONFLICT(species_id) DO UPDATE SET ` +
    columns.map((column) => `${column} = ${column} + excluded.${column}`).join(", ");

  run(sql, [speciesId, ...columns.map((column) => deltas[column])], "compteurs espèce");
}

function addHighlight(type, { userId = null, speciesId = null, isShiny = 0, value = null, detail = null }) {
  run(
    `INSERT INTO pokemon_highlights (type, user_id, species_id, is_shiny, value, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [type, userId, speciesId, isShiny ? 1 : 0, value, detail, Date.now()],
    "moment notable"
  );
}

// ====================== ÉVÉNEMENTS DE JEU ======================

export function recordSpawn(spawn, species) {
  try {
    bumpSpecies(species.id, { spawns: 1, shiny_spawns: spawn.is_shiny ? 1 : 0 });
    bumpDaily({ spawns: 1 });
  } catch (error) {
    handleException(error, "recordSpawn");
  }
}

// Un lancer facturé. Les lancers remboursés (result = 'VOID') ne doivent jamais
// arriver ici : ils n'ont rien coûté au dresseur.
export function recordThrow({ userId, speciesId, ball, cost, probability, result }) {
  try {
    const missed = result !== "CATCH";
    bumpStats(userId, {
      throws: 1,
      points_spent: cost,
      points_burned: missed ? cost : 0,
      // Somme des probabilités : donne les captures « attendues » d'un dresseur,
      // et par différence avec ses captures réelles, sa chance sur l'année.
      expected_catches: probability,
    });
    bumpBall(userId, ball, cost);
    bumpSpecies(speciesId, { throws_received: 1, points_burned: missed ? cost : 0 });
    bumpDaily({ throws: 1, points_burned: missed ? cost : 0 });
  } catch (error) {
    handleException(error, "recordThrow");
  }
}

// Garde le meilleur record d'un dresseur : la capture la moins probable et la
// capture la plus rapide. Les assignations d'un UPSERT SQLite sont toutes
// évaluées sur la ligne d'origine, donc l'espèce et la probabilité restent
// cohérentes entre elles.
function recordPersonalBests(userId, { probability, speciesId, delayMs }) {
  if (Number.isFinite(probability)) {
    run(
      `INSERT INTO pokemon_stats (user_id, best_catch_probability, best_catch_species)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         best_catch_species = CASE
           WHEN pokemon_stats.best_catch_probability IS NULL
             OR excluded.best_catch_probability < pokemon_stats.best_catch_probability
           THEN excluded.best_catch_species
           ELSE pokemon_stats.best_catch_species END,
         best_catch_probability =
           min(coalesce(pokemon_stats.best_catch_probability, 1.0), excluded.best_catch_probability)`,
      [userId, probability, speciesId],
      "record de chance"
    );
  }

  if (Number.isFinite(delayMs) && delayMs >= 0) {
    run(
      `INSERT INTO pokemon_stats (user_id, fastest_catch_ms) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         fastest_catch_ms = min(coalesce(pokemon_stats.fastest_catch_ms, ?), excluded.fastest_catch_ms)`,
      [userId, delayMs, delayMs],
      "record de rapidité"
    );
  }
}

// Fin d'un spawn : capturé ou enfui.
//
// C'est ici qu'on relit le journal des lancers pour attribuer à chaque
// participant son record d'acharnement — y compris à ceux qui ont vidé leur
// solde sans rien attraper, qui font justement les meilleures histoires.
export function recordSpawnEnd(spawn, species, { caughtBy = null, ball = null, probability = null } = {}) {
  try {
    const caught = Boolean(caughtBy);

    bumpSpecies(species.id, {
      catches: caught ? 1 : 0,
      escapes: caught ? 0 : 1,
      shiny_catches: caught && spawn.is_shiny ? 1 : 0,
    });

    if (caught) {
      bumpStats(caughtBy, {
        catches: 1,
        shiny_catches: spawn.is_shiny ? 1 : 0,
        legendary_catches: isLegendary(species) ? 1 : 0,
      });
      bumpDaily({ catches: 1 });
      recordPersonalBests(caughtBy, {
        probability,
        speciesId: species.id,
        delayMs: spawn.spawned_at ? Date.now() - spawn.spawned_at : null,
      });

      if (spawn.is_shiny) {
        addHighlight("SHINY", {
          userId: caughtBy,
          speciesId: species.id,
          isShiny: 1,
          detail: `${species.name} shiny capturé avec une ${ball ?? "ball"}`,
        });
      }
      if (isLegendary(species)) {
        addHighlight("LEGENDAIRE", {
          userId: caughtBy,
          speciesId: species.id,
          isShiny: spawn.is_shiny ? 1 : 0,
          detail: `${species.name} capturé avec une ${ball ?? "ball"}`,
        });
      }
    }

    // Records d'acharnement, par participant, et pic de résistance de l'espèce.
    pointsDb.all(
      `SELECT user_id, COUNT(*) AS throws, SUM(cost) AS cost
         FROM pokemon_throws
        WHERE spawn_id = ? AND result != 'VOID'
        GROUP BY user_id`,
      [spawn.id],
      (err, rows) => {
        if (err) return handleException("Statistiques Pokémon (participants) :", err);

        let best = 0;
        for (const row of rows || []) {
          best = Math.max(best, row.throws);
          run(
            `INSERT INTO pokemon_stats (user_id, most_throws_on_one_spawn) VALUES (?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
               most_throws_on_one_spawn =
                 max(coalesce(pokemon_stats.most_throws_on_one_spawn, 0), excluded.most_throws_on_one_spawn)`,
            [row.user_id, row.throws],
            "record d'acharnement"
          );
        }

        if (best > 0) {
          run(
            `INSERT INTO pokemon_species_stats (species_id, max_throws_single_spawn) VALUES (?, ?)
             ON CONFLICT(species_id) DO UPDATE SET
               max_throws_single_spawn =
                 max(coalesce(pokemon_species_stats.max_throws_single_spawn, 0), excluded.max_throws_single_spawn)`,
            [species.id, best],
            "résistance de l'espèce"
          );
        }

        const totalThrows = (rows || []).reduce((sum, row) => sum + row.throws, 0);
        if (totalThrows >= CONTESTED_SPAWN_THRESHOLD) {
          const totalCost = (rows || []).reduce((sum, row) => sum + (row.cost || 0), 0);
          addHighlight(caught ? "SPAWN_DISPUTE" : "FUITE_COUTEUSE", {
            userId: caughtBy,
            speciesId: species.id,
            isShiny: spawn.is_shiny ? 1 : 0,
            value: totalThrows,
            detail: caught
              ? `${species.name} a encaissé ${totalThrows} balls (${totalCost} pts) avant de céder`
              : `${species.name} s'est enfui après ${totalThrows} balls (${totalCost} pts gaspillés)`,
          });
        }
      }
    );
  } catch (error) {
    handleException(error, "recordSpawnEnd");
  }
}

export function recordFusion({ userId, duplicates, points }) {
  try {
    bumpStats(userId, {
      fusions: 1,
      duplicates_spent: duplicates,
      fusion_points: points,
    });
  } catch (error) {
    handleException(error, "recordFusion");
  }
}

export function recordTrade({ fromUserId, toUserId }) {
  try {
    // Les deux dresseurs comptent l'échange, mais le serveur ne le compte
    // qu'une fois : sans cela le total global serait doublé.
    bumpStats(fromUserId, { trades: 1 }, { global: false });
    bumpStats(toUserId, { trades: 1 }, { global: false });
    bumpStats(GLOBAL, { trades: 1 }, { global: false });
  } catch (error) {
    handleException(error, "recordTrade");
  }
}
