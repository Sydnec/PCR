import sqlite3 from "sqlite3";
import path from "path";
import { log, handleException } from "./utils.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Persistent DB for points (does not reset yearly)
const dbPath = path.join(__dirname, "../points.db");

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    handleException("Erreur lors de l'ouverture de la base de données points :", err);
  } else {
    // Table des points utilisateurs
    db.run(
      `CREATE TABLE IF NOT EXISTS points (
        user_id TEXT PRIMARY KEY, 
        balance INTEGER DEFAULT 0,
        last_message_at INTEGER DEFAULT 0,
        messages_today_count INTEGER DEFAULT 0,
        last_reset_date TEXT
      )`,
      (err) => {
        if (err) handleException("Erreur création table points :", err);
        else {
            // Migration (add columns if not exists for old DBs)
            const addColumn = (colName, colType) => {
                db.run(`ALTER TABLE points ADD COLUMN ${colName} ${colType}`, (err) => {
                    // Ignore duplicate column error
                });
            }
            addColumn("last_message_at", "INTEGER DEFAULT 0");
            addColumn("messages_today_count", "INTEGER DEFAULT 0");
            addColumn("last_reset_date", "TEXT");
        }
      }
    );

    // Table des paris
    db.run(
      `CREATE TABLE IF NOT EXISTS bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        creator_id TEXT,
        title TEXT,
        status TEXT DEFAULT 'OPEN',
        winning_option_index INTEGER,
        is_estimation INTEGER DEFAULT 0
      )`,
      (err) => {
        if (err) handleException("Erreur création table bets :", err);
        else {
             // Migration for type
             db.run(`ALTER TABLE bets ADD COLUMN is_estimation INTEGER DEFAULT 0`, (err) => {});
        }
      }
    );

    // Table des options de paris
    db.run(
      `CREATE TABLE IF NOT EXISTS bet_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bet_id INTEGER,
        option_index INTEGER,
        label TEXT,
        FOREIGN KEY(bet_id) REFERENCES bets(id)
      )`,
      (err) => {
        if (err) handleException("Erreur création table bet_options :", err);
      }
    );

    // Table des participations aux paris
    db.run(
      `CREATE TABLE IF NOT EXISTS bet_participations (
        bet_id INTEGER,
        user_id TEXT,
        option_index INTEGER,
        amount INTEGER,
        prediction_value INTEGER,
        PRIMARY KEY(bet_id, user_id),
        FOREIGN KEY(bet_id) REFERENCES bets(id)
      )`,
      (err) => {
        if (err) handleException("Erreur création table bet_participations :", err);
        else {
             // Migration for prediction_value
             db.run(`ALTER TABLE bet_participations ADD COLUMN prediction_value INTEGER`, (err) => {});
        }
      }
    );

    // ================== SYSTÈME POKÉMON ==================
    // Ces tables vivent dans points.db (persistante) et surtout pas dans
    // modules/db.js, dont le fichier change chaque 1er janvier : les
    // collections des dresseurs seraient effacées tous les ans.

    // État global du système. Une seule ligne, qui sert de point de
    // sérialisation au déclenchement des spawns (cf. pokemon/spawn.js).
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        message_count INTEGER NOT NULL DEFAULT 0,
        last_spawn_at INTEGER NOT NULL DEFAULT 0,
        spawning INTEGER NOT NULL DEFAULT 0,
        total_spawns INTEGER NOT NULL DEFAULT 0
      )`,
      (err) => {
        if (err) return handleException("Erreur création table pokemon_state :", err);
        db.run("INSERT OR IGNORE INTO pokemon_state (id) VALUES (1)", (err) => {
          if (err) handleException("Erreur initialisation pokemon_state :", err);
        });
      }
    );

    // Spawns. catch_rate est figé à l'apparition : régénérer le dataset ou
    // changer la config ne doit jamais modifier les chances d'un spawn en cours.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_spawns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        species_id INTEGER NOT NULL,
        is_shiny INTEGER NOT NULL DEFAULT 0,
        catch_rate INTEGER NOT NULL,
        rarity TEXT,
        channel_id TEXT,
        message_id TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        spawned_at INTEGER NOT NULL,
        throw_count INTEGER NOT NULL DEFAULT 0,
        caught_by TEXT,
        caught_at INTEGER,
        caught_ball TEXT,
        ended_at INTEGER
      )`,
      (err) => {
        if (err) return handleException("Erreur création table pokemon_spawns :", err);
        // Garantie au niveau base : jamais deux spawns actifs en même temps.
        db.run(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_pokemon_spawn_active
             ON pokemon_spawns(status) WHERE status = 'ACTIVE'`,
          (err) => {
            if (err) handleException("Erreur création index pokemon_spawn_active :", err);
          }
        );
      }
    );

    // Journal des lancers : alimente l'embed en direct, les statistiques, et
    // sert de piste d'audit pour les remboursements (result = 'VOID').
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_throws (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spawn_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        ball TEXT NOT NULL,
        cost INTEGER NOT NULL,
        probability REAL,
        result TEXT NOT NULL,
        thrown_at INTEGER NOT NULL
      )`,
      (err) => {
        if (err) return handleException("Erreur création table pokemon_throws :", err);
        db.run(
          "CREATE INDEX IF NOT EXISTS idx_pokemon_throws_spawn ON pokemon_throws(spawn_id, id)",
          (err) => {
            if (err) handleException("Erreur création index pokemon_throws_spawn :", err);
          }
        );
      }
    );

    // Collection. is_shiny fait partie de la clé : un shiny est une entrée de
    // Pokédex distincte. Une ligne peut retomber à count = 0 après une fusion
    // ou un échange ; on la garde pour préserver first_caught_at, donc TOUTE
    // lecture doit filtrer sur count > 0.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_collection (
        user_id TEXT NOT NULL,
        species_id INTEGER NOT NULL,
        is_shiny INTEGER NOT NULL DEFAULT 0,
        count INTEGER NOT NULL DEFAULT 0,
        first_caught_at INTEGER,
        last_caught_at INTEGER,
        PRIMARY KEY (user_id, species_id, is_shiny)
      )`,
      (err) => {
        if (err) return handleException("Erreur création table pokemon_collection :", err);
        db.run(
          "CREATE INDEX IF NOT EXISTS idx_pokemon_collection_user ON pokemon_collection(user_id)",
          (err) => {
            if (err) handleException("Erreur création index pokemon_collection_user :", err);
          }
        );
      }
    );

    // Offres d'échange. expires_at permet une expiration paresseuse dans le
    // WHERE de l'acceptation : aucun cron n'est nécessaire à la correction.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_user_id TEXT NOT NULL,
        to_user_id TEXT NOT NULL,
        offer_species_id INTEGER NOT NULL,
        offer_is_shiny INTEGER NOT NULL DEFAULT 0,
        request_species_id INTEGER NOT NULL,
        request_is_shiny INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        resolved_at INTEGER,
        channel_id TEXT,
        message_id TEXT
      )`,
      (err) => {
        if (err) handleException("Erreur création table pokemon_trades :", err);
      }
    );

    // Journal des fusions (audit et statistiques).
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_fusions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        from_species_id INTEGER NOT NULL,
        to_species_id INTEGER NOT NULL,
        is_shiny INTEGER NOT NULL DEFAULT 0,
        duplicates_spent INTEGER NOT NULL,
        points_spent INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      (err) => {
        if (err) handleException("Erreur création table pokemon_fusions :", err);
      }
    );
  }
});

export default db;
