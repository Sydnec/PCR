import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { handleException, log, dbAddDeleteMessage } from '../modules/utils.js';
// Base partagée (botdata-<année>.db) et non plus un fichier messages.db à part :
// c'est celle que handleCheckExpiredMessages relit au démarrage. Les
// suppressions programmées survivent donc à un redémarrage du bot, ce qui
// n'était pas le cas tant que les deux bases coexistaient.
import db from '../modules/db.js';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

const timeouts = new Map();

// Nombre de jours maximum : au-delà, le setTimeout dépasse la limite de
// setTimeout (~24,8 jours) et se déclencherait immédiatement.
const MAX_DAYS = 24;

export default {
	data: new SlashCommandBuilder()
		.setName('autodel')
		.setDescription(
			'Supprimera automatiquement votre message avec X jours.'
		)
		.addStringOption((option) =>
			option
				.setName('lien')
				.setDescription('Lien du message à supprimer')
				.setRequired(true)
		)
		.addNumberOption((option) =>
			option
				.setName('jours')
				.setDescription(
					`Nombre de jours avant de supprimer le message (défaut 7, max ${MAX_DAYS})`
				)
				.setMinValue(1)
				.setMaxValue(MAX_DAYS)
		),

	async execute(interaction, bot) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			const messageLink = interaction.options.getString('lien');
			const days = Math.min(
				interaction.options.getNumber('jours') || 7,
				MAX_DAYS
			);

			const target = parseMessageLink(messageLink);
			if (!target || target.guildId !== interaction.guildId) {
				await interaction.editReply({
					content:
						"❌ Lien invalide : donne le lien d'un message de ce serveur.",
				});
				return;
			}

			const channel = await interaction.guild.channels
				.fetch(target.channelId)
				.catch(() => null);
			const message = channel
				? await channel.messages.fetch(target.messageId).catch(() => null)
				: null;

			if (!message) {
				await interaction.editReply({
					content: '❌ Message introuvable.',
				});
				return;
			}

			// Comparaison d'identifiants : `message.author == interaction.user`
			// comparait deux objets et ne fonctionnait que par coïncidence de
			// cache — la commande restait silencieuse le reste du temps.
			if (message.author.id !== interaction.user.id) {
				await interaction.editReply({
					content: '❌ Tu ne peux programmer que la suppression de tes propres messages.',
				});
				return;
			}

			const messageId = message.id;
			const createdAt = message.createdTimestamp; // Date de création du message en millisecondes
			const expireAt = createdAt + days * 24 * 60 * 60 * 1000; // Convertir les jours en millisecondes
			dbAddDeleteMessage(messageId, message.url, expireAt, db);

			// Clear existing timeout if it exists
			if (timeouts.has(messageId)) {
				clearTimeout(timeouts.get(messageId));
				timeouts.delete(messageId);
			}

			const deleteNow = async () => {
				await message.delete().catch(handleException);
				log(`Message supprimé : ${message.url}`);
				db.run('DELETE FROM messages WHERE id = ?', [messageId]);
				timeouts.delete(messageId);
			};

			// Planifier la suppression si l'expiration est dans le futur
			const delay = expireAt - Date.now();
			if (delay > 0) {
				timeouts.set(messageId, setTimeout(deleteNow, delay));
				await interaction.editReply({
					content: `Le message sera supprimé <t:${Math.floor(
						expireAt / 1000
					)}:R>.`,
				});
			} else {
				await deleteNow();
				await interaction.editReply({
					content: 'Le message a été supprimé immédiatement.',
				});
			}
		} catch (err) {
			handleException(err);
			await interaction
				.editReply({ content: '❌ Une erreur est survenue.' })
				.catch(() => {});
		}
	},
};

// Extrait guilde/salon/message d'un lien Discord, ou null si ce n'en est pas un.
function parseMessageLink(link) {
	const match = String(link).match(
		/^https?:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)\/?$/
	);
	if (!match) return null;
	return { guildId: match[1], channelId: match[2], messageId: match[3] };
}
