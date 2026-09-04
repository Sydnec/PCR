import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { handleException, dbAddDeleteMessage } from '../modules/utils.js';
import db from '../modules/db.js';
import {
	resolveMessageFromLink,
	scheduleMessageDeletion,
} from '../modules/message-expiry.js';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

// Le délai est borné : `jours` étant libre, une valeur énorme dépassait la
// limite de setTimeout et déclenchait la suppression IMMÉDIATEMENT, et une
// valeur négative produisait la même chose par un autre chemin.
const MIN_DAYS = 1;
const MAX_DAYS = 365;
const DEFAULT_DAYS = 7;

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
					`Nombre de jours avant de supprimer le message (1-${MAX_DAYS}, par défaut ${DEFAULT_DAYS})`
				)
				.setMinValue(MIN_DAYS)
				.setMaxValue(MAX_DAYS)
		),

	async execute(interaction, bot) {
		try {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });

			const messageLink = interaction.options.getString('lien');
			const requestedDays =
				interaction.options.getNumber('jours') ?? DEFAULT_DAYS;

			// setMinValue/setMaxValue sont appliqués par Discord, mais la borne
			// est revérifiée ici : c'est elle qui protège le minuteur.
			const days = Math.min(
				MAX_DAYS,
				Math.max(MIN_DAYS, Math.floor(requestedDays))
			);

			const message = await resolveMessageFromLink(
				bot ?? interaction.client,
				messageLink
			);
			if (!message) {
				await interaction.editReply({
					content:
						"❌ Lien invalide, ou message introuvable (le bot doit avoir accès au salon).",
				});
				return;
			}

			// Comparaison par identifiant : `message.author == interaction.user`
			// comparait deux références, et échouait dès que l'auteur n'était
			// pas la même instance en cache — la commande ne répondait alors rien.
			if (message.author.id !== interaction.user.id) {
				await interaction.editReply({
					content:
						'❌ Tu ne peux programmer la suppression que de tes propres messages.',
				});
				return;
			}

			const expireAt = message.createdTimestamp + days * 24 * 60 * 60 * 1000;
			dbAddDeleteMessage(message.id, message.url, expireAt, db);
			scheduleMessageDeletion(message, expireAt);

			const when = `<t:${Math.floor(expireAt / 1000)}:R>`;
			await interaction.editReply({
				content:
					expireAt <= Date.now()
						? `Le message a déjà dépassé ${days} jour(s) : il est supprimé immédiatement.`
						: `Le message sera supprimé ${when} (${days} jour(s) après sa publication).`,
			});
		} catch (err) {
			handleException(err);
			await interaction
				.editReply({
					content: '❌ Une erreur est survenue.',
				})
				.catch(() => {});
		}
	},
};
