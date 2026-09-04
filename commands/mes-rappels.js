import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { handleException } from '../modules/utils.js';
import db from '../modules/db.js';

export default {
    data: new SlashCommandBuilder()
        .setName('mesrappels')
        .setDescription('Voir et gérer tes rappels')
        .addSubcommand(subcommand =>
            subcommand
                .setName('liste')
                .setDescription('Voir la liste de tes rappels actifs')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('supprimer')
                .setDescription('Supprimer un rappel')
                .addIntegerOption(option =>
                    option
                        .setName('id')
                        .setDescription('ID du rappel à supprimer')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const subcommand = interaction.options.getSubcommand();
            const userId = interaction.user.id;

            if (subcommand === 'liste') {
                await listReminders(interaction, userId);
            } else if (subcommand === 'supprimer') {
                const reminderId = interaction.options.getInteger('id');
                await deleteReminder(interaction, userId, reminderId);
            }

        } catch (error) {
            handleException(error);
            await interaction.editReply({
                content: '❌ Une erreur est survenue.',
            }).catch(() => {});
        }
    },
};

async function listReminders(interaction, userId) {
    const reminders = await new Promise((resolve, reject) => {
        db.all(
            'SELECT * FROM reminders WHERE user_id = ? AND sent = 0 ORDER BY trigger_at ASC',
            [userId],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            }
        );
    });

    if (reminders.length === 0) {
        await interaction.editReply({
            content: '📭 Tu n\'as aucun rappel actif.',
        });
        return;
    }

    // Un embed Discord accepte au plus 25 champs : au-delà, l'API rejetait la
    // requête et l'utilisateur ne voyait aucun rappel.
    const MAX_FIELDS = 25;
    const shown = reminders.slice(0, MAX_FIELDS);
    const hidden = reminders.length - shown.length;

    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`📋 Tes rappels (${reminders.length})`)
        .setDescription('Voici la liste de tes rappels actifs')
        .setTimestamp();

    shown.forEach((reminder) => {
        const relativeTime = `<t:${Math.floor(reminder.trigger_at / 1000)}:R>`;
        const fullDate = `<t:${Math.floor(reminder.trigger_at / 1000)}:F>`;

        // Un champ est plafonné à 1024 caractères ; le message d'un rappel peut
        // en faire 500, les libellés et dates font le reste.
        const message =
            reminder.message.length > 800
                ? reminder.message.slice(0, 797) + '...'
                : reminder.message;

        embed.addFields({
            name: `🔔 Rappel #${reminder.id}`,
            value:
                `**Message:** ${message}\n` +
                `**Quand:** ${relativeTime}\n` +
                `**Date:** ${fullDate}`,
            inline: false
        });
    });

    embed.setFooter({
        text: hidden > 0
            ? `${hidden} rappel(s) supplémentaire(s) non affiché(s) · /mesrappels supprimer <id>`
            : 'Utilise /mesrappels supprimer <id> pour supprimer un rappel'
    });

    await interaction.editReply({ embeds: [embed] });
}

async function deleteReminder(interaction, userId, reminderId) {
    // Vérifier que le rappel appartient bien à l'utilisateur
    const reminder = await new Promise((resolve, reject) => {
        db.get(
            'SELECT * FROM reminders WHERE id = ? AND user_id = ? AND sent = 0',
            [reminderId, userId],
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            }
        );
    });

    if (!reminder) {
        await interaction.editReply({
            content: '❌ Ce rappel n\'existe pas ou ne t\'appartient pas.',
        });
        return;
    }

    // Supprimer le rappel
    await new Promise((resolve, reject) => {
        db.run(
            'DELETE FROM reminders WHERE id = ?',
            [reminderId],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });

    const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('🗑️ Rappel supprimé')
        .setDescription(`Le rappel #${reminderId} a été supprimé avec succès.`)
        .addFields({
            name: '📝 Message',
            value: reminder.message,
            inline: false
        })
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}
