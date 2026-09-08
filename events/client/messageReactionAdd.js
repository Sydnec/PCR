import { handleException, rolesForReactionEmoji } from '../../modules/utils.js';
import db from '../../modules/db.js';
import dotenv from 'dotenv';
dotenv.config();

const name = 'messageReactionAdd';
const once = false;
async function execute(reaction, user) {
    if (user.id === process.env.CLIENT_ID) return;
    try {
        // --- Statistiques réactions par utilisateur ---
        db.run(
            `INSERT INTO reaction_stats (user_id, count) VALUES (?, 1)
            ON CONFLICT(user_id) DO UPDATE SET count = count + 1`,
            [user.id]
        );
        // --- Statistiques réactions globales serveur ---
        db.run(
            `INSERT INTO reaction_stats (user_id, count) VALUES (?, 1)
            ON CONFLICT(user_id) DO UPDATE SET count = count + 1`,
            ['__global__']
        );
        // --- Statistiques réactions par message ---
        db.run(
            `INSERT INTO message_reactions (message_id, count) VALUES (?, 1)
            ON CONFLICT(message_id) DO UPDATE SET count = count + 1`,
            [reaction.message.id]
        );
        // --- Statistiques emoji le plus utilisé (par réaction) ---
        // Utiliser uniquement le nom pour normaliser les emojis (éviter les doublons avec IDs différents)
        const emoji = reaction.emoji.name;
        db.run(
            `INSERT INTO emoji_stats (user_id, emoji, count) VALUES (?, ?, 1)
            ON CONFLICT(user_id, emoji) DO UPDATE SET count = count + 1`,
            [user.id, emoji]
        );
        db.run(
            `INSERT INTO emoji_stats (user_id, emoji, count) VALUES (?, ?, 1)
            ON CONFLICT(user_id, emoji) DO UPDATE SET count = count + 1`,
            ['__global__', emoji]
        );

        // --- Si le message appartient à randomizabaise, incrémente le compteur
        db.get('SELECT message_id FROM randomizabaise_stats WHERE message_id = ?', [reaction.message.id], (err, row) => {
            if (err) return handleException(err);
            if (row) {
                db.run('UPDATE randomizabaise_stats SET reaction_count = reaction_count + 1 WHERE message_id = ?', [reaction.message.id]);
            }
        });

        // Gestion rôles (logique existante)
        if (reaction.message.id === process.env.ROLE_MESSAGE_ID) {
            const guild = reaction.message.guild;
            // fetch plutôt que cache : un membre absent du cache faisait lever
            // le handler au lieu d'attribuer le rôle.
            const guildMember = await guild.members.fetch(user.id).catch(() => null);
            // Seuls les rôles réellement proposés par le message sont
            // attribuables : voir rolesForReactionEmoji().
            const matchingRoles = rolesForReactionEmoji(guild, reaction.emoji.name);
            if (guildMember && matchingRoles.length) {
                await guildMember.roles.add(matchingRoles);
            }
        }
    } catch (err) {
        handleException(err);
    }
}

export { name, once, execute };
