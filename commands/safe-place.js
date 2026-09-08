import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { handleException } from '../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

export default {
    data: new SlashCommandBuilder()
        .setName('safe-place')
        .setDescription('Envoie un message anonymement dans la safe place')
        .addStringOption((option) =>
            option
                .setName('message')
                .setDescription('message à envoyer')
                .setRequired(true)
                .setMaxLength(1800)
        ),
    async execute(interaction, bot) {
        // Réponse différée en privé : sans elle, un salon injoignable laissait
        // l'interaction expirer sans le moindre retour.
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const channel = await bot.channels.fetch(
                process.env.SAFE_PLACE_CHANNEL_ID
            );
            if (!channel) {
                throw new Error('SAFE_PLACE_CHANNEL_ID introuvable');
            }

            const message = await channel.send({
                content: `Ce message a été envoyé anonymement en utilisant la commande \/safe-place : \n${interaction.options.getString(
                    'message'
                )}`,
                // Message anonyme : personne ne doit pouvoir s'en servir pour
                // mentionner quelqu'un — ou tout le serveur — sans en répondre.
                allowedMentions: { parse: [] },
            });

            await interaction.editReply({
                content: 'Message envoyé ' + message.url,
            });
        } catch (error) {
            handleException(error);
            await interaction
                .editReply({
                    content: "❌ Impossible d'envoyer le message anonyme.",
                })
                .catch(() => {});
        }
    },
};
