import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { handleException } from '../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

export default {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription(`Fourni la liste des commandes disponibles avec ce bot`),

    async execute(interaction) {
        try {
            const commands = interaction.client.commands;
            const commandList = commands.map(cmd => `• **/${cmd.data.name}**: ${cmd.data.description}`).join('\n');

            await interaction.reply({
                content: `Voici la liste des commandes disponibles:\n${commandList}`,
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            handleException(error);
        }
    },
};
