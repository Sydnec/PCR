import { SlashCommandBuilder } from 'discord.js';
import { handleException, updateThreadList } from '../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

export default {
    data: new SlashCommandBuilder()
        .setName('118218')
        .setDescription('Met à jour manuellement la liste des fils de discussion'),

    async execute(interaction) {
        try {
            await interaction.reply({
                content: 'Mise à jour de la liste des threads en cours...',
                ephemeral: true,
            });
            await updateThreadList(interaction.guild);
            await interaction.editReply({
                content: 'Thread list updated successfully!',
            });
        } catch (error) {
            handleException(error);
            await interaction.editReply({
                content: 'An error occurred while updating the thread list.',
            });
        }
    },
};
