import { handleException, log } from '../../modules/utils.js';

const name = 'interactionCreate';
const once = false;
async function execute(interaction, bot) {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName != 'safe-place')
            log(
                `/${interaction.commandName} par ${interaction.member.displayName}`
            );
        // --- Statistiques commandes les plus utilisées ---
        try {
            const db = (await import('../../modules/db.js')).default;
            db.run(
                `INSERT INTO command_stats (command, count) VALUES (?, 1)
                ON CONFLICT(command) DO UPDATE SET count = count + 1`,
                [interaction.commandName]
            );
        } catch (err) {
            handleException(err);
        }
        const { commands } = bot;
        const { commandName } = interaction;
        const command = commands.get(commandName);
        if (!command) {
            return;
        }

        try {
            await command.execute(interaction, bot);
        } catch (err) {
            handleException(err);
            await interaction.reply({
                content: `Erreur lors de l'execution de la commande.`,
                flags: MessageFlags.Ephemeral,
            });
        }
    }
    if (interaction.isButton()) {
        const { customId } = interaction;
        
        // Gérer les boutons de rappel
        if (customId.startsWith('rappel|')) {
            try {
                await interaction.deferReply({ ephemeral: true });
                
                const [, dateString, messageEncoded] = customId.split('|');
                const message = decodeURIComponent(messageEncoded);
                const userId = interaction.user.id;
                const guildId = interaction.guild.id;
                const channelId = interaction.channel.id;
                
                // Parser la date
                const triggerAt = parseInt(dateString);
                
                // Vérifier que la date est toujours dans le futur
                if (triggerAt <= Date.now()) {
                    await interaction.editReply({
                        content: '❌ Ce rappel est déjà passé !',
                    });
                    return;
                }
                
                // Enregistrer le rappel en base de données
                const db = (await import('../../modules/db.js')).default;
                await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT INTO reminders (user_id, guild_id, channel_id, message, trigger_at, created_at) 
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [userId, guildId, channelId, message, triggerAt, Date.now()],
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });
                
                const { EmbedBuilder } = await import('discord.js');
                const formattedDate = `<t:${Math.floor(triggerAt / 1000)}:F>`;
                const relativeTime = `<t:${Math.floor(triggerAt / 1000)}:R>`;
                
                const embed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle('✅ Rappel créé !')
                    .setDescription(`Je te rappellerai ${relativeTime}`)
                    .addFields(
                        { name: '📝 Message', value: message, inline: false },
                        { name: '📅 Date', value: formattedDate, inline: false }
                    )
                    .setFooter({ text: 'Tu recevras un DM à l\'heure prévue' })
                    .setTimestamp();
                
                await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                handleException(error);
                await interaction.editReply({
                    content: '❌ Une erreur est survenue lors de la création du rappel.',
                }).catch(() => {});
            }
            return;
        }
        
        // Système de boutons classique
        const { buttons } = bot;
        const button = buttons.get(customId);
        if (!button) {
            return new Error('there is no code for this button');
        }
        try {
            await button.execute(interaction, bot);
        } catch (err) {
            handleException(err);
        }
    }
    if (interaction.isContextMenuCommand()) {
        const { commands } = bot;
        const { commandName } = interaction;
        const contextCommand = commands.get(commandName);
        if (!contextCommand) {
            return;
        }
        try {
            await contextCommand.execute(interaction, bot);
        } catch (err) {
            handleException(err);
        }
    }
}
export { name, once, execute };
