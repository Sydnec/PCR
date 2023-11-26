import { SlashCommandBuilder } from 'discord.js';
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
        ),
    async execute(interaction, bot) {
        const channel = await bot.channels
            .fetch(process.env.SAFE_PLACE_CHANNEL_ID)
            .catch(handleException);
        channel
            .send(
                `Ce message a été envoyé anonymement en utilisant la commande \/safe-place : \n${interaction.options.getString(
                    'message'
                )}`
            )
            .then((message) =>
                interaction.reply({
                    content: 'Message envoyé ' + message.url,
                    ephemeral: true,
                })
            );
    },
};
