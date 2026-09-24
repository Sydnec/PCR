import { log } from '../../modules/utils.js';
import { checkAndAnnounceNewRelease } from '../../modules/changelog-notifier.js';
import db from '../../modules/db.js';
import { rehydratePokemon } from '../../modules/pokemon/spawn.js';
import { sweepSafari } from '../../modules/pokemon/safari.js';
import { startWebServer } from '../../modules/web/server.js';
import { setPseudoClient } from '../../modules/pseudo.js';
import { repairCharms } from '../../modules/pokemon/charms.js';

const name = 'clientReady';
const once = true;
async function execute(bot) {
    // Les journaux nomment les membres par leur pseudo : le client leur sert à
    // le retrouver.
    setPseudoClient(bot);

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
                } catch {
                    // Serveur injoignable : on passe au suivant.
                }
            }
            if (!isStillInVocal) {
                // On retire la date d'arrivée en vocal (join_time)
                db.run('UPDATE voice_time SET join_time = NULL WHERE user_id = ?', [userId]);
            }
        }
    });


    bot.handleUpdateRoleMessage();
    bot.handleCheckExpiredMessages(db);

    // Répare l'état Pokémon après un arrêt brutal : verrou de spawn resté
    // verrouillé, ou spawn ACTIVE sans message, qui bloquerait définitivement
    // toutes les apparitions à cause de l'index unique partiel.
    rehydratePokemon(bot);

    // Même chose côté parc safari : une session ou un parc laissés ouverts par
    // un arrêt brutal bloqueraient leurs index uniques respectifs.
    sweepSafari(bot);

    // Les Charmes Chroma : ceux qu'un Pokédex déjà complet n'a pas encore
    // donnés, et les rôles de leurs porteurs, remis d'accord avec l'inventaire.
    repairCharms(bot);

    // L'API de l'interface web, si WEB_PORT est défini. Elle démarre une fois
    // le bot prêt : c'est lui qui vérifie qu'un visiteur est membre du serveur.
    startWebServer(bot);

    // Vérifier et annoncer les nouvelles releases (après un délai pour s'assurer que le bot est prêt)
    setTimeout(async () => {
        await checkAndAnnounceNewRelease(bot);
    }, 5000);

    log(`Bonjour, je suis ${bot.user.displayName} et j'ai bien démarré !`);
}

export { name, once, execute };
