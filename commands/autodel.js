import { SlashCommandBuilder } from 'discord.js';
import { handleException, log, dbAddDeleteMessage } from '../modules/utils.js';
import sqlite3 from 'sqlite3';
import { parse } from 'url';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

// Initialisation de la base de données SQLite en dehors de la fonction execute
const db = new sqlite3.Database('./messages.db', (err) => {
    if (err) {
        console.error('Erreur lors de l\'ouverture de la base de données :', err);
    } else {
        db.run('CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, link TEXT, expire_at INTEGER)', (err) => {
            if (err) {
                console.error('Erreur lors de la création de la table :', err);
            }
        });
    }
});

const timeouts = new Map();

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
					'Nombre de jours avant de supprimer le message (par défaut 7)'
				)
		),

	async execute(interaction, bot) {
        try {
            const messageLink = interaction.options.getString('lien');
            const days = interaction.options.getNumber('jours') || 7;

            const urlParts = parse(messageLink, true);
            const pathSegments = urlParts.pathname.split('/');

            if (pathSegments.length < 5) {
                console.log("non")
                throw new Error("Le lien de message fourni n'est pas valide.");
            }

            const guildId = pathSegments[2];
            const channelId = pathSegments[3];
            const messageId = pathSegments[4];

            const guild = await bot.guilds.fetch(guildId);
            const channel = await guild.channels.resolve(channelId);

            if (!channel) {
                console.log("non")
                throw new Error(
                    "Le canal spécifié n'est pas un canal de texte valide."
                );
            }

            const message = await channel.messages.fetch(messageId);
            if (message.author == interaction.user) {
                const messageLink = message.url;
                const messageId = message.id;
                const createdAt = message.createdTimestamp; // Date de création du message en millisecondes
                const expireAt = createdAt + days /** 24 * 60*/ * 60 * 1000; // Convertir les jours en millisecondes
                dbAddDeleteMessage(messageId, messageLink, expireAt, db);

                // Clear existing timeout if it exists
                if (timeouts.has(messageId)) {
                    clearTimeout(timeouts.get(messageId));
                    timeouts.delete(messageId);
                }

                // Planifier la suppression si l'expiration est dans le futur
                const delay = expireAt - Date.now();
                if (delay > 0) {
                    const timeout = setTimeout(async () => {
                        await message.delete();
                        log(`Message supprimé : ${messageLink}`);
                        db.run('DELETE FROM messages WHERE id = ?', [messageId]);
                        timeouts.delete(messageId);
                    }, delay);

                    timeouts.set(messageId, timeout);
                } else {
                    await message.delete();
                    log(`Message supprimé immédiatement : ${messageLink}`);
                    db.run('DELETE FROM messages WHERE id = ?', [messageId]);
                }

                await interaction.reply({
                    content: `Le message sera supprimé après ${days} jours.`,
                    ephemeral: true,
                });
            }
        } catch (err) {
            handleException(err)
        }
		
	},
};
