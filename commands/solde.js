import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException } from "../modules/utils.js";
import db from "../modules/points-db.js";

export default {
  data: new SlashCommandBuilder()
    .setName("solde")
    .setDescription("Affiche le solde de points d'un utilisateur")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("L'utilisateur dont vous voulez voir le solde")
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      const targetUser =
        interaction.options.getUser("user") || interaction.user;

      db.get(
        "SELECT balance FROM points WHERE user_id = ?",
        [targetUser.id],
        (err, row) => {
          if (err) {
            handleException(err);
            return interaction.reply({
              content:
                "Une erreur est survenue lors de la récupération du solde.",
              flags: MessageFlags.Ephemeral,
            });
          }

          const balance = row ? row.balance : 0;
          interaction.reply({
            content: `Le solde de **${targetUser.username}** est de **${balance}** points.`,
            flags: MessageFlags.Ephemeral,
          });
        }
      );
    } catch (error) {
      handleException(error);
    }
  },
};
