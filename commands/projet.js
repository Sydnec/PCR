import { SlashCommandBuilder } from "discord.js";
import { handleException, isAdmin } from "../modules/utils.js";
import dotenv from "dotenv";
dotenv.config(); // process.env.CONSTANT

export default {
  data: new SlashCommandBuilder().setName("projet").setDescription("projet"),

  async execute(interaction) {
    try {
      if (isAdmin(interaction.member)) {
        interaction.reply({
          content:
            "Le récapitulatif 2023 te sera envoyé en MP quand il sera prêt",
          ephemeral: true,
        });

        // Récupérer les informations nécessaires
        const member = interaction.member;
        const joinDate = member.joinedAt.toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "numeric",
          year: "numeric",
        });
        processAllMembers(interaction.guild, member);
      }
    } catch (error) {
      handleException(error);
    }
  },
};

async function processAllMembers(guild, memberToSend) {
  const members = guild.members.cache;

  for (const [_, member] of members) {
    const messageCount = await getMessageCount(guild, member);
    await memberToSend.send(`Le nombre de messages de ${member.user.username} est ${messageCount}`);
  }
}

async function getMessageCount(guild, member) {
  const channels = guild.channels.cache;
  const excludedChannelTypes = [2, 4, 15];
  let count = 0;

  for (const [_, channel] of channels) {
    if (!excludedChannelTypes.includes(channel.type)) {
      try {
        let lastId;
        do {
          const options = { limit: 100, before: lastId };
          const messages = await channel.messages.fetch(options);
          const filteredMessages = messages.filter(
            (msg) => msg.author.id === member.id
          );
          count += filteredMessages.size;
          lastId = messages.last()?.id;
        } while (lastId !== undefined);
      } catch (e) {
        handleException(e);
      }
    }
  }
  return count;
}
