import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { handleException, isAdmin } from '../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

export default {
    data: new SlashCommandBuilder()
        .setName('restart')
        .setDescription('Redémarre le bot (réservé aux administrateurs)'),

    async execute(interaction, bot) {
        try {
            if (!isAdmin(interaction.member)) {
                await interaction.reply({
                    content:
                        "Vous n'avez pas les autorisations nécessaires pour utiliser cette commande.",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            } else {
                await interaction.reply({
                    content: 'Redémarrage en cours...',
                    flags: MessageFlags.Ephemeral,
                });
                await bot.destroy();
                process.exit(0);
            }
        } catch (err) {
            handleException(err);
        }
    },
};
