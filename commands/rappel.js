import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { handleException } from "../modules/utils.js";
import db from "../modules/db.js";
import dotenv from "dotenv";
dotenv.config();

export default {
  data: new SlashCommandBuilder()
    .setName("rappel")
    .setDescription("Créer un rappel qui te sera envoyé en DM")
    .addStringOption((option) =>
      option
        .setName("date")
        .setDescription(
          "Date et heure du rappel (format: JJ/MM/AAAA HH:MM ou JJ/MM HH:MM)"
        )
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("Le message du rappel (optionnel)")
        .setRequired(false)
        .setMaxLength(500)
    ),

  async execute(interaction) {
    try {
      // Si c'est une interaction de bouton
      if (interaction.isButton()) {
        await interaction.deferReply({ ephemeral: true });

        const [, dateString, messageEncoded] = interaction.customId.split("|");
        const message = decodeURIComponent(messageEncoded);
        const userId = interaction.user.id;
        const guildId = interaction.guild.id;
        const channelId = interaction.channel.id;

        // Parser la date
        const triggerAt = parseInt(dateString);

        // Vérifier que la date est toujours dans le futur
        if (triggerAt <= Date.now()) {
          await interaction.editReply({
            content: "❌ Ce rappel est déjà passé !",
            ephemeral: true,
          });
          return;
        }

        // Enregistrer le rappel en base de données
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO reminders (user_id, guild_id, channel_id, message, trigger_at, created_at) 
                         VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, guildId, channelId, message, triggerAt, Date.now()],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });

        const formattedDate = `<t:${Math.floor(triggerAt / 1000)}:F>`;
        const relativeTime = `<t:${Math.floor(triggerAt / 1000)}:R>`;

        const embed = new EmbedBuilder()
          .setColor("#00FF00")
          .setTitle("✅ Rappel créé !")
          .setDescription(`Je te rappellerai ${relativeTime}`)
          .addFields(
            { name: "📝 Message", value: message, inline: false },
            { name: "📅 Date", value: formattedDate, inline: false }
          )
          .setFooter({ text: "Tu recevras un DM à l'heure prévue" })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Si c'est une commande slash normale
      await interaction.deferReply();

      const dateString = interaction.options.getString("date");
      const message = interaction.options.getString("message") || "Rappel !";
      const userId = interaction.user.id;
      const guildId = interaction.guild.id;
      const channelId = interaction.channel.id;

      // Parser la date
      const triggerAt = parseDateTime(dateString);

      if (!triggerAt) {
        await interaction.editReply({
          content:
            "❌ Format de date invalide. Utilise :\n• `JJ/MM/AAAA HH:MM` (ex: 25/12/2024 15:30)\n• `JJ/MM HH:MM` (ex: 25/12 15:30)",
          ephemeral: true,
        });
        return;
      }

      // Vérifier que la date est dans le futur
      if (triggerAt <= Date.now()) {
        await interaction.editReply({
          content: "❌ La date doit être dans le futur !",
          ephemeral: true,
        });
        return;
      }

      // Vérifier que la date n'est pas trop loin (max 1 an)
      const oneYearFromNow = Date.now() + 365 * 24 * 60 * 60 * 1000;
      if (triggerAt > oneYearFromNow) {
        await interaction.editReply({
          content: "❌ La date ne peut pas être à plus d'un an dans le futur !",
          ephemeral: true,
        });
        return;
      }

      // Enregistrer le rappel en base de données
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO reminders (user_id, guild_id, channel_id, message, trigger_at, created_at) 
                     VALUES (?, ?, ?, ?, ?, ?)`,
          [userId, guildId, channelId, message, triggerAt, Date.now()],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      // Formater la date du rappel
      const formattedDate = `<t:${Math.floor(triggerAt / 1000)}:F>`;
      const relativeTime = `<t:${Math.floor(triggerAt / 1000)}:R>`;

      const embed = new EmbedBuilder()
        .setColor("#00FF00")
        .setTitle("✅ Rappel créé !")
        .setDescription(`<@${userId}> recevra un rappel ${relativeTime}`)
        .addFields(
          { name: "📝 Message", value: message, inline: false },
          { name: "📅 Date", value: formattedDate, inline: false }
        )
        .setFooter({
          text: "Clique sur le bouton ci-dessous pour créer le même rappel pour toi !",
        })
        .setTimestamp();

      // Créer un bouton pour que d'autres utilisateurs puissent s'ajouter
      const button = new ButtonBuilder()
        .setCustomId(`rappel|${triggerAt}|${encodeURIComponent(message)}`)
        .setLabel("Me rappeler aussi")
        .setEmoji("🔔")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(button);

      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (error) {
      handleException(error);
      const replyMethod = interaction.deferred ? "editReply" : "reply";
      await interaction[replyMethod]({
        content: "❌ Une erreur est survenue lors de la création du rappel.",
        ephemeral: true,
      }).catch(() => {});
    }
  },
};

/**
 * Parse une date au format JJ/MM/AAAA HH:MM ou JJ/MM HH:MM
 * @param {string} dateString - La chaîne de date à parser
 * @returns {number|null} Timestamp en millisecondes ou null si invalide
 */
function parseDateTime(dateString) {
  try {
    // Supprimer les espaces en trop
    dateString = dateString.trim();

    // Regex pour JJ/MM/AAAA HH:MM
    const fullDateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/;
    // Regex pour JJ/MM HH:MM (année courante)
    const shortDateRegex = /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/;

    let day, month, year, hours, minutes;

    const fullMatch = dateString.match(fullDateRegex);
    if (fullMatch) {
      [, day, month, year, hours, minutes] = fullMatch;
    } else {
      const shortMatch = dateString.match(shortDateRegex);
      if (shortMatch) {
        [, day, month, hours, minutes] = shortMatch;
        year = new Date().getFullYear(); // Année courante
      } else {
        return null; // Format invalide
      }
    }

    // Convertir en nombres
    day = parseInt(day);
    month = parseInt(month) - 1; // Les mois commencent à 0 en JavaScript
    year = parseInt(year);
    hours = parseInt(hours);
    minutes = parseInt(minutes);

    // Valider les valeurs
    if (
      day < 1 ||
      day > 31 ||
      month < 0 ||
      month > 11 ||
      year < 2024 ||
      year > 2100 ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return null;
    }

    // Créer la date
    const date = new Date(year, month, day, hours, minutes, 0, 0);

    // Vérifier que la date est valide (ex: 31/02 n'existe pas)
    if (
      date.getDate() !== day ||
      date.getMonth() !== month ||
      date.getFullYear() !== year
    ) {
      return null;
    }

    return date.getTime();
  } catch (error) {
    return null;
  }
}
