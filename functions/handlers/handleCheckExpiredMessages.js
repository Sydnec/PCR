import { handleException, log } from '../../modules/utils.js';
import {
	resolveMessageFromLink,
	scheduleMessageDeletion,
} from '../../modules/message-expiry.js';

// Réarme au démarrage les suppressions programmées par /autodel.
//
// Les minuteurs vivent en mémoire : sans ce balayage, un redémarrage les perdait
// tous. Il lit la même base que /autodel (modules/db.js) — auparavant la
// commande écrivait dans un fichier ./messages.db séparé, que rien ne relisait.
export default (bot) => {
	bot.handleCheckExpiredMessages = async (db) => {
		db.all('SELECT id, link, expire_at FROM messages', async (err, rows) => {
			if (err) {
				handleException(
					'Erreur lors de la récupération des messages expirés :',
					err
				);
				return;
			}

			let rearmed = 0;
			for (const row of rows || []) {
				try {
					const message = await resolveMessageFromLink(bot, row.link);
					if (!message) {
						// Message ou salon disparu : la ligne ne sert plus à rien
						// et serait retentée à chaque démarrage.
						db.run('DELETE FROM messages WHERE id = ?', [row.id], (err) => {
							if (err) handleException('Nettoyage de la table messages :', err);
						});
						continue;
					}
					scheduleMessageDeletion(message, row.expire_at, row.link);
					rearmed++;
				} catch (err) {
					handleException(err);
				}
			}

			if (rearmed) log(`${rearmed} suppression(s) programmée(s) réarmée(s)`);
		});
	};
};
