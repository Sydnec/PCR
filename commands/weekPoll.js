import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException, log, autoAddEmojis } from "../modules/utils.js";
import dotenv from "dotenv";
dotenv.config(); // process.env.CONSTANT

export default {
  data: new SlashCommandBuilder()
    .setName("week")
    .setDescription("Créer un sondage contenant les jours d'une période")
    .addStringOption((option) =>
      option
        .setName("question")
        .setDescription("Que proposes-tu cette semaine ?")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("date_debut")
        .setDescription("Date de début (format: JJ/MM ou JJ/MM/AAAA)")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("date_fin")
        .setDescription("Date de fin (format: JJ/MM ou JJ/MM/AAAA)")
        .setRequired(false)
    ),

  async execute(interaction, bot) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const input = interaction.options.getString("question");
    const startDateStr = interaction.options.getString("date_debut");
    const endDateStr = interaction.options.getString("date_fin");

    let startDate, endDate;
    const now = new Date();
    const currentYear = now.getFullYear();

    // Si aucune date n'est fournie, utiliser la semaine courante (lundi à dimanche)
    if (!startDateStr && !endDateStr) {
      startDate = new Date(now);
      const dayOfWeek = startDate.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Lundi de la semaine courante
      startDate.setDate(startDate.getDate() + diff);
      
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6); // Dimanche
    } else {
      // Parser la date de début
      if (startDateStr) {
        try {
          const parts = startDateStr.split("/");
          if (parts.length === 2) {
            // Format JJ/MM
            startDate = new Date(currentYear, parseInt(parts[1]) - 1, parseInt(parts[0]));
          } else if (parts.length === 3) {
            // Format JJ/MM/AAAA
            startDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
          } else {
            throw new Error("Format invalide");
          }
        } catch (e) {
          await interaction.editReply({
            content: "❌ Format de date de début invalide. Utilisez JJ/MM ou JJ/MM/AAAA",
          });
          return;
        }
      } else {
        startDate = new Date(now);
      }

      // Parser la date de fin
      if (endDateStr) {
        try {
          const parts = endDateStr.split("/");
          if (parts.length === 2) {
            // Format JJ/MM
            endDate = new Date(currentYear, parseInt(parts[1]) - 1, parseInt(parts[0]));
          } else if (parts.length === 3) {
            // Format JJ/MM/AAAA
            endDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
          } else {
            throw new Error("Format invalide");
          }
        } catch (e) {
          await interaction.editReply({
            content: "❌ Format de date de fin invalide. Utilisez JJ/MM ou JJ/MM/AAAA",
          });
          return;
        }
      } else {
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 6); // Par défaut, 7 jours
      }
    }

    // Validation : la date de début doit être avant ou égale à la date de fin
    if (startDate > endDate) {
      await interaction.editReply({
        content: "❌ La date de début doit être avant ou égale à la date de fin !",
      });
      return;
    }

    // Générer la liste des jours
    const daysOfWeek = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
    let daysOfTheWeek = "";
    let currentDate = new Date(startDate);
    let dayNumber = 1;

    while (currentDate <= endDate) {
      const dayName = daysOfWeek[currentDate.getDay()];
      const dayStr = String(currentDate.getDate()).padStart(2, "0");
      const monthStr = String(currentDate.getMonth() + 1).padStart(2, "0");
      daysOfTheWeek += `${dayNumber}. ${dayName} ${dayStr}/${monthStr}\n`;
      
      currentDate.setDate(currentDate.getDate() + 1);
      dayNumber++;
    }

    let pollMessage = await interaction.channel.send(
      `# ${input} :\n${daysOfTheWeek}`
    );
    await autoAddEmojis(pollMessage);
    await interaction.editReply({
      content: "Sondage créé ✅",
    });
  },
};
