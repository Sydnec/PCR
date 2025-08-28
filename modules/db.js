import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

// Pour compatibilité ESM si besoin

// Détermination du chemin absolu du fichier DB (dans le dossier du projet)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const year = new Date().getFullYear();
const dbPath = path.join(__dirname, `../botdata-${year}.db`);

// Initialisation de la base de données SQLite
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Erreur lors de l'ouverture de la base de données :", err);
  } else {
    // Table pour suppression automatique de messages
    db.run('CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, link TEXT, expire_at INTEGER)', (err) => {
      if (err) {
        console.error('Erreur lors de la création de la table messages :', err);
      }
    });
    // Table pour stats vocales
    db.run('CREATE TABLE IF NOT EXISTS voice_time (user_id TEXT PRIMARY KEY, total_time_ms INTEGER DEFAULT 0, longest_session INTEGER DEFAULT 0, join_time INTEGER)', (err) => {
      if (err) {
        console.error('Erreur lors de la création de la table voice_time :', err);
      }
    });
    // Table pour stats messages par jour/utilisateur
    db.run('CREATE TABLE IF NOT EXISTS message_stats (user_id TEXT, channel_id TEXT, date TEXT, count INTEGER DEFAULT 0, PRIMARY KEY(user_id, channel_id, date))', (err) => {
      if (err) {
        console.error('Erreur lors de la création de la table message_stats :', err);
      }
    });
    // Table pour stats emojis utilisés
    db.run('CREATE TABLE IF NOT EXISTS emoji_stats (user_id TEXT, emoji TEXT, count INTEGER DEFAULT 0, PRIMARY KEY(user_id, emoji))', (err) => {
      if (err) {
        console.error('Erreur lors de la création de la table emoji_stats :', err);
      }
    });
    // Table pour stats réactions
    db.run('CREATE TABLE IF NOT EXISTS reaction_stats (user_id TEXT, count INTEGER DEFAULT 0, PRIMARY KEY(user_id))', (err) => {
      if (err) {
        console.error('Erreur lors de la création de la table reaction_stats :', err);
      }
    });
    // Table pour stats commandes
    db.run('CREATE TABLE IF NOT EXISTS command_stats (command TEXT PRIMARY KEY, count INTEGER DEFAULT 0)', (err) => {
      if (err) {
        console.error('Erreur lors de la création de la table command_stats :', err);
      }
    });
    // Table pour stats de réactions sur les messages
    db.run('CREATE TABLE IF NOT EXISTS message_reactions (message_id TEXT PRIMARY KEY, count INTEGER DEFAULT 0)', (err) => {
      if (err) {
        console.error('Erreur lors de la création de la table message_reactions :', err);
      }
    });
    // Table pour stats mots les plus utilisés par utilisateur
    db.run('CREATE TABLE IF NOT EXISTS word_stats (user_id TEXT, word TEXT, count INTEGER DEFAULT 0, PRIMARY KEY(user_id, word))', (err) => {
      if (err) {
        console.error('Erreur lors de la création de la table word_stats :', err);
      }
    });

    // Migration si la colonne join_time ou longest_session n'existe pas (ajout rétroactif)
    db.all("PRAGMA table_info(voice_time)", (err, columns) => {
      if (err) return;
      if (!columns.some(col => col.name === 'join_time')) {
        db.run('ALTER TABLE voice_time ADD COLUMN join_time INTEGER', () => {});
      }
      if (!columns.some(col => col.name === 'longest_session')) {
        db.run('ALTER TABLE voice_time ADD COLUMN longest_session INTEGER DEFAULT 0', () => {});
      }
      // Suppression éventuelle de last_session (optionnel, SQLite ne supporte pas DROP COLUMN directement)
    });
    // Ajoute ici d'autres tables si besoin
  }
});

export default db;
