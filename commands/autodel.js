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
            // Initialisation de la base de données SQLite
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
            const messageLink = interaction.options.getString('lien');
            const days = interaction.options.getNumber('jours') || 7;

            const urlParts = parse(messageLink, true);
            const pathSegments = urlParts.pathname.split('/');

            if (pathSegments.length < 5) {
                throw new Error("Le lien de message fourni n'est pas valide.");
            }

            const guildId = pathSegments[2];
            const channelId = pathSegments[3];
            const messageId = pathSegments[4];

            const guild = await bot.guilds.fetch(guildId);
            const channel = await guild.channels.resolve(channelId);

            if (!channel || !channel.isText()) {
                throw new Error(
                    "Le canal spécifié n'est pas un canal de texte valide."
                );
            }

            const message = await channel.messages.fetch(messageId);
            dbAddDeleteMessage(message, days, db);

            // Planifier la suppression si l'expiration est dans le futur
            const delay = expireAt - Date.now();
            if (delay > 0) {
                setTimeout(async () => {
                    await message.delete();
                    log(`Message supprimé : ${messageLink}`);
                    db.run('DELETE FROM messages WHERE id = ?', [messageId]);
                }, delay);
            } else {
                await message.delete();
                log(`Message supprimé immédiatement : ${messageLink}`);
                db.run('DELETE FROM messages WHERE id = ?', [messageId]);
            }

            await interaction.reply({
                content: `Le message sera supprimé après ${days} jours.`,
                ephemeral: true,
            });
        } catch (err) {
            handleException(err)
        }
		
	},
};
