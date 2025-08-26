import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException } from "../modules/utils.js";
import dotenv from "dotenv";
dotenv.config(); // process.env.CONSTANT

export default {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription(`Fourni la liste des commandes disponibles avec ce bot`),

  async execute(interaction) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const commands = interaction.client.commands;
      const commandList = commands
        .map((cmd) => `• **/${cmd.data.name}**: ${cmd.data.description}`)
        .join("\n");

      await interaction.editReply({
        content: `Voici la liste des commandes disponibles:\n${commandList}`,
      });
    } catch (error) {
      handleException(error);
    }
  },
};
