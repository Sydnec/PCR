import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
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
            await interaction.deferReply({ ephemeral: true });

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
                ephemeral: true,
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
            ephemeral: true,
        });
        return;
    }

    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`📋 Tes rappels (${reminders.length})`)
        .setDescription('Voici la liste de tes rappels actifs')
        .setTimestamp();

    reminders.forEach((reminder, index) => {
        const relativeTime = `<t:${Math.floor(reminder.trigger_at / 1000)}:R>`;
        const fullDate = `<t:${Math.floor(reminder.trigger_at / 1000)}:F>`;
        
        embed.addFields({
            name: `🔔 Rappel #${reminder.id}`,
            value: 
                `**Message:** ${reminder.message}\n` +
                `**Quand:** ${relativeTime}\n` +
                `**Date:** ${fullDate}`,
            inline: false
        });
    });

    embed.setFooter({ text: 'Utilise /mesrappels supprimer <id> pour supprimer un rappel' });

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
            ephemeral: true,
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
