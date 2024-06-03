import { SlashCommandBuilder } from 'discord.js';
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
                    ephemeral: true,
                });
                return;
            } else {
                await interaction.reply({
                    content: 'Redémarrage en cours...',
                    ephemeral: true,
                });
                await bot.destroy();
                process.exit(0);
            }
        } catch (err) {
            handleException(err);
        }
    },
};
