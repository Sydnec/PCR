import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException } from "../modules/utils.js";
import { readFileSync } from "fs";

const packageJson = JSON.parse(readFileSync("./package.json", "utf-8"));

export default {
  data: new SlashCommandBuilder()
    .setName("version")
    .setDescription("Affiche la version actuelle du bot"),

  async execute(interaction) {
    try {
      await interaction.reply({
        content: `La version actuelle du bot est : **v${packageJson.version}**`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      handleException(error);
    }
  },
};
