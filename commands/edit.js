import { SlashCommandBuilder } from 'discord.js';
import { addEmojis } from '../modules/utils.js';
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

    async execute(interaction, bot) {
        const channel = interaction.channel;
        if (channel.parentId != process.env.POLL_CHANNEL_ID) return;
        const message = await channel.fetchStarterMessage(); //Récupère le message du post
        await message.edit(
            interaction.options.getString('message').replace(/;/g, '\n')
        );
        addEmojis(message);
    },
};
