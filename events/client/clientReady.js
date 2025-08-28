import { log, updateThreadList } from '../../modules/utils.js';
import { checkAndAnnounceNewRelease } from '../../modules/changelog-notifier.js';
import db from '../../modules/db.js';

const name = 'clientReady';
const once = true;
async function execute(bot) {
    // Nettoyage des entrées vocales orphelines en BDD
    db.all('SELECT user_id FROM voice_time', async (err, rows) => {
        if (err) {
            console.error('Erreur lors de la lecture de la table voice_time :', err);
            return;
        }
        for (const row of rows) {
            const userId = row.user_id;
            let isStillInVocal = false;
            for (const guild of bot.guilds.cache.values()) {
                try {
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (member && member.voice && member.voice.channelId) {
                        isStillInVocal = true;
                        break;
                    }
                } catch {}
            }
            if (!isStillInVocal) {
                // On retire la date d'arrivée en vocal (join_time)
                db.run('UPDATE voice_time SET join_time = NULL WHERE user_id = ?', [userId]);
            }
        }
    });

    bot.handleUpdateRoleMessage();
    bot.handleCheckExpiredMessages(db);

    // Vérifier et annoncer les nouvelles releases (après un délai pour s'assurer que le bot est prêt)
    setTimeout(async () => {
        await checkAndAnnounceNewRelease(bot);
    }, 5000);

    log(`Bonjour, je suis ${bot.user.tag} et j'ai bien démarré !`);
}

export { name, once, execute };
