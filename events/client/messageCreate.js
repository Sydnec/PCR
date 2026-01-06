import { handleException } from "../../modules/utils.js";
import db from "../../modules/db.js";
import pointsDb from "../../modules/points-db.js";
import { emojiRegex } from "../../modules/regex.js";
import { twitterRegex } from "../../modules/regex.js";
import { instagramRegex } from "../../modules/regex.js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, "../../config.json");

const name = "messageCreate";
const once = false;
async function execute(message) {
  try {
    if (message.author.bot) return;
    const messageContent = message.content;

    // --- Statistiques messages par jour/utilisateur/salon ---
    const userId = message.author.id;
    const channelId = message.channel.id;
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    db.run(
      `INSERT INTO message_stats (user_id, channel_id, date, count) VALUES (?, ?, ?, 1)
            ON CONFLICT(user_id, channel_id, date) DO UPDATE SET count = count + 1`,
      [userId, channelId, date]
    );
    // --- Statistiques globales messages serveur ---
    db.run(
      `INSERT INTO message_stats (user_id, channel_id, date, count) VALUES (?, ?, ?, 1)
            ON CONFLICT(user_id, channel_id, date) DO UPDATE SET count = count + 1`,
      ["__global__", "__global__", date]
    );

    // --- Système de points (Nouveau système équilibré) ---
    // Logique: Max 1 message valide / heure.
    // Gains: 1er: 100, 2eme: 80, 3eme: 50, 4eme: 30, 5eme: 20, 6eme: 10, 7eme: 5, Suivants: 0
    
    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    
    pointsDb.get("SELECT last_message_at, messages_today_count, last_reset_date FROM points WHERE user_id = ?", [userId], (err, row) => {
        if (err) return handleException("Erreur lecture points", err);
        
        // Initialisation si l'utilisateur n'existe pas dans la table (ou champs null pour anciens users)
        let lastMessageAt = row && row.last_message_at ? row.last_message_at : 0;
        let countToday = row && row.messages_today_count ? row.messages_today_count : 0;
        let lastResetDate = row && row.last_reset_date ? row.last_reset_date : "";

        // Si on a changé de jour, reset du compteur
        if (lastResetDate !== today) {
            countToday = 0;
            lastResetDate = today;
            // On peut reset lastMessageAt pour permettre le premier message du jour (évite d'attendre 1h après minuit si msg à 23h30)
            lastMessageAt = 0;
        }

        const oneHour = 60 * 60 * 1000;
        
        // Si moins d'une heure s'est écoulée depuis le dernier message récompensé
        if (now - lastMessageAt < oneHour && lastMessageAt !== 0) {
            // Pas de points, pas de mise à jour du compteur
            return;
        }

        // Calcul des points en fonction du rang du message dans la journée
        // countToday est le nombre de messages DEJA récompensés aujourd'hui (0 pour le 1er message)
        let pointsToAdd = 0;
        const rank = countToday + 1; // Le rang de CE message

        try {
            const configFile = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(configFile);
            const distribution = config.messagePointsDistribution;
            
            if (distribution[rank]) {
                pointsToAdd = distribution[rank];
            } else {
                pointsToAdd = distribution.default;
            }
        } catch (e) {
            handleException(e);
            pointsToAdd = 5; // Fallback
        }

        if (pointsToAdd > 0) {
            pointsDb.serialize(() => {
                // Update tracking et ajout points
                pointsDb.run(
                    `INSERT INTO points (user_id, balance, last_message_at, messages_today_count, last_reset_date) 
                     VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT(user_id) DO UPDATE SET 
                        balance = balance + ?,
                        last_message_at = ?, 
                        messages_today_count = ?, 
                        last_reset_date = ?`,
                    [userId, pointsToAdd, now, rank, today, pointsToAdd, now, rank, today],
                    (err) => {
                        if (err) handleException("Erreur update points message équilibrés", err);
                    }
                );
            });
        }
    });

    // --- Statistiques mots les plus utilisés ---
    const words = messageContent
      .toLowerCase()
      .replace(/[^\p{L}\p{N}'-]+/gu, " ")
      .split(/\s+/)
      .filter(Boolean);
    for (const word of words) {
      if (word.length > 2) {
        // Ignore les mots trop courts
        db.run(
          `INSERT INTO word_stats (user_id, word, count) VALUES (?, ?, 1)
                    ON CONFLICT(user_id, word) DO UPDATE SET count = count + 1`,
          [userId, word]
        );
      }
    }

    // --- Statistiques emojis utilisés ---
    const emojis = messageContent.match(emojiRegex);
    if (emojis) {
      for (const emoji of emojis) {
        db.run(
          `INSERT INTO emoji_stats (user_id, emoji, count) VALUES (?, ?, 1)
                    ON CONFLICT(user_id, emoji) DO UPDATE SET count = count + 1`,
          [userId, emoji]
        );
        // Stat global serveur
        db.run(
          `INSERT INTO emoji_stats (user_id, emoji, count) VALUES (?, ?, 1)
                    ON CONFLICT(user_id, emoji) DO UPDATE SET count = count + 1`,
          ["__global__", emoji]
        );
      }
    }

    // --- Twitter to vxtwitter ---
    if (twitterRegex.test(messageContent)) {
      // Remplacez les occurrences trouvées par "fxtwitter.com"
      const newMessageContent = messageContent.replace(
        twitterRegex,
        "https://vxtwitter.com"
      );
      message.channel
        .send("Remplacement de lien twitter")
        .then((newMessage) => {
          // Modifiez le message en ajoutant une mention
          newMessage.edit(
            `<@!${message.author.id}> a envoyé : \n${newMessageContent}`
          );
        })
        .then(message.delete())
        .catch((err) => handleException(err));
    }

    // --- Instagram to kkinstagram (uniquement pour les reels) ---
    if (instagramRegex.test(messageContent)) {
      // Remplacer instagram.com par kkinstagram.com
      const newMessageContent = messageContent.replace(
        instagramRegex,
        "https://kkinstagram.com/reel/"
      );
      message.channel
        .send("Ajout de lien kkinstagram pour reel")
        .then((newMessage) => {
          newMessage.edit(
            `<@!${message.author.id}> a envoyé : \n${newMessageContent}`
          );
        })
        .then(message.delete())
        .catch((err) => handleException(err));
    }
  } catch (err) {
    handleException(err);
  }
}

export { name, once, execute };
