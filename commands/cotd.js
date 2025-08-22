import { SlashCommandBuilder, MessageFlags } from "discord.js";
import axios from "axios"; // Pour faire des requêtes HTTP
import { handleException } from "../modules/utils.js";
import dotenv from "dotenv";
dotenv.config(); // Charger les variables d'environnement

export default {
  data: new SlashCommandBuilder()
    .setName("cotd")
    .setDescription("Affiche les saints du jour"),

  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });
      // Appel de la fonction handleCOTDOnTimer
      const url = "https://nominis.cef.fr/json/nominis.php";
      const response = await axios.get(url);

      if (
        response.data &&
        response.data.response &&
        response.data.response.prenoms &&
        response.data.response.prenoms.majeurs
      ) {
        const saints = response.data.response.prenoms.majeurs;
        let messageContent = `Nous sommes le ${formatDate(
          response.data.response.query.jour,
          response.data.response.query.mois
        )} et nous célébrons les :`;

        Object.keys(saints).forEach((name) => {
          const gender =
            saints[name].sexe === "masculin" ? "Masculin" : "Féminin";
          messageContent += `\n- ${name} (${gender})`;
        });

        messageContent += "\nPour fêter ça, apéro !";
        await interaction.editReply({
          content: messageContent,
        });
      }
    } catch (error) {
      handleException(error); // Utilisation de ton module d'erreur personnalisé
    }
  },
};

function formatDate(day, month) {
  // Ajoute un zéro devant si le jour ou le mois a un seul chiffre
  const formattedDay = day.toString().padStart(2, "0");
  const formattedMonth = month.toString().padStart(2, "0");

  return `${formattedDay}/${formattedMonth}`;
}
