// Handler pour vérifier et envoyer les rappels
import { EmbedBuilder } from 'discord.js';
import { handleException } from '../../modules/utils.js';
import db from '../../modules/db.js';

// La table reminders est créée dans modules/db.js, avec toutes les autres.
export default (bot) => {
    // Le cron déclenche chaque minute : si un envoi traîne (DM lents, plusieurs
    // rappels), la passe suivante relisait les mêmes lignes non encore marquées
    // et envoyait le rappel en double.
    let running = false;

    bot.handleRemindersOnTimer = async () => {
        if (running) return;
        running = true;
        try {
            const now = Date.now();

            // Nettoyer les rappels envoyés il y a plus de 7 jours
            await cleanOldReminders();

            // Récupérer tous les rappels qui doivent être envoyés
            const reminders = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT * FROM reminders WHERE trigger_at <= ? AND sent = 0`,
                    [now],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            if (reminders.length === 0) {
                return;
            }

            console.log(`⏰ ${reminders.length} rappel(s) à envoyer...`);
            
            // Log des rappels à traiter
            reminders.forEach(r => {
                console.log(`  - Rappel #${r.id} pour user ${r.user_id}: "${r.message.substring(0, 30)}..."`);
            });

            // Envoyer chaque rappel
            for (const reminder of reminders) {
                try {
                    // Récupérer l'utilisateur
                    const user = await bot.users.fetch(reminder.user_id).catch(() => null);
                    if (!user) {
                        console.warn(`⚠️ Utilisateur ${reminder.user_id} introuvable pour rappel #${reminder.id}`);
                        await markReminderAsSent(reminder.id);
                        continue;
                    }

                    // Récupérer le serveur et le channel (pour le lien)
                    const guild = bot.guilds.cache.get(reminder.guild_id);
                    const channel = guild?.channels.cache.get(reminder.channel_id);

                    // Créer l'embed du rappel
                    const embed = new EmbedBuilder()
                        .setColor('#FFD700')
                        .setTitle('⏰ Rappel !')
                        .setDescription(reminder.message)
                        .setTimestamp(reminder.created_at)
                        .setFooter({ text: `Créé le ${new Date(reminder.created_at).toLocaleString('fr-FR')}` });

                    // Ajouter un lien vers le channel si disponible
                    if (channel) {
                        embed.addFields({
                            name: '📍 Contexte',
                            value: `Créé dans ${channel.toString()} sur **${guild.name}**`,
                            inline: false
                        });
                    }

                    // Envoyer le DM
                    await user.send({ embeds: [embed] });
                    console.log(`✅ Rappel #${reminder.id} envoyé à ${user.tag}`);

                    // Marquer comme envoyé
                    await markReminderAsSent(reminder.id);

                } catch (error) {
                    console.error(`❌ Erreur envoi rappel #${reminder.id}:`, error.message);
                    // Marquer comme envoyé quand même pour éviter les boucles
                    await markReminderAsSent(reminder.id);
                }
            }

        } catch (error) {
            handleException('Erreur lors de la vérification des rappels :', error);
        } finally {
            running = false;
        }
    };
};

// Marquer un rappel comme envoyé
function markReminderAsSent(reminderId) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE reminders SET sent = 1, sent_at = ? WHERE id = ?`,
            [Date.now(), reminderId],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

// Nettoyer les rappels envoyés il y a plus de 7 jours
function cleanOldReminders() {
    return new Promise((resolve, reject) => {
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        db.run(
            `DELETE FROM reminders WHERE sent = 1 AND sent_at < ?`,
            [sevenDaysAgo],
            function(err) {
                if (err) {
                    reject(err);
                } else if (this.changes > 0) {
                    console.log(`🗑️  ${this.changes} rappel(s) ancien(s) supprimé(s)`);
                    resolve(this.changes);
                } else {
                    resolve(0);
                }
            }
        );
    });
}
