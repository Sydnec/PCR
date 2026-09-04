import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { handleException } from '../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

const data = new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Créer un sondage dans le channel #Sondage')
    .addStringOption((option) =>
        option
            .setName('question')
            .setDescription('message à envoyer')
            .setRequired(true)
    );

for (let i = 1; i <= 10; i++) {
    data.addStringOption((option) =>
        option
            .setName(`option${i}`)
            .setDescription(
                `intitulé de l'option ${i} (Ajoutez l'emoji en début d'option)`
            )
            .setRequired(false)
    );
}

export default {
    data,
    async execute(interaction, bot) {
        // Sans try/catch, la moindre erreur (salon introuvable, permissions)
        // laissait l'interaction sans réponse.
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const input = interaction.options.getString('question');

            let options = '';
            for (let i = 1; i <= 10; i++) {
                const option = interaction.options.getString(`option${i}`);
                if (option) {
                    options += option + '\n';
                }
            }

            // Un fil ne peut pas être créé avec un message vide : sans option,
            // l'API rejetait la requête.
            if (!options) {
                await interaction.editReply({
                    content: '❌ Ajoute au moins une option au sondage.',
                });
                return;
            }

            const pollChannel = await bot.channels
                .fetch(process.env.POLL_CHANNEL_ID)
                .catch(() => null);
            if (!pollChannel?.threads) {
                await interaction.editReply({
                    content: '❌ Le salon de sondage est introuvable ou inaccessible.',
                });
                return;
            }

            const newThread = await pollChannel.threads.create({
                name: input.slice(0, 99),
                message: { content: options },
                autoArchiveDuration: 60,
            });
            await newThread.members.add(interaction.user.id).catch(() => {});
            if (input.length > 99)
                await newThread.send('La question était trop longue : \n' + input);
            await interaction.editReply({ content: 'Sondage créé' });
        } catch (error) {
            handleException(error);
            await interaction
                .editReply({ content: '❌ Le sondage n\'a pas pu être créé.' })
                .catch(() => {});
        }
    },
};
