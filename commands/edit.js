import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { autoAddEmojis, handleException, isAdmin } from "../modules/utils.js";
import dotenv from "dotenv";
dotenv.config(); // process.env.CONSTANT

export default {
  data: new SlashCommandBuilder()
    .setName("edit")
    .setDescription("Modifie la question du sondage")
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription(
          "nouveau message (séparer avec ; pour faire des retour à la ligne)"
        )
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = interaction.channel;
    if (channel.parentId != process.env.POLL_CHANNEL_ID) {
      await interaction.editReply({
        content: "❌ Cette commande ne s'utilise que dans un post de sondage.",
      });
      return;
    }
    // Seul l'auteur du sondage (ou un administrateur) peut le réécrire :
    // n'importe quel membre pouvait auparavant remplacer la question de
    // n'importe quel sondage du salon.
    if (channel.ownerId !== interaction.user.id && !isAdmin(interaction.member)) {
      await interaction.editReply({
        content: "❌ Seul l'auteur du sondage peut le modifier.",
      });
      return;
    }
    try {
      const message = await channel.fetchStarterMessage(); //Récupère le message du post
      await message.edit(
        interaction.options.getString("message").replace(/;/g, "\n")
      );
      await autoAddEmojis(message);
      await interaction.editReply({
        content: "Ça y est chef !",
      });
    } catch (err) {
      // handleException n'était pas importé : le catch levait une
      // ReferenceError et masquait l'erreur d'origine.
      handleException(err);
      await interaction
        .editReply({ content: "❌ Impossible de modifier ce sondage." })
        .catch(() => {});
    }
  },
};
