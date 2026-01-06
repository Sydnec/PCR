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
        winning_option_index INTEGER
      )`,
      (err) => {
        if (err) handleException("Erreur création table bets :", err);
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
        PRIMARY KEY(bet_id, user_id),
        FOREIGN KEY(bet_id) REFERENCES bets(id)
      )`,
      (err) => {
        if (err) handleException("Erreur création table bet_participations :", err);
      }
    );
  }
});

export default db;
