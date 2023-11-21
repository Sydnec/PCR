import { SlashCommandBuilder } from 'discord.js';

const data = new SlashCommandBuilder()
        .setName('ping')
        .setDescription('pong !')

export default {
    data,
    async execute(interaction, bot) {
        await interaction.reply('Pong !');
    },
};