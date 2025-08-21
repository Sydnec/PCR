import { log, updateThreadList } from '../../modules/utils.js';
import { checkAndAnnounceNewRelease } from '../../modules/changelog-notifier.js';
import sqlite3 from "sqlite3";

const name = 'clientReady';
const once = true;
async function execute(bot) {
    // Initialisation de la base de données SQLite pour autodel
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
    
    bot.handleUpdateRoleMessage();
    bot.handleCheckExpiredMessages(db);
    
    // Vérifier et annoncer les nouvelles releases (après un délai pour s'assurer que le bot est prêt)
    setTimeout(async () => {
        await checkAndAnnounceNewRelease(bot);
    }, 5000);
    
    log(`Bonjour, je suis ${bot.user.tag} et j'ai bien démarré !`);
}

export { name, once, execute };
