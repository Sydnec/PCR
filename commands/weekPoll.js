import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException, autoAddEmojis } from "../modules/utils.js";
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
        .setName("jour")
        .setDescription(
          "Jour de la semaine pour commencer (prochaine occurrence)"
        )
        .setRequired(false)
        .addChoices(
          { name: "Lundi", value: "lundi" },
          { name: "Mardi", value: "mardi" },
          { name: "Mercredi", value: "mercredi" },
          { name: "Jeudi", value: "jeudi" },
          { name: "Vendredi", value: "vendredi" },
          { name: "Samedi", value: "samedi" },
          { name: "Dimanche", value: "dimanche" }
        )
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

  async execute(interaction) {
   try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const input = interaction.options.getString("question");
    const dayChoice = interaction.options.getString("jour");
    const startDateStr = interaction.options.getString("date_debut");
    const endDateStr = interaction.options.getString("date_fin");

    let startDate, endDate;
    const now = new Date();
    const currentYear = now.getFullYear();

    // Mapping des jours en français vers leur index (0 = Dimanche, 1 = Lundi, etc.)
    const dayMapping = {
      dimanche: 0,
      lundi: 1,
      mardi: 2,
      mercredi: 3,
      jeudi: 4,
      vendredi: 5,
      samedi: 6,
    };

    // Si un jour est choisi, calculer la prochaine occurrence
    if (dayChoice && !startDateStr && !endDateStr) {
      const targetDay = dayMapping[dayChoice];
      const currentDay = now.getDay();

      startDate = new Date(now);
      let daysToAdd = (targetDay - currentDay + 7) % 7;
      if (daysToAdd === 0) {
        daysToAdd = 7; // Si c'est le même jour, prendre la semaine prochaine
      }
      startDate.setDate(startDate.getDate() + daysToAdd);

      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6); // 7 jours au total
    }
    // Si aucune date n'est fournie, utiliser la semaine courante (lundi à dimanche)
    else if (!startDateStr && !endDateStr && !dayChoice) {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() + 1);

      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6); // Dimanche
    } else {
      // Parser la date de début
      if (startDateStr) {
        startDate = parseDayMonth(startDateStr, currentYear);
        if (!startDate) {
          await interaction.editReply({
            content:
              "❌ Format de date de début invalide. Utilisez JJ/MM ou JJ/MM/AAAA",
          });
          return;
        }
      } else {
        startDate = new Date(now);
      }

      // Parser la date de fin
      if (endDateStr) {
        endDate = parseDayMonth(endDateStr, currentYear);
        if (!endDate) {
          await interaction.editReply({
            content:
              "❌ Format de date de fin invalide. Utilisez JJ/MM ou JJ/MM/AAAA",
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
        content:
          "❌ La date de début doit être avant ou égale à la date de fin !",
      });
      return;
    }

    // Une plage trop large produisait un message au-delà de la limite de
    // Discord, et plus de puces que les vingt réactions permises.
    const dayCount =
      Math.round((endDate - startDate) / (24 * 60 * 60 * 1000)) + 1;
    if (dayCount > MAX_DAYS) {
      await interaction.editReply({
        content: `❌ La période ne peut pas dépasser ${MAX_DAYS} jours (${dayCount} demandés).`,
      });
      return;
    }

    // Générer la liste des jours
    const daysOfWeek = [
      "Dimanche",
      "Lundi",
      "Mardi",
      "Mercredi",
      "Jeudi",
      "Vendredi",
      "Samedi",
    ];
    let daysOfTheWeek = "";
    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const dayName = daysOfWeek[currentDate.getDay()];
      const dayStr = String(currentDate.getDate()).padStart(2, "0");
      const monthStr = String(currentDate.getMonth() + 1).padStart(2, "0");
      daysOfTheWeek += `${dayName} ${dayStr}/${monthStr}\n`;

      currentDate.setDate(currentDate.getDate() + 1);
    }

    let pollMessage = await interaction.channel.send(
      `# ${input} :\n${daysOfTheWeek}`
    );
    await autoAddEmojis(pollMessage);
    await interaction.editReply({
      content: "Sondage créé ✅",
    });
   } catch (error) {
    handleException(error);
    await interaction
      .editReply({ content: "❌ Le sondage n'a pas pu être créé." })
      .catch(() => {});
   }
  },
};

// Le maximum de puces posables par autoAddEmojis : au-delà, les derniers jours
// seraient listés sans réaction associée.
const MAX_DAYS = 20;

// `new Date(2024, NaN, NaN)` ne lève pas : il renvoie une date invalide, que
// l'ancien try/catch ne détectait donc jamais. On valide explicitement.
function parseDayMonth(input, fallbackYear) {
  const match = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(String(input).trim());
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const year = match[3] ? parseInt(match[3], 10) : fallbackYear;

  const date = new Date(year, month, day);
  // Rejette les dates qui « débordent » (31/02 devient le 2 ou 3 mars).
  if (
    date.getDate() !== day ||
    date.getMonth() !== month ||
    date.getFullYear() !== year
  ) {
    return null;
  }
  return date;
}
