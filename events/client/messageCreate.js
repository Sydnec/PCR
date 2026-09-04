import { handleException } from "../../modules/utils.js";
import db from "../../modules/db.js";
import pointsDb from "../../modules/points-db.js";
import { registerMessageForSpawn } from "../../modules/pokemon/spawn.js";
import {
  emojiRegex,
  instagramRegex,
  instagramRegexGlobal,
  twitterRegex,
  twitterRegexGlobal,
} from "../../modules/regex.js";
import { readAppConfig } from "../../modules/app-config.js";
import dotenv from "dotenv";

dotenv.config();

// Rangs de points par défaut si config.json est absent ou illisible.
const FALLBACK_POINTS_DISTRIBUTION = { default: 5 };

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

        const config = readAppConfig();
        const distribution =
            (config && config.messagePointsDistribution) ||
            FALLBACK_POINTS_DISTRIBUTION;
        // Number.isFinite : une valeur 0 configurée doit rester 0, pas
        // retomber sur le défaut comme le faisait le test de véracité.
        pointsToAdd = Number.isFinite(distribution[rank])
            ? distribution[rank]
            : Number.isFinite(distribution.default)
            ? distribution.default
            : FALLBACK_POINTS_DISTRIBUTION.default;

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

    // --- Système Pokémon : compteur d'activité, spawn éventuel ---
    // Tir-et-oublie et protégé en interne : ce fichier est sur le chemin chaud
    // de chaque message du serveur. Les MP ne comptent pas.
    if (message.guild) registerMessageForSpawn(message.client);

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
    // Les regex sans `g` servent aux tests d'existence ; `.replace()` reçoit
    // une instance neuve, car une regex globale partagée conserve son
    // `lastIndex` et ne remplacerait qu'un message sur deux.
    if (twitterRegex.test(messageContent)) {
      await republishWithRewrittenLinks(
        message,
        "Remplacement de lien twitter",
        messageContent.replace(twitterRegexGlobal(), "https://vxtwitter.com")
      );
      return;
    }

    // --- Instagram to kkinstagram (uniquement pour les reels) ---
    if (instagramRegex.test(messageContent)) {
      await republishWithRewrittenLinks(
        message,
        "Ajout de lien kkinstagram pour reel",
        messageContent.replace(
          instagramRegexGlobal(),
          "https://kkinstagram.com/reel/"
        )
      );
    }
  } catch (err) {
    handleException(err);
  }
}

// Republie le message avec les liens réécrits, puis supprime l'original.
//
// L'ancienne version enchaînait `.then(message.delete())` : l'appel partait
// immédiatement, en parallèle de l'édition, et sa promesse échappait au
// `.catch()` (un argument non-fonction est ignoré par `.then`). Une suppression
// refusée devenait donc un rejet non géré.
async function republishWithRewrittenLinks(message, placeholder, content) {
  try {
    const sent = await message.channel.send(placeholder);
    await sent.edit(`<@${message.author.id}> a envoyé : \n${content}`);
    await message.delete();
  } catch (err) {
    handleException(err);
  }
}

export { name, once, execute };
