import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException } from "../modules/utils.js";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Chemin résolu depuis ce fichier : « ./package.json » dépendait du répertoire
// courant, et le module levait au chargement si le bot n'était pas lancé depuis
// la racine du projet — ce qui faisait échouer l'enregistrement des commandes.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(path.join(__dirname, "../package.json"), "utf-8")
);

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
