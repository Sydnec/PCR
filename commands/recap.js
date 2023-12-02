import { SlashCommandBuilder } from 'discord.js';
import { handleException, log, error } from '../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

export default {
    data: new SlashCommandBuilder()
        .setName('recap')
        .setDescription('Affiche un récapitulatif pour le membre'),

    async execute(interaction) {
        // Récupérer les informations nécessaires
        const member = interaction.member;
        const joinDate = member.joinedAt.toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'numeric',
            year: 'numeric',
        });
        const analyse = await getMessageCountAndOldestMessageUrl(
            interaction.guild,
            member
        );
        const firstMessage = analyse.oldestMessage.url;
        const messageCount = analyse.count;

        const recapText =
            `Récapitulatif pour ${member.displayName} :\n` +
            `Date d'entrée sur le serveur : ${joinDate}\n` +
            `Premier message : ${firstMessage}\n` +
            `Nombre de messages : ${messageCount}\n`;

        interaction.reply({ content: recapText, ephemeral: true });
    },
};

async function getFirstMessage(guild, member) {
    return null;
}
async function getMessageCount(guild, member) {
    const channels = guild.channels.cache;
    // Initialise un tableau pour stocker tous les messages correspondants
    let allMessages = [];
    let count = 0;
    // Parcours chaque canal
    channels.forEach(async (channel) => {
        if (channel.type != 2) {
            // Récupère les messages du canal
            const messages = await channel.messages.fetch();
            const filteredMessages = messages.filter(
                (msg) => msg.author.id === member.id
            );
            count += filteredMessages.size;
        }
    });
    return count;
}

async function getMessageCountAndOldestMessageUrl(guild, member) {
    const channels = guild.channels.cache;
    const excludedChannelTypes = [2, 4, 15];
    let count = 0;
    let oldestMessage;

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

                    if (filteredMessages.size > 0) {
                        count += filteredMessages.size;

                        const oldestInChannel = filteredMessages.reduce(
                            (oldest, msg) => {
                                return oldest
                                    ? msg.createdAt < oldest.createdAt
                                        ? msg
                                        : oldest
                                    : msg;
                            },
                            null
                        );

                        if (
                            !oldestMessage ||
                            (oldestInChannel &&
                                (!oldestMessage ||
                                    oldestInChannel.createdAt <
                                        oldestMessage.createdAt))
                        ) {
                            oldestMessage = oldestInChannel;
                        }
                    }

                    if (messages.size > 0) {
                        lastId = messages.last().id;
                    } else {
                        lastId = undefined;
                    }
                } while (lastId !== undefined);
            } catch (error) {
                console.error(
                    `Erreur lors de la récupération des messages du canal ${channel.name}: ${error.message}, ${channel.type}`
                );
            }
        }
    }

    return { count, oldestMessage };
}
