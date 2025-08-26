import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException } from "../modules/utils.js";
import dotenv from "dotenv";
dotenv.config();

export default {
  data: new SlashCommandBuilder()
    .setName("pin")
    .setDescription("Épingle un message dans le salon")
    .addStringOption((option) =>
      option
        .setName("message_url")
        .setDescription("URL du message à épingler")
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const messageUrl = interaction.options.getString("message_url");
    const regex = /https:\/\/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/;
    const match = messageUrl.match(regex);

    if (!match) {
      return interaction.editReply({
        content: "URL de message invalide.",
      });
    }

    const channelId = match[2]; // ID du salon
    const messageId = match[3]; // ID du message

    try {
      const channel = await interaction.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        return interaction.editReply({
          content: "Impossible de trouver le salon.",
        });
      }

      const message = await channel.messages.fetch(messageId);
      if (!message) {
        return interaction.editReply({
          content: "Message introuvable.",
        });
      }

      await message.pin();
      await interaction.editReply({
        content: "Message épinglé avec succès !",
      });
    } catch (error) {
      handleException(error);
      await interaction.editReply({
        content: "Une erreur est survenue lors de l'épinglage du message.",
      });
    }
  },
};
