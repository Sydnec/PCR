import { handleException, log } from '../../modules/utils.js';
import { parse } from 'url';

export default (bot) => {
	bot.handleCheckExpiredMessages = async (db) => {
		db.all('SELECT * FROM messages', async (err, rows) => {
			if (err) {
				console.error(
					'Erreur lors de la récupération des messages expirés :',
					err
				);
			} else {
				for (const row of rows) {
					const { id, link, expire_at } = row;
					try {
                        const urlParts = parse(link, true);
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
                            throw new Error("Le canal spécifié n'est pas un canal de texte valide.");
                        }

                        const message = await channel.messages.fetch(messageId);
                        const delay = expire_at - Date.now();
                        if (delay > 0) {
                            setTimeout(async () => {
                                await message.delete();
                                log(`Message supprimé : ${link}`);
                                db.run('DELETE FROM messages WHERE id = ?', [id]);
                            }, delay);
                        } else {
                            await message.delete();
                            log(`Message supprimé immédiatement : ${link}`);
                            db.run('DELETE FROM messages WHERE id = ?', [id]);
                        }
                    } catch (err) {
                        handleException(err);
                    }
				}
			}
		});
	};
};
