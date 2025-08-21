import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config(); // Charger les variables d'environnement

export default {
    data: new SlashCommandBuilder()
        .setName('chanid')
        .setDescription(`Récupère l'ID du canal actuel`),

    async execute(interaction) {
        try {
            // Récupérer l'ID du canal où la commande a été exécutée
            const channelId = interaction.channelId;

            // Envoyer l'ID du canal à l'utilisateur
            await interaction.reply({
                content: `L'ID de ce canal est : ${channelId}`,
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            console.error(`Erreur lors de la récupération de l'ID du canal : ${error}`);
            await interaction.reply({
                content: `Une erreur est survenue lors de la récupération de l'ID du canal.`,
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};
