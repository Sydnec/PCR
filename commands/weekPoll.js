import { SlashCommandBuilder } from 'discord.js';
import { handleException, log, autoAddEmojis } from '../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

export default {
    data: new SlashCommandBuilder()
        .setName('week')
        .setDescription('Créer un sondage contenant tous les jours de la semaine')
        .addStringOption((option) =>
            option
                .setName('question')
                .setDescription('Que proposes-tu cette semaine ?')
                .setRequired(true)
        ),

    async execute(interaction, bot) {
        const input = interaction.options.getString('question');
        const daysOfTheWeek = 'Lundi \nMardi \nMercredi \nJeudi \nVendredi \nSamedi \nDimanche'
        let pollMessage = await interaction.channel.send(`# ${input} :\n ${daysOfTheWeek}`);
        await autoAddEmojis(pollMessage, bot);
        await interaction.reply({
            content: 'Sondage créé',
            ephemeral: true,
        });
    },
};
