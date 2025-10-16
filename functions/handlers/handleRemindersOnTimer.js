// Handler pour vérifier et envoyer les rappels
import { EmbedBuilder } from 'discord.js';
import { handleException } from '../../modules/utils.js';
import db from '../../modules/db.js';

export default (bot) => {
    // Créer la table reminders si elle n'existe pas
    db.run(`
        CREATE TABLE IF NOT EXISTS reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            message TEXT NOT NULL,
            trigger_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            sent BOOLEAN DEFAULT 0,
            sent_at INTEGER
        )
    `, (err) => {
        if (err) {
            console.error('❌ Erreur création table reminders:', err);
        } else {
            console.log('✅ Table reminders prête');
        }
    });

    bot.handleRemindersOnTimer = async () => {
        try {
            const now = Date.now();

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
            handleException(error);
            console.error('❌ Erreur lors de la vérification des rappels:', error);
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
