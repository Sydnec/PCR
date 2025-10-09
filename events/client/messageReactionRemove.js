import { handleException } from '../../modules/utils.js';
import db from '../../modules/db.js';
import dotenv from 'dotenv';
dotenv.config();

const name = 'messageReactionRemove';
const once = false;
async function execute(reaction, user) {
    if (user.id === process.env.CLIENT_ID) return;
    try {
        // --- Statistiques réactions par utilisateur ---
        db.run(
            `UPDATE reaction_stats SET count = count - 1 WHERE user_id = ? AND count > 0`,
            [user.id]
        );
        // --- Statistiques réactions globales serveur ---
        db.run(
            `UPDATE reaction_stats SET count = count - 1 WHERE user_id = ? AND count > 0`,
            ['__global__']
        );
        // --- Statistiques réactions par message ---
        db.run(
            `UPDATE message_reactions SET count = count - 1 WHERE message_id = ? AND count > 0`,
            [reaction.message.id]
        );
        // --- Statistiques emoji le plus utilisé (par réaction) ---
        // Utiliser uniquement le nom pour normaliser les emojis (éviter les doublons avec IDs différents)
        const emoji = reaction.emoji.name;
        db.run(
            `UPDATE emoji_stats SET count = count - 1 WHERE user_id = ? AND emoji = ? AND count > 0`,
            [user.id, emoji]
        );
        db.run(
            `UPDATE emoji_stats SET count = count - 1 WHERE user_id = ? AND emoji = ? AND count > 0`,
            ['__global__', emoji]
        );

        // --- Si le message appartient à randomizabaise, décrémente le compteur
        db.get('SELECT message_id FROM randomizabaise_stats WHERE message_id = ?', [reaction.message.id], (err, row) => {
            if (err) return handleException(err);
            if (row) {
                db.run('UPDATE randomizabaise_stats SET reaction_count = reaction_count - 1 WHERE message_id = ? AND reaction_count > 0', [reaction.message.id]);
            }
        });

        // Gestion rôles (logique existante)
        if (reaction.message.id === process.env.ROLE_MESSAGE_ID) {
            const guildMember = await reaction.message.guild.members.cache.get(
                user.id
            );
            const matchingRoles =
                await reaction.message.guild.roles.cache.filter((role) =>
                    role.name.startsWith(reaction.emoji.name)
                );
            await guildMember.roles.remove(matchingRoles);
        }
    } catch (err) {
        handleException(err);
    }
}

export { name, once, execute };
