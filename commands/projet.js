import { SlashCommandBuilder } from 'discord.js';
import { handleException, isAdmin } from '../modules/utils.js';
import { format } from 'date-fns';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

export default {
    data: new SlashCommandBuilder().setName('projet').setDescription('projet'),

    async execute(interaction) {
        try {
            if (isAdmin(interaction.member)) {
                interaction.reply({
                    content:
                        'Le récapitulatif 2023 te sera envoyé en MP quand il sera prêt',
                    ephemeral: true,
                });
                const result = await getMessageCount(interaction.guild)
                  // Appeler la fonction pour chaque utilisateur
                for (const userId in result) {
                    interaction.channel.send(getUserInfo(userId, result));
                }
                
          }
        } catch (error) {
            handleException(error);
        }
    },
};

async function getMessageCount(guild) {
    try {
        await guild.members.fetch();
        const userStats = {};
        if (guild.channels.cache) {
            for (const [_, channel] of guild.channels.cache) {
                let userCount = {};
                const excludedChannelTypes = [4, 15];
                if (!excludedChannelTypes.includes(channel.type)) {
                    try {
                        let lastId;
                        do {
                            const options = { limit: 100, before: lastId };
                            const messages =
                                channel && channel.messages
                                    ? await channel.messages.fetch(options)
                                    : null;
                            for (const [_, member] of guild.members.cache) {
                                const filteredMessages = messages.filter(
                                    (msg) => msg.author.id === member.id
                                );
                                const messageCount = filteredMessages.size;
                                if (messageCount > 0) {
                                    userStats[member.id] = userStats[
                                        member.id
                                    ] || {
                                        username: member.user.username,
                                        joinedAt: member.joinedAt,
                                        count: 0,
                                        mostReactedMessage: '',
                                        mostActiveChannel: channel,
                                        channelMaxNumber: 0,
                                    };
                                    userCount[member.id] = userCount[
                                        member.id
                                    ] || {
                                        count: 0,
                                    };
                                    userCount[member.id].count += messageCount;
                                    userStats[member.id].count += messageCount;
                                    const newMostReactedMessage =
                                        await Array.from(
                                            filteredMessages.values()
                                        ).reduce((prev, current) =>
                                            prev.reactions.cache.size >
                                            current.reactions.cache.size
                                                ? prev
                                                : current
                                        );
                                    if (
                                        !userStats[member.id].mostReactedMessage || newMostReactedMessage.reactions.cache
                                            .size >
                                        userStats[member.id].mostReactedMessage
                                            .reactions.cache.size
                                    ) {
                                        userStats[
                                            member.id
                                        ].mostReactedMessage =
                                            newMostReactedMessage;
                                    }
                                }
                            }
                            lastId = messages.last()?.id;
                        } while (lastId !== undefined);
                        for (const [_, member] of guild.members.cache) {
                            if (
                                userCount[member.id] &&
                                userCount[member.id].count >
                                    userStats[member.id].channelMaxNumber
                            ) {
                                userStats[member.id].channelMaxNumber =
                                    userCount[member.id].count;
                                userStats[member.id].mostActiveChannel =
                                    channel;
                            }
                        }
                    } catch (e) {
                        handleException(e);
                    }
                }
            }
        }
        return userStats;
    } catch (e) {
        handleException(e);
        return {};
    }
}

function getUserInfo(userId, result) {
    const user = result[userId];
    let resultString = ""
    // Vérifier si l'utilisateur existe
    if (!user) {
      console.log(`Utilisateur avec l'ID ${userId} non trouvé.`);
      return;
    }
  
    // Récupérer les informations demandées
    const username = user.username;
    const joinedAt = user.joinedAt;
    const count = user.count;
    const countChannelMax = user.channelMaxNumber;
    const mostActiveChannel = user.mostActiveChannel;
    const mostReactedMessage = user.mostReactedMessage;
  
    // Afficher les informations
    resultString += `Pour l'utilisateur '${username}':\n`
    resultString += `- Nom d'utilisateur: ${username}\n`
    resultString += `- Date d'arrivée sur le serveur: ${format(joinedAt, 'dd/MM/yyyy', { locale: fr })}\n`
    resultString += `- Nombre de messages au total: ${count}\n`
    resultString += `- Nombre de messages dans le canal le plus actif: ${countChannelMax}\n`
    resultString += `- Nom du canal le plus actif:\n`
    resultString += `  - Nom du channel: ${mostActiveChannel.name}\n`
    resultString += `  - Lien du channel: ${mostActiveChannel.url}\n`
    resultString += `- Message le plus réagi:\n`
    resultString += `  - Lien du message: ${mostReactedMessage.url}\n`
    resultString += `  - Contenu du message: ${mostReactedMessage.content}\n`
    // Les informations sur les réactions ne sont pas fournies dans la structure
      return resultString
  }