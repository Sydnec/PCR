import { SlashCommandBuilder } from 'discord.js';
import { handleException, log, error, isAdmin } from '../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

export default {
	data: new SlashCommandBuilder()
		.setName('purge')
		.setDescription('Supprime des messages (réservé aux administrateurs)')
		.addStringOption((option) =>
			option
				.setName('lien')
				.setDescription("Lien du message jusqu'auquel supprimer")
		)
		.addNumberOption((option) =>
			option.setName('nombre').setDescription('Nombre de messages à supprimer')
		),

	async execute(interaction, bot) {
		try {
			if (!isAdmin(interaction.member)) {
				if (
					!(
						interaction.options.getNumber('nombre') > 0 ||
						interaction.options.getString('lien') != null
					)
				) {
					await interaction.reply({
						content: 'Veuillez entrer un paramètre',
						ephemeral: true,
					});
					return;
				}
				await interaction.reply({
					content: "Je m'en occupe chef !",
					ephemeral: true,
				});
				let numberMessages = interaction.options.getNumber('nombre');
				if (numberMessages > 0) {
					async function clear() {
						let fetched;
						fetched = await interaction.channel.messages.fetch({
							limit: numberMessages,
						});
						interaction.channel.bulkDelete(fetched);
					}
					clear();
				} else {
					const link = interaction.options.getString('lien');
					let linkedMessage = await interaction.channel.messages.fetch({
						limit: 1,
					});
					while (linkedMessage.last().url != link) {
						await linkedMessage.last().delete();
						linkedMessage = await interaction.channel.messages.fetch({
							limit: 1,
						});
					}
				}
			}
		} catch (e) {
			handleException(e);
		}
	},
};
