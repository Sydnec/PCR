import { SlashCommandBuilder } from 'discord.js';
import { handleException, isAdmin } from '../modules/utils.js';
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
                getMessageCount(interaction.guild);
            }
        } catch (error) {
            handleException(error);
        }
    },
};

async function getMessageCount(guild) {
    try {
        await guild.members.fetch(); // Assure-toi que tous les membres sont chargés

        const userMessageCount = {}; // Utilise un objet pour stocker le nombre de messages par utilisateur

        for (const [_, channel] of guild.channels.cache) {
            const excludedChannelTypes = [4, 15];

            if (!excludedChannelTypes.includes(channel.type)) {
                try {
                    let lastId;
                    do {
                        const options = { limit: 100, before: lastId };
                        const messages = await channel.messages.fetch(options);

                        for (const [_, member] of guild.members.cache) {
                            const filteredMessages = messages.filter(
                                (msg) => msg.author.id === member.id
                            );
                            userMessageCount[member.id] =
                                (userMessageCount[member.id] || 0) +
                                filteredMessages.size;
                        }

                        lastId = messages.last()?.id;
                    } while (lastId !== undefined);
                } catch (e) {
                    handleException(e);
                }
            }
        }
        console.log(userMessageCount)
        // Maintenant, userMessageCount contient le nombre de messages pour chaque utilisateur
        return userMessageCount;
    } catch (e) {
        handleException(e);
        return {}; // En cas d'erreur, retourne un objet vide
    }
}
