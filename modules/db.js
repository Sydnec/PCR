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

    // Table pour la progression de la remontée dans le temps
    db.run('CREATE TABLE IF NOT EXISTS progress (id TEXT PRIMARY KEY, last_processed_timestamp INTEGER)', (err) => {
      if (err) {
        console.error('Erreur lors de la création de la table progress :', err);
      }
    });
  }
});
// Fonction de "remontée dans le temps" pour remplir la BDD avec les événements passés avant le 29/08/2025 à 00:28
// Cette fonction doit être appelée au démarrage du bot (client ready)
// Elle doit être adaptée selon les events à traiter (messages, vocaux, etc.)
// Pour l'exemple, on ne traite que les messages, à adapter selon les besoins
import { Client } from 'discord.js';
import { emojiRegex } from './regex.js';

const REMONTÉE_ID = 'remonter-le-temps-2025';
const LIMITE_TIMESTAMP = new Date('2025-08-29T00:28:00Z').getTime();

/**
 * Remplit la BDD avec les événements passés avant LIMITE_TIMESTAMP.
 * @param {Client} client - Instance du bot Discord
 */
export async function remonterLeTemps(client) {
  // Vérifie la progression
  db.get('SELECT last_processed_timestamp FROM progress WHERE id = ?', [REMONTÉE_ID], async (err, row) => {
    if (err) return console.error('Erreur lecture progression remontée :', err);
    let since = row ? row.last_processed_timestamp : 0;
    if (since >= LIMITE_TIMESTAMP) return; // Déjà fait

    // Pour chaque channel textuel, on remonte les messages jusqu'à LIMITE_TIMESTAMP
    for (const guild of client.guilds.cache.values()) {
      for (const channel of guild.channels.cache.values()) {
        if (channel.type !== 0 && channel.type !== 5) continue; // text ou news
        let beforeId = undefined;
        let done = false;
        while (!done) {
          try {
            const options = { limit: 100 };
            if (beforeId) options.before = beforeId;
            const messages = await channel.messages.fetch(options);
            if (!messages.size) break;
            for (const msg of messages.values()) {
              if (msg.createdTimestamp >= LIMITE_TIMESTAMP) continue;
              if (msg.createdTimestamp <= since) {
                done = true;
                break;
              }
              const dateStr = msg.createdAt.toISOString().slice(0, 10);
              // message_stats
              db.run('INSERT OR IGNORE INTO message_stats (user_id, channel_id, date, count) VALUES (?, ?, ?, 1) ON CONFLICT(user_id, channel_id, date) DO UPDATE SET count = count + 1', [msg.author.id, msg.channel.id, dateStr], (err) => {
                if (err) console.error('Erreur insertion message_stats rétro :', err);
              });

              // emoji_stats & word_stats
              if (msg.content) {
                // emoji_stats : pour chaque emoji custom ou unicode (utilise la regex du module)
                let match;
                while ((match = emojiRegex.exec(msg.content))) {
                  const emoji = match[0];
                  db.run('INSERT OR IGNORE INTO emoji_stats (user_id, emoji, count) VALUES (?, ?, 1) ON CONFLICT(user_id, emoji) DO UPDATE SET count = count + 1', [msg.author.id, emoji], (err) => {
                    if (err) console.error('Erreur insertion emoji_stats rétro :', err);
                  });
                }
                emojiRegex.lastIndex = 0; // reset pour la prochaine utilisation
                // word_stats : découpe les mots, ignore la ponctuation
                const words = msg.content.toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, ' ').split(' ').filter(Boolean);
                for (const word of words) {
                  db.run('INSERT OR IGNORE INTO word_stats (user_id, word, count) VALUES (?, ?, 1) ON CONFLICT(user_id, word) DO UPDATE SET count = count + 1', [msg.author.id, word], (err) => {
                    if (err) console.error('Erreur insertion word_stats rétro :', err);
                  });
                }
              }

              // command_stats : si le message commence par un préfixe de commande (à adapter si besoin)
              const prefixes = ['!', '/', '.', '?'];
              for (const prefix of prefixes) {
                if (msg.content && msg.content.startsWith(prefix)) {
                  const command = msg.content.split(/\s+/)[0].slice(1).toLowerCase();
                  db.run('INSERT OR IGNORE INTO command_stats (command, count) VALUES (?, 1) ON CONFLICT(command) DO UPDATE SET count = count + 1', [command], (err) => {
                    if (err) console.error('Erreur insertion command_stats rétro :', err);
                  });
                  break;
                }
              }

              // message_reactions & reaction_stats
              if (msg.reactions && msg.reactions.cache.size > 0) {
                let totalReactions = 0;
                for (const reaction of msg.reactions.cache.values()) {
                  totalReactions += reaction.count || 0;
                  // Pour chaque utilisateur ayant réagi
                  try {
                    const users = await reaction.users.fetch();
                    for (const user of users.values()) {
                      db.run('INSERT OR IGNORE INTO reaction_stats (user_id, count) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET count = count + 1', [user.id], (err) => {
                        if (err) console.error('Erreur insertion reaction_stats rétro :', err);
                      });
                    }
                  } catch (e) {
                    // Peut arriver si le message est trop ancien ou supprimé
                  }
                }
                db.run('INSERT OR IGNORE INTO message_reactions (message_id, count) VALUES (?, ?) ON CONFLICT(message_id) DO UPDATE SET count = ?', [msg.id, totalReactions, totalReactions], (err) => {
                  if (err) console.error('Erreur insertion message_reactions rétro :', err);
                });
              }

              // Mise à jour de la progression
              db.run('INSERT OR REPLACE INTO progress (id, last_processed_timestamp) VALUES (?, ?)', [REMONTÉE_ID, msg.createdTimestamp]);
              beforeId = msg.id;
            }
            if (messages.size < 100) break;
          } catch (e) {
            console.error('Erreur lors de la remontée dans le temps sur', channel.id, e);
            break;
          }
        }
      }
    }
    // Marque comme terminé
    db.run('INSERT OR REPLACE INTO progress (id, last_processed_timestamp) VALUES (?, ?)', [REMONTÉE_ID, LIMITE_TIMESTAMP]);
    console.log('Remontée dans le temps terminée.');
  });
}

export default db;
