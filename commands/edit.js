import { SlashCommandBuilder } from 'discord.js';
import { autoAddEmojis } from '../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

export default {
    data: new SlashCommandBuilder()
        .setName('edit')
        .setDescription('Modifie la question du sondage')
        .addStringOption((option) =>
            option
                .setName('message')
                .setDescription(
                    'nouveau message (séparer avec ; pour faire des retour à la ligne)'
                )
                .setRequired(true)
        ),

    async execute(interaction) {
        const channel = interaction.channel;
        if (channel.parentId != process.env.POLL_CHANNEL_ID) return;
        try {
            const message = await channel.fetchStarterMessage(); //Récupère le message du post
            await message.edit(
                interaction.options.getString('message').replace(/;/g, '\n')
            );
            autoAddEmojis(message).then(
                interaction.reply({
                    content: 'Ça y est chef !',
                    ephemeral: true,
                })
            );
        } catch (err) {
            handleException(err);
        }
    },
};
