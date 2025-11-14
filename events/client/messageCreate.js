import { handleException } from "../../modules/utils.js";
import db from "../../modules/db.js";
import { emojiRegex } from "../../modules/regex.js";
import { twitterRegex } from "../../modules/regex.js";
import { instagramRegex } from "../../modules/regex.js";
import dotenv from "dotenv";
dotenv.config();

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
