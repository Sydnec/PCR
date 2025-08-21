import { SlashCommandBuilder } from 'discord.js';
import { handleException } from '../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

export default {
    data: new SlashCommandBuilder()
        .setName('randomizabaise')
        .setDescription('Depuis le temps que vous l'attendiez celle là')
        .addStringOption((option) =>
            option
                .setName('option')
                .setDescription('description')
                .setRequired(true)
        ),

    async execute(interaction) {
        interaction.reply({
            content: '',
            ephemeral: true,
        });
    },
};
