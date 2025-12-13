import { SlashCommandBuilder } from "discord.js";
import { handleException } from "../modules/utils.js";
import dotenv from "dotenv";
dotenv.config();

export default {
  data: new SlashCommandBuilder()
    .setName("recap")
    .setDescription("Déclenche le récapitulatif annuel")
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Type de récapitulatif")
        .setRequired(true)
        .addChoices(
          { name: "🎉 Récap Annuel", value: "annual-recap" }
        )
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply();
      const type = interaction.options.getString("type");

      if (type === "annual-recap") {
        // Vérifier que c'est SYDNEC_USER_ID qui lance la commande
        if (interaction.user.id !== process.env.SYDNEC_USER_ID) {
          await interaction.editReply({
            content: "❌ Seul le seigneur peut lancer le récapitulatif annuel de test.",
            ephemeral: true,
          });
          return;
        }

        await interaction.editReply({
          content: "🎉 Lancement du récapitulatif annuel de test...",
          ephemeral: true,
        });

        // Déclencher le handler
        try {
          await interaction.client.handleAnnualRecapOnTimer();
        } catch (error) {
          handleException(error);
        }
      }
    } catch (error) {
      handleException(error);
          await interaction.editReply({
            content: "❌ Une erreur est survenue lors de la récupération des statistiques.",
            ephemeral: true,
          });
    }
  },
};
