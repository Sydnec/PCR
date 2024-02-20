import { SlashCommandBuilder } from 'discord.js';
import { handleException } from '../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

const data = new SlashCommandBuilder()
	.setName('ecaflip')
	.setDescription('Pile ou Face ?')
	.addStringOption((option) =>
		option
			.setName('option1')
			.setDescription('Option 1 ou question à répondre par Oui ou Non')
			.setRequired(true)
	);

for (let i = 2; i <= 10; i++) {
	data.addStringOption((option) =>
		option
			.setName(`option${i}`)
			.setDescription(
				`Option ${i}`
			)
			.setRequired(false)
	);
}

export default {
	data,
	async execute(interaction) {
		let options = []
		for(let i = 1; i <= 10; i++){
			const option = interaction.options.getString(`option${i}`);
			if(option != null) options.push(option);
		}
		const alea = Math.random();
		const optionNumber = Math.floor(alea * options.length);
		if (options.length == 1) {
			interaction.reply({
				content: alea >= 0.5 ? 'Oui' : 'Non',
			});
		} else {
			interaction.reply({
				content: options[optionNumber],
			});
		}
	},
};
