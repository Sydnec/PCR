import { handleException } from '../../modules/utils.js';
import db from '../../modules/db.js';
import dotenv from 'dotenv';
dotenv.config();

const name = 'messageReactionAdd';
const once = false;
async function execute(reaction, user) {
    try {
        // Avec les partials activés (cf. index.js), Discord.js émet désormais
        // l'événement pour les messages hors cache — c'est ce qui manquait pour
        // que le message des rôles, forcément ancien, réagisse après un
        // redémarrage. La contrepartie : il faut compléter l'objet partiel.
        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();
        if (user.partial) await user.fetch();
    } catch (err) {
        // Message supprimé entre-temps : rien à comptabiliser.
        return;
    }

    // `user.bot` couvre tous les bots, pas seulement celui-ci : l'ancien test
    // sur CLIENT_ID laissait les autres bots polluer les statistiques.
    if (user.bot) return;
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
            // `members.cache.get` renvoyait undefined pour un membre hors cache,
            // et l'accès à .roles levait alors une TypeError.
            const guildMember = await guild?.members.fetch(user.id).catch(() => null);
            if (!guildMember) return;
            const matchingRoles = guild.roles.cache.filter((role) =>
                role.name.startsWith(reaction.emoji.name)
            );
            if (matchingRoles.size) await guildMember.roles.add(matchingRoles);
        }
    } catch (err) {
        handleException(err);
    }
}

export { name, once, execute };
