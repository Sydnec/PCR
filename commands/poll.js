import { SlashCommandBuilder, MessageFlags } from 'discord.js';
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
        const input = interaction.options.getString('question');

        let options = '';
        for (let i = 1; i <= 10; i++) {
            const option = interaction.options.getString(`option${i}`);
            if (option) {
                options += option + '\n';
            }
        }

        const pollChannel = await bot.channels.fetch(
            process.env.POLL_CHANNEL_ID
        );
        const newThread = await pollChannel.threads.create({
            name: input.substr(0, 99),
            message: { content: options },
            autoArchiveDuration: 60,
        });
        newThread.members.add(interaction.member.id);
        if (input.length > 99)
            newThread.send('La question était trop longue : \n' + input);
        await interaction.reply({
            content: 'Sondage créé',
            flags: MessageFlags.Ephemeral,
        });
    },
};
