import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { handleException } from "../modules/utils.js";
import db from "../modules/points-db.js";

export default {
  data: new SlashCommandBuilder()
    .setName("classement")
    .setDescription("Affiche le classement des utilisateurs avec le plus de points"),

  async execute(interaction) {
    try {
      await interaction.deferReply();

      db.all(
        "SELECT user_id, balance FROM points ORDER BY balance DESC LIMIT 10",
        async (err, rows) => {
          if (err) {
            handleException(err);
            return interaction.editReply({
              content: "Une erreur est survenue lors de la récupération du classement.",
            });
          }

          if (!rows || rows.length === 0) {
            return interaction.editReply({
              content: "Aucun point n'a encore été distribué.",
            });
          }

          const embed = new EmbedBuilder()
            .setTitle("🏆 Classement des points")
            .setColor(0xffd700)
            .setTimestamp();

          let description = "";
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            let username = row.user_id;
            try {
              const user = await interaction.client.users.fetch(row.user_id);
              username = user.username;
            } catch (e) {
              // User might have left or is invalid
            }
            
            let medal = "";
            if (i === 0) medal = "🥇";
            else if (i === 1) medal = "🥈";
            else if (i === 2) medal = "🥉";
            else medal = `${i + 1}.`;

            description += `${medal} **${username}** - ${row.balance} points\n`;
          }

          embed.setDescription(description);
          interaction.editReply({ embeds: [embed] });
        }
      );
    } catch (error) {
      handleException(error);
    }
  },
};
