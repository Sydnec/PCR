import { SlashCommandBuilder } from 'discord.js';
import { handleException, isAdmin } from '../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

export default {
    data: new SlashCommandBuilder()
        .setName('projet')
        .setDescription('projet'),

    async execute(interaction) {
        try {
            if (!isAdmin(interaction.member)) {
                interaction.reply({
                    content:
                        'Le récapitulatif 2023 te sera envoyé en MP quand il sera prêt',
                    ephemeral: true,
                });

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

                // Envoyer RecapText en MP à member
                await member.send(recapText);
            }
        } catch (error) {
            handleException(error);
        }
    },
};

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
            } catch (e) {
                handleException(e);
            }
        }
    }

    return { count, oldestMessage };
}
