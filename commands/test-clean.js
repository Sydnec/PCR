import { SlashCommandBuilder } from 'discord.js';
import { handleException } from '../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

export default {
    data: new SlashCommandBuilder()
        .setName('test-clean')
        .setDescription(`Description`)
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
