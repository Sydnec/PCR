import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { handleException } from "../modules/utils.js";
import { getLeaderboard } from "../modules/pokemon/collection.js";
import { dexSize } from "../modules/pokemon/data.js";

export default {
  data: new SlashCommandBuilder()
    .setName("pokeclassement")
    .setDescription("Classement des meilleurs dresseurs"),

  async execute(interaction) {
    try {
      await interaction.deferReply();

      getLeaderboard(10, async (err, rows) => {
        if (err) {
          handleException(err);
          return interaction
            .editReply({ content: "❌ Impossible de lire le classement." })
            .catch(() => {});
        }

        if (!rows || !rows.length) {
          return interaction
            .editReply({ content: "Aucun Pokémon n'a encore été capturé." })
            .catch(() => {});
        }

        const lines = [];
        for (const [index, row] of rows.entries()) {
          const medal = ["🥇", "🥈", "🥉"][index] || `${index + 1}.`;
          let username = "Inconnu";
          try {
            const user = await interaction.client.users.fetch(row.user_id);
            username = user.username;
          } catch (error) {
            // Dresseur ayant quitté le serveur : on garde la ligne.
          }
          lines.push(
            `${medal} **${username}** — ${row.dex}/${dexSize()} espèces` +
              (row.shinies ? ` · ✨ ${row.shinies}` : "") +
              ` · ${row.total} captures`
          );
        }

        const embed = new EmbedBuilder()
          .setTitle("🏆 Classement des dresseurs")
          .setColor(0xcc0000)
          .setDescription(lines.join("\n"))
          .setFooter({ text: "Classé par espèces distinctes, puis shinies" });

        await interaction.editReply({ embeds: [embed] }).catch(() => {});
      });
    } catch (error) {
      handleException(error);
    }
  },
};
