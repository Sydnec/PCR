import { SlashCommandBuilder } from 'discord.js';
import { handleException } from '../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config();

export default {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Rejoindre le fil de discussion actuel'),

    async execute(interaction) {
        try {
            // Vérifier que la commande est utilisée dans un fil (thread)
            if (!interaction.channel.isThread()) {
                return interaction.reply({
                    content: '❌ Cette commande ne peut être utilisée que dans un fil de discussion.',
                    ephemeral: true,
                });
            }

            const thread = interaction.channel;
            const user = interaction.user;

            // Ajouter l'utilisateur au fil
            await thread.members.add(user.id);

            // Répondre avec l'émoji eyes
            await interaction.reply({ content: '👀', ephemeral: true });

        } catch (error) {
            handleException(error);
            
            // Gérer le cas où l'utilisateur est déjà dans le fil
            if (error.code === 50055) {
                return interaction.reply({
                    content: '✅ Tu es déjà membre de ce fil !',
                    ephemeral: true,
                });
            }
            
            await interaction.reply({
                content: '❌ Une erreur est survenue lors de l\'ajout au fil.',
                ephemeral: true,
            }).catch(() => {});
        }
    },
};
