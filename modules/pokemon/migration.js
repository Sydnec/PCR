// Migration unique : de la collection à compteurs vers les individus.
//
// L'ancienne table disait « trois Pikachu » ; pokemon_owned veut trois lignes,
// chacune avec son sexe, sa ball et sa date. Le sexe se tire selon la
// proportion de l'espèce, comme pour une capture. La ball se retrouve dans
// l'historique quand il existe — les apparitions capturées (pokemon_spawns) et
// les captures du parc — du plus ancien au plus récent : le premier exemplaire
// est celui qu'on garde, et c'est lui qui a le plus de chances d'être encore
// là. Ce que l'historique n'explique pas (évolutions, échanges, exemplaires
// revendus entre-temps) reste sans ball, marqué `migration`.
//
// Une seule fois, et tout ou rien : la revendication vit dans la même
// transaction que les insertions. Une erreur annule l'ensemble, revendication
// comprise, et le démarrage suivant recommence de zéro.
import db from "../points-db.js";
import { handleException, log } from "../utils.js";
import { getSpecies, rollSex } from "./data.js";

const NAME = "collection-vers-individus";

const all = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
  );
const run = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    })
  );

const entryKey = (userId, speciesId, isShiny) => `${userId}:${speciesId}:${isShiny ? 1 : 0}`;

// Les captures connues, rangées par entrée de Pokédex et par date.
async function captureHistory() {
  const history = new Map();
  const push = (row, ball) => {
    const key = entryKey(row.user_id, row.species_id, row.is_shiny);
    if (!history.has(key)) history.set(key, []);
    history.get(key).push({ ball, at: row.caught_at, origin: ball === "safari" ? "safari" : "capture" });
  };

  const wild = await all(
    `SELECT caught_by AS user_id, species_id, is_shiny, caught_ball, caught_at
       FROM pokemon_spawns WHERE caught_by IS NOT NULL AND caught_at IS NOT NULL`
  );
  for (const row of wild) push(row, row.caught_ball || null);

  const safari = await all(
    `SELECT s.user_id, c.species_id, c.is_shiny, c.caught_at
       FROM pokemon_safari_catches c JOIN pokemon_safari_sessions s ON s.id = c.session_id`
  );
  for (const row of safari) push(row, "safari");

  for (const list of history.values()) list.sort((a, b) => a.at - b.at);
  return history;
}

export async function migrateCollection() {
  await run(
    `CREATE TABLE IF NOT EXISTS pokemon_migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )`
  );
  const done = await all("SELECT 1 FROM pokemon_migrations WHERE name = ?", [NAME]);
  if (done.length) return;

  let rows;
  let history;
  try {
    rows = await all(
      `SELECT user_id, species_id, is_shiny, count, first_caught_at, last_caught_at
         FROM pokemon_collection WHERE count > 0
        ORDER BY user_id, species_id, is_shiny`
    );
    history = await captureHistory();
  } catch (error) {
    // Base neuve : les tables d'origine n'existent pas encore, il n'y a rien à
    // reprendre. On réessaiera au prochain démarrage, où elles seront vides.
    if (/no such table/i.test(error.message)) return;
    throw error;
  }

  await run("BEGIN IMMEDIATE");
  try {
    const claimed = await run(
      "INSERT OR IGNORE INTO pokemon_migrations (name, applied_at) VALUES (?, ?)",
      [NAME, Date.now()]
    );
    if (claimed.changes === 0) {
      await run("COMMIT");
      return;
    }

    let total = 0;
    let withBall = 0;
    for (const row of rows) {
      const species = getSpecies(row.species_id);
      const known = history.get(entryKey(row.user_id, row.species_id, row.is_shiny)) ?? [];
      const fallbackAt = row.first_caught_at ?? row.last_caught_at ?? Date.now();
      for (let i = 0; i < row.count; i++) {
        const capture = known[i];
        // eslint-disable-next-line no-await-in-loop
        await run(
          `INSERT INTO pokemon_owned
             (user_id, species_id, is_shiny, sex, ball, origin, sterile, obtained_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
          [
            row.user_id,
            row.species_id,
            row.is_shiny ? 1 : 0,
            rollSex(species),
            capture?.ball ?? null,
            capture?.origin ?? "migration",
            // Le premier exemplaire garde la date de la première capture : c'est
            // elle qui le désigne comme celui qu'on conserve.
            capture?.at ?? (i === 0 ? fallbackAt : row.last_caught_at ?? fallbackAt),
          ]
        );
        total++;
        if (capture?.ball) withBall++;
      }
    }

    await run("COMMIT");
    log(
      `Migration de la collection : ${total} Pokémon individualisés depuis ${rows.length} ` +
        `entrée(s), ${withBall} avec leur ball retrouvée.`
    );
  } catch (error) {
    await run("ROLLBACK").catch((rollbackError) =>
      handleException("Annulation de la migration :", rollbackError)
    );
    throw error;
  }
}
