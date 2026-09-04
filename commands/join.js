import { SlashCommandBuilder, MessageFlags } from 'discord.js';
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
                    flags: MessageFlags.Ephemeral,
                });
            }

            const thread = interaction.channel;
            const user = interaction.user;

            // Ajouter l'utilisateur au fil
            await thread.members.add(user.id);

            // Répondre avec l'émoji eyes
            await interaction.reply({ content: '👀', flags: MessageFlags.Ephemeral });

        } catch (error) {
            handleException(error);
            
            // Répondre une seconde fois lèverait à son tour : on ne tente la
            // réponse que si l'interaction n'a pas encore été honorée.
            if (interaction.replied || interaction.deferred) return;

            // Gérer le cas où l'utilisateur est déjà dans le fil
            const content =
                error.code === 50055
                    ? '✅ Tu es déjà membre de ce fil !'
                    : '❌ Une erreur est survenue lors de l\'ajout au fil.';
            await interaction
                .reply({ content, flags: MessageFlags.Ephemeral })
                .catch(() => {});
        }
    },
};
