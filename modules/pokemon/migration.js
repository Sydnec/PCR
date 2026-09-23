// Migrations des Pokémon, jouées une fois chacune, dans l'ordre, au démarrage.
//
// 1. De la collection à compteurs vers les individus.
// L'ancienne table disait « trois Pikachu » ; pokemon_owned veut trois lignes,
// chacune avec son sexe, sa ball et sa date. Le sexe se tire selon la
// proportion de l'espèce, comme pour une capture. La ball se retrouve dans
// l'historique quand il existe — les apparitions capturées (pokemon_spawns) et
// les captures du parc — du plus ancien au plus récent : le premier exemplaire
// est celui qu'on garde, et c'est lui qui a le plus de chances d'être encore
// là. Ce que l'historique n'explique pas (évolutions, échanges, exemplaires
// revendus entre-temps) reste sans ball, marqué `migration`.
//
// 2. Les espèces asexuées des jeux perdent le sexe que la première version
//    leur tirait à pile ou face : la colonne devient facultative — SQLite ne
//    sait pas retoucher un CHECK, d'où la reconstruction de la table — et les
//    Magnéti, Métamorph et légendaires déjà là repassent à NULL.
//
// Chacune une seule fois, et tout ou rien : la revendication vit dans la même
// transaction que le travail. Une erreur annule l'ensemble, revendication
// comprise, et le démarrage suivant recommence de zéro.
import db from "../points-db.js";
import { handleException, log } from "../utils.js";
import { getPokemonConfig } from "./config.js";
import { allSpeciesData, getSpecies, isGenderless, isLegendary, rollSex } from "./data.js";

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

const applied = async (name) =>
  (await all("SELECT 1 FROM pokemon_migrations WHERE name = ?", [name])).length > 0;

// Joue `work` dans une transaction qui commence par revendiquer la migration.
async function once(name, work) {
  await run("BEGIN IMMEDIATE");
  try {
    const claimed = await run(
      "INSERT OR IGNORE INTO pokemon_migrations (name, applied_at) VALUES (?, ?)",
      [name, Date.now()]
    );
    if (claimed.changes === 0) return await run("COMMIT");
    await work();
    await run("COMMIT");
  } catch (error) {
    await run("ROLLBACK").catch((rollbackError) =>
      handleException(`Annulation de la migration ${name} :`, rollbackError)
    );
    throw error;
  }
}

export async function runMigrations() {
  await run(
    `CREATE TABLE IF NOT EXISTS pokemon_migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )`
  );
  await migrateCollection();
  await migrateGenderless();
  await migratePc();
  await migrateLock();
}

// ---------------------- 1. Individus ----------------------

const NAME = "collection-vers-individus";

async function migrateCollection() {
  if (await applied(NAME)) return;

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

  await once(NAME, async () => {
    let total = 0;
    let withBall = 0;
    for (const row of rows) {
      const species = getSpecies(row.species_id);
      const known = history.get(entryKey(row.user_id, row.species_id, row.is_shiny)) ?? [];
      const fallbackAt = row.first_caught_at ?? row.last_caught_at ?? Date.now();
      for (let i = 0; i < row.count; i++) {
        const capture = known[i];
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
    log(
      `Migration de la collection : ${total} Pokémon individualisés depuis ${rows.length} ` +
        `entrée(s), ${withBall} avec leur ball retrouvée.`
    );
  });
}

// ---------------------- 2. Espèces asexuées ----------------------

const GENDERLESS = "especes-asexuees-sans-sexe";

// Même définition que dans points-db.js : c'est elle que prend la table
// reconstruite, et une base neuve doit finir identique à une base migrée.
const OWNED_COLUMNS = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  species_id INTEGER NOT NULL,
  is_shiny INTEGER NOT NULL DEFAULT 0,
  sex TEXT CHECK (sex IN ('M', 'F')),
  ball TEXT,
  origin TEXT NOT NULL,
  sterile INTEGER NOT NULL DEFAULT 0,
  obtained_at INTEGER NOT NULL`;
const COLUMN_NAMES = "id, user_id, species_id, is_shiny, sex, ball, origin, sterile, obtained_at";

async function migrateGenderless() {
  if (await applied(GENDERLESS)) return;
  const [table] = await all(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'pokemon_owned'"
  );
  const ids = allSpeciesData().filter(isGenderless).map((species) => species.id);

  await once(GENDERLESS, async () => {
    // Une base créée avec la définition actuelle n'a rien à reconstruire.
    if (/sex\s+TEXT\s+NOT\s+NULL/i.test(table?.sql ?? "")) {
      await run(`CREATE TABLE pokemon_owned_rebuilt (${OWNED_COLUMNS})`);
      await run(
        `INSERT INTO pokemon_owned_rebuilt (${COLUMN_NAMES})
         SELECT ${COLUMN_NAMES} FROM pokemon_owned`
      );
      await run("DROP TABLE pokemon_owned");
      await run("ALTER TABLE pokemon_owned_rebuilt RENAME TO pokemon_owned");
      await run(
        `CREATE INDEX IF NOT EXISTS idx_pokemon_owned_entry
           ON pokemon_owned(user_id, species_id, is_shiny)`
      );
    }
    const cleared = await run(
      `UPDATE pokemon_owned SET sex = NULL
        WHERE sex IS NOT NULL AND species_id IN (${ids.map(() => "?").join(", ")})`,
      ids
    );
    log(`Migration des espèces asexuées : ${cleared.changes} Pokémon sans sexe désormais.`);
  });
}

// ---------------------- 3. Boîte PC ----------------------

// La place de chaque Pokémon dans la boîte PC du site et son surnom, plus le
// nom des boîtes. Après la reconstruction de la table : celle-ci ne recopie que
// les colonnes qu'elle connaît, et aurait effacé celles-ci.
async function migratePc() {
  await once("boite-pc", async () => {
    for (const column of ["pc_pos INTEGER", "nickname TEXT"]) {
      await run(`ALTER TABLE pokemon_owned ADD COLUMN ${column}`).catch((error) => {
        if (!/duplicate column/i.test(error.message)) throw error;
      });
    }
    await run(
      `CREATE TABLE IF NOT EXISTS pokemon_pc_boxes (
        user_id TEXT NOT NULL,
        box INTEGER NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY (user_id, box)
      )`
    );
    log("Boîte PC : place, surnom et noms de boîtes prêts.");
  });
}

// ---------------------- 4. Verrou ----------------------

// Un Pokémon verrouillé ne part jamais : ni revente, ni échange, ni sacrifice.
// Les shiny et les légendaires le sont d'office à leur arrivée
// (lockedByDefault) ; ceux qu'on possède déjà le deviennent ici, une seule
// fois — ensuite, c'est le dresseur qui décide, et un redémarrage ne doit pas
// reverrouiller ce qu'il a ouvert. Tout le jeu de données, générations fermées
// comprises : une espèce cachée reste dans les collections.
async function migrateLock() {
  await once("verrou", async () => {
    await run("ALTER TABLE pokemon_owned ADD COLUMN locked INTEGER NOT NULL DEFAULT 0").catch(
      (error) => {
        if (!/duplicate column/i.test(error.message)) throw error;
      }
    );
    const legendaries = allSpeciesData()
      .filter(isLegendary)
      .map((species) => species.id);
    const config = getPokemonConfig().lockByDefault ?? {};
    const locked = await run(
      `UPDATE pokemon_owned SET locked = 1
        WHERE (? AND is_shiny = 1)
           OR (? AND species_id IN (${legendaries.map(() => "?").join(", ") || "NULL"}))`,
      [config.shiny ? 1 : 0, config.legendary ? 1 : 0, ...legendaries]
    );
    log(`Verrou : ${locked.changes} Pokémon shiny ou légendaires verrouillés d'office.`);
  });
}
