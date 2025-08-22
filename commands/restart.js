import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException, isAdmin } from "../modules/utils.js";
import dotenv from "dotenv";
dotenv.config(); // process.env.CONSTANT

export default {
  data: new SlashCommandBuilder()
    .setName("restart")
    .setDescription("Redémarre le bot (réservé aux administrateurs)"),

  async execute(interaction, bot) {
    try {
      await interaction.deferReply({ ephemeral: true });
      if (!isAdmin(interaction.member)) {
        await interaction.editReply({
          content:
            "Vous n'avez pas les autorisations nécessaires pour utiliser cette commande.",
        });
        return;
      } else {
        await interaction.editReply({
          content: "Redémarrage en cours...",
        });
        await bot.destroy();
        process.exit(0);
      }
    } catch (err) {
      handleException(err);
    }
  },
};
