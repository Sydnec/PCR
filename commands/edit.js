import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { autoAddEmojis, handleException } from "../modules/utils.js";
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
    // handleException n'était pas importé : la branche d'erreur levait une
    // ReferenceError, masquant l'erreur d'origine.
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const channel = interaction.channel;
      if (channel.parentId != process.env.POLL_CHANNEL_ID) {
        // L'ancien `return` sec laissait l'interaction différée sans réponse.
        await interaction.editReply({
          content: "❌ Cette commande ne s'utilise que dans un post de sondage.",
        });
        return;
      }

      const message = await channel.fetchStarterMessage(); //Récupère le message du post
      await message.edit(
        interaction.options.getString("message").replace(/;/g, "\n")
      );
      // `.then(promesse)` exécutait editReply immédiatement, avant même que les
      // réactions soient posées, et ignorait un éventuel échec.
      await autoAddEmojis(message);
      await interaction.editReply({
        content: "Ça y est chef !",
      });
    } catch (err) {
      handleException(err);
      await interaction
        .editReply({ content: "❌ Le sondage n'a pas pu être modifié." })
        .catch(() => {});
    }
  },
};
