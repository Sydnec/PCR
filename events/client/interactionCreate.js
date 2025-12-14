import { handleException, log } from '../../modules/utils.js';
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } from 'discord.js';
import pointsDb from '../../modules/points-db.js';

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

        // Gérer les boutons de pari
        if (customId.startsWith('bet_join|')) {
            const [, betId, optionIndex] = customId.split('|');
            
            const modal = new ModalBuilder()
                .setCustomId(`bet_modal|${betId}|${optionIndex}`)
                .setTitle('Miser sur ce pari');

            const amountInput = new TextInputBuilder()
                .setCustomId('amount')
                .setLabel("Montant de la mise")
                .setStyle(TextInputStyle.Short)
                .setPlaceholder("Ex: 100")
                .setRequired(true);

            const firstActionRow = new ActionRowBuilder().addComponents(amountInput);
            modal.addComponents(firstActionRow);

            await interaction.showModal(modal);
            return;
        }
        
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

    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('bet_modal|')) {
            const [, betId, optionIndex] = interaction.customId.split('|');
            const amount = parseInt(interaction.fields.getTextInputValue('amount'));
            const userId = interaction.user.id;

            if (isNaN(amount) || amount <= 0) {
                return interaction.reply({ content: "La mise doit être un nombre positif.", flags: MessageFlags.Ephemeral });
            }

            // Check balance
            pointsDb.get("SELECT balance FROM points WHERE user_id = ?", [userId], (err, row) => {
                if (err) {
                    handleException(err);
                    return interaction.reply({ content: "Erreur base de données.", flags: MessageFlags.Ephemeral });
                }
                const balance = row ? row.balance : 0;

                if (balance < amount) {
                    return interaction.reply({
                        content: `Vous n'avez pas assez de points. Solde: ${balance}`,
                        flags: MessageFlags.Ephemeral,
                    });
                }

                // Check bet status and option validity
                pointsDb.get("SELECT status FROM bets WHERE id = ?", [betId], (err, bet) => {
                    if (err || !bet) return interaction.reply({ content: "Pari introuvable.", flags: MessageFlags.Ephemeral });
                    if (bet.status !== "OPEN") return interaction.reply({ content: "Ce pari est fermé.", flags: MessageFlags.Ephemeral });

                    pointsDb.get("SELECT id FROM bet_options WHERE bet_id = ? AND option_index = ?", [betId, optionIndex], (err, opt) => {
                        if (err || !opt) return interaction.reply({ content: "Option invalide.", flags: MessageFlags.Ephemeral });

                        // Deduct points and add participation
                        pointsDb.serialize(() => {
                            pointsDb.run("UPDATE points SET balance = balance - ? WHERE user_id = ?", [amount, userId]);
                            pointsDb.run(
                                "INSERT INTO bet_participations (bet_id, user_id, option_index, amount) VALUES (?, ?, ?, ?)",
                                [betId, userId, optionIndex, amount],
                                (err) => {
                                    if (err) {
                                        // Refund if insert fails (e.g. already bet)
                                        pointsDb.run("UPDATE points SET balance = balance + ? WHERE user_id = ?", [amount, userId]);
                                        return interaction.reply({ content: "Vous avez déjà parié sur ce pari ou une erreur est survenue.", flags: MessageFlags.Ephemeral });
                                    }
                                    interaction.reply({ content: `Vous avez misé **${amount}** points sur l'option **${optionIndex}** du pari #${betId}.`, flags: MessageFlags.Ephemeral });
                                }
                            );
                        });
                    });
                });
            });
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
