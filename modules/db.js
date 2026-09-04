import sqlite3 from "sqlite3";
import path from "path";
import { handleException } from "./utils.js";
import { fileURLToPath } from "url";

// Pour compatibilité ESM si besoin

// Détermination du chemin absolu du fichier DB (dans le dossier du projet)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const year = new Date().getFullYear();
const dbPath = path.join(__dirname, `../botdata-${year}.db`);

// Initialisation de la base de données SQLite
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    handleException("Erreur lors de l'ouverture de la base de données :", err);
  } else {
    // Table pour suppression automatique de messages
    db.run(
      "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, link TEXT, expire_at INTEGER)",
      (err) => {
        if (err) {
          handleException(
            "Erreur lors de la création de la table messages :",
            err
          );
        }
      }
    );
    // Table pour stats vocales
    db.run(
      "CREATE TABLE IF NOT EXISTS voice_time (user_id TEXT PRIMARY KEY, total_time_ms INTEGER DEFAULT 0, longest_session INTEGER DEFAULT 0, join_time INTEGER)",
      (err) => {
        if (err) {
          handleException(
            "Erreur lors de la création de la table voice_time :",
            err
          );
        }
      }
    );
    // Table pour stats messages par jour/utilisateur
    db.run(
      "CREATE TABLE IF NOT EXISTS message_stats (user_id TEXT, channel_id TEXT, date TEXT, count INTEGER DEFAULT 0, PRIMARY KEY(user_id, channel_id, date))",
      (err) => {
        if (err) {
          handleException(
            "Erreur lors de la création de la table message_stats :",
            err
          );
        }
      }
    );
    // Table pour stats emojis utilisés
    db.run(
      "CREATE TABLE IF NOT EXISTS emoji_stats (user_id TEXT, emoji TEXT, count INTEGER DEFAULT 0, PRIMARY KEY(user_id, emoji))",
      (err) => {
        if (err) {
          handleException(
            "Erreur lors de la création de la table emoji_stats :",
            err
          );
        }
      }
    );
    // Table pour stats réactions
    db.run(
      "CREATE TABLE IF NOT EXISTS reaction_stats (user_id TEXT, count INTEGER DEFAULT 0, PRIMARY KEY(user_id))",
      (err) => {
        if (err) {
          handleException(
            "Erreur lors de la création de la table reaction_stats :",
            err
          );
        }
      }
    );
    // Table pour stats commandes
    db.run(
      "CREATE TABLE IF NOT EXISTS command_stats (command TEXT PRIMARY KEY, count INTEGER DEFAULT 0)",
      (err) => {
        if (err) {
          handleException(
            "Erreur lors de la création de la table command_stats :",
            err
          );
        }
      }
    );
    // Table pour stats de réactions sur les messages
    db.run(
      "CREATE TABLE IF NOT EXISTS message_reactions (message_id TEXT PRIMARY KEY, count INTEGER DEFAULT 0)",
      (err) => {
        if (err) {
          handleException(
            "Erreur lors de la création de la table message_reactions :",
            err
          );
        }
      }
    );
    // Table pour stats de paris (Bet Stats)
    db.run(
      "CREATE TABLE IF NOT EXISTS bet_stats (user_id TEXT PRIMARY KEY, total_wagered INTEGER DEFAULT 0, max_win INTEGER DEFAULT 0)",
      (err) => {
        if (err) {
          handleException("Erreur lors de la création de la table bet_stats :", err);
        }
      }
    );
    // Table pour stats mots les plus utilisés par utilisateur
    db.run(
      "CREATE TABLE IF NOT EXISTS word_stats (user_id TEXT, word TEXT, count INTEGER DEFAULT 0, PRIMARY KEY(user_id, word))",
      (err) => {
        if (err) {
          handleException(
            "Erreur lors de la création de la table word_stats :",
            err
          );
        }
      }
    );

    // Table des rappels (/rappel, /mesrappels).
    // Créée ici, avec toutes les autres : elle vivait dans le handler
    // handleRemindersOnTimer, chargé après l'enregistrement des commandes, si
    // bien qu'un /rappel lancé dans la première seconde échouait.
    db.run(
      `CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message TEXT NOT NULL,
        trigger_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        sent BOOLEAN DEFAULT 0,
        sent_at INTEGER
      )`,
      (err) => {
        if (err) {
          return handleException(
            "Erreur lors de la création de la table reminders :",
            err
          );
        }
        db.run(
          "CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(sent, trigger_at)",
          (err) => {
            if (err) handleException("Erreur création index reminders :", err);
          }
        );
      }
    );

    // Table pour la progression de la remontée dans le temps
    db.run(
      "CREATE TABLE IF NOT EXISTS progress (id TEXT PRIMARY KEY, last_processed_timestamp INTEGER)",
      (err) => {
        if (err) {
          handleException(
            "Erreur lors de la création de la table progress :",
            err
          );
        }
      }
    );
    // Table pour stats de la commande randomizabaise
    db.run(
      "CREATE TABLE IF NOT EXISTS randomizabaise_stats (message_id TEXT PRIMARY KEY, user_a TEXT, user_b TEXT, user_c TEXT, reaction_count INTEGER DEFAULT 0, is_shiny INTEGER DEFAULT 0)",
      (err) => {
        if (err) {
          handleException(
            "Erreur lors de la création de la table randomizabaise_stats :",
            err
          );
        } else {
          // Migration : ajouter user_c et is_shiny si la table existe en ancien format
          db.run(
            "ALTER TABLE randomizabaise_stats ADD COLUMN user_c TEXT",
            (err) => {
              if (err && !err.message.includes("duplicate column")) {
                handleException("Erreur lors de l'ajout de user_c :", err);
              }
            }
          );
          db.run(
            "ALTER TABLE randomizabaise_stats ADD COLUMN is_shiny INTEGER DEFAULT 0",
            (err) => {
              if (err && !err.message.includes("duplicate column")) {
                handleException("Erreur lors de l'ajout de is_shiny :", err);
              }
            }
          );
        }
      }
    );

    // ============ STATISTIQUES POKÉMON ============
    // Le jeu lui-même vit dans points.db (persistante). Ces tables-ci sont les
    // statistiques de l'année : elles suivent le fichier botdata-<ANNÉE>.db et
    // repartent donc de zéro chaque 1er janvier, ce qui donne exactement le
    // périmètre d'un récap annuel. Comme pour message_stats et emoji_stats, la
    // ligne "__global__" porte les totaux du serveur.

    // Agrégats par dresseur.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_stats (
        user_id TEXT PRIMARY KEY,
        throws INTEGER DEFAULT 0,
        catches INTEGER DEFAULT 0,
        points_spent INTEGER DEFAULT 0,
        points_burned INTEGER DEFAULT 0,
        expected_catches REAL DEFAULT 0,
        shiny_catches INTEGER DEFAULT 0,
        legendary_catches INTEGER DEFAULT 0,
        best_catch_probability REAL,
        best_catch_species INTEGER,
        fastest_catch_ms INTEGER,
        most_throws_on_one_spawn INTEGER DEFAULT 0,
        fusions INTEGER DEFAULT 0,
        duplicates_spent INTEGER DEFAULT 0,
        fusion_points INTEGER DEFAULT 0,
        trades INTEGER DEFAULT 0
      )`,
      (err) => {
        if (err) handleException("Erreur lors de la création de la table pokemon_stats :", err);
      }
    );

    // Usage des balls, par dresseur et en global.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_ball_stats (
        user_id TEXT,
        ball TEXT,
        count INTEGER DEFAULT 0,
        cost INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, ball)
      )`,
      (err) => {
        if (err) handleException("Erreur lors de la création de la table pokemon_ball_stats :", err);
      }
    );

    // Agrégats par espèce : le plus vu, le plus capturé, le plus coriace.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_species_stats (
        species_id INTEGER PRIMARY KEY,
        spawns INTEGER DEFAULT 0,
        catches INTEGER DEFAULT 0,
        escapes INTEGER DEFAULT 0,
        shiny_spawns INTEGER DEFAULT 0,
        shiny_catches INTEGER DEFAULT 0,
        throws_received INTEGER DEFAULT 0,
        points_burned INTEGER DEFAULT 0,
        max_throws_single_spawn INTEGER DEFAULT 0
      )`,
      (err) => {
        if (err) handleException("Erreur lors de la création de la table pokemon_species_stats :", err);
      }
    );

    // Moments notables de l'année : shinies, légendaires, spawns disputés.
    // Une ligne par événement, pour raconter l'année plutôt que la résumer.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_highlights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        user_id TEXT,
        species_id INTEGER,
        is_shiny INTEGER DEFAULT 0,
        value INTEGER,
        detail TEXT,
        created_at INTEGER NOT NULL
      )`,
      (err) => {
        if (err) return handleException("Erreur lors de la création de la table pokemon_highlights :", err);
        db.run(
          "CREATE INDEX IF NOT EXISTS idx_pokemon_highlights_type ON pokemon_highlights(type, created_at)",
          (err) => {
            if (err) handleException("Erreur lors de la création de l'index pokemon_highlights :", err);
          }
        );
      }
    );

    // Activité par jour : pour tracer la courbe de l'année.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_daily_stats (
        date TEXT PRIMARY KEY,
        spawns INTEGER DEFAULT 0,
        throws INTEGER DEFAULT 0,
        catches INTEGER DEFAULT 0,
        points_burned INTEGER DEFAULT 0
      )`,
      (err) => {
        if (err) handleException("Erreur lors de la création de la table pokemon_daily_stats :", err);
      }
    );
  }
});

export default db;
