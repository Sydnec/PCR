import { handleException } from "../../modules/utils.js";
import db from "../../modules/db.js";
import pointsDb from "../../modules/points-db.js";
import { registerMessageForSpawn } from "../../modules/pokemon/spawn.js";
import { countEggMessage } from "../../modules/pokemon/eggs.js";
import { emojiRegex } from "../../modules/regex.js";
import { rewriteSocialLinks } from "../../modules/links.js";
import { getConfig } from "../../modules/config.js";
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
        const lastResetDate = row && row.last_reset_date ? row.last_reset_date : "";

        // Si on a changé de jour, reset du compteur
        if (lastResetDate !== today) {
            countToday = 0;
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
            // getConfig applique les valeurs par défaut et survit à un
            // config.json momentanément invalide — ce que la lecture brute
            // d'avant ne faisait pas, alors que /admin config y écrit.
            const distribution = getConfig().messagePointsDistribution;
            
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
            // Écriture gardée : le SELECT ci-dessus et cette écriture sont
            // séparés par un aller-retour asynchrone. Deux messages envoyés
            // coup sur coup lisaient tous les deux l'ancien last_message_at et
            // encaissaient chacun la récompense du 1er message de la journée.
            // La condition reproduit ici la règle appliquée plus haut : soit on
            // a changé de jour, soit l'heure de carence est écoulée.
            pointsDb.run(
                `INSERT INTO points (user_id, balance, last_message_at, messages_today_count, last_reset_date)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(user_id) DO UPDATE SET
                    balance = balance + ?,
                    last_message_at = ?,
                    messages_today_count = ?,
                    last_reset_date = ?
                 WHERE COALESCE(points.last_reset_date, '') != ?
                    OR COALESCE(points.last_message_at, 0) = 0
                    OR points.last_message_at <= ?`,
                [
                    userId, pointsToAdd, now, rank, today,
                    pointsToAdd, now, rank, today,
                    today, now - oneHour,
                ],
                function (err) {
                    if (err) handleException("Erreur update points message équilibrés", err);
                }
            );
        }
    });

    // --- Système Pokémon : compteur d'activité, spawn éventuel ---
    // Tir-et-oublie et protégé en interne : ce fichier est sur le chemin chaud
    // de chaque message du serveur. Les MP ne comptent pas.
    if (message.guild) {
      registerMessageForSpawn(message.client);
      // Chaque message de son propriétaire rapproche un œuf de l'éclosion.
      countEggMessage(message.client, userId);
    }

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

    // --- Liens X et Instagram vers leurs miroirs, qui ont un aperçu ---
    const rewritten = rewriteSocialLinks(messageContent);
    // Un message Discord tient en 2 000 caractères : au-delà, la copie
    // échouerait, et l'original reste.
    const repost = rewritten && `<@${message.author.id}> a envoyé :\n${rewritten}`;
    if (repost && repost.length <= 2000) {
      message.channel
        // La mention dit qui l'a envoyé, sans le notifier.
        .send({ content: repost, allowedMentions: { parse: [] } })
        // L'original ne part qu'une fois la copie publiée : rien ne se perd.
        .then(() => message.delete())
        .catch((err) => handleException("Remplacement de lien :", err));
    }
  } catch (err) {
    handleException(err);
  }
}

export { name, once, execute };
