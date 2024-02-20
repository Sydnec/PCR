import { SlashCommandBuilder } from 'discord.js';
import { handleException } from '../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

export default {
	data: new SlashCommandBuilder()
		.setName('ecaflip')
		.setDescription('Pile ou Face ?')
		.addStringOption((option) =>
			option
				.setName('option1')
				.setDescription('Choix 1 ou question à répondre par Oui ou Non')
				.setRequired(true)
		)
		.addStringOption((option) =>
			option.setName('option2').setDescription('Choix 2')
		),

	async execute(interaction) {
		const option2 = interaction.options.getString('option2');
		if (Math.random() > 0.5) {
            interaction.reply({
                content: option2 == '' ? 'Oui' : interaction.options.getString('option1'),
            });
		} else {
            interaction.reply({
                content: option2 == '' ? 'Non' : option2,
            });
		}
		
	},
};
