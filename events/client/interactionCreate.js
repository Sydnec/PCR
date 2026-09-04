import { handleException, log } from '../../modules/utils.js';
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import pointsDb from '../../modules/points-db.js';
import { addPoints, getBalance, spendPoints } from '../../modules/economy.js';
import { handlePokemonButton } from '../../modules/pokemon/interactions.js';

const name = 'interactionCreate';
const once = false;

// Plafond de mise. Sans lui, `parseInt` accepte des valeurs assez grandes pour
// faire perdre en précision les calculs de répartition des gains.
const MAX_BET_AMOUNT = 1_000_000_000;
async function execute(interaction, bot) {
    if (interaction.isChatInputCommand()) {
        // interaction.member est null en message privé : l'ancien accès direct
        // à displayName y faisait échouer toute la commande.
        if (interaction.commandName != 'safe-place')
            log(
                `/${interaction.commandName} par ${interaction.member?.displayName ?? interaction.user.tag}`
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
            // La commande a pu déjà répondre ou différer : `reply` lèverait
            // alors une seconde erreur, non gérée cette fois.
            const respond = interaction.replied || interaction.deferred
                ? interaction.followUp.bind(interaction)
                : interaction.reply.bind(interaction);
            await respond({
                content: `Erreur lors de l'execution de la commande.`,
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }
    }
    // Autocomplétion : branche générique, utilisable par n'importe quelle
    // commande exportant une méthode `autocomplete`.
    if (interaction.isAutocomplete()) {
        const command = bot.commands.get(interaction.commandName);
        if (!command || typeof command.autocomplete !== 'function') return;
        try {
            await command.autocomplete(interaction, bot);
        } catch (err) {
            handleException(err);
        }
        return;
    }
    if (interaction.isButton()) {
        const { customId } = interaction;

        // Système Pokémon : toute la logique vit dans modules/pokemon/.
        if (customId.startsWith('poke_')) {
            try {
                await handlePokemonButton(interaction, bot);
            } catch (err) {
                handleException(err);
            }
            return;
        }

        // Gérer les boutons de pari ("Estimation")
        if (customId.startsWith('bet_estimate_join|')) {
            const [, betId] = customId.split('|');
            const userId = interaction.user.id;

            pointsDb.get("SELECT creator_id FROM bets WHERE id = ?", [betId], (err, bet) => {
                if (err || !bet) return interaction.reply({ content: "Pari introuvable.", flags: MessageFlags.Ephemeral });
                if (bet.creator_id === userId) {
                    return interaction.reply({ content: "❌ Vous ne pouvez pas parier sur votre propre estimation !", flags: MessageFlags.Ephemeral });
                }

                pointsDb.get("SELECT balance FROM points WHERE user_id = ?", [userId], (err, row) => {
                    const balance = row ? row.balance : 0;
                    
                    pointsDb.get("SELECT amount, prediction_value FROM bet_participations WHERE bet_id = ? AND user_id = ?", [betId, userId], (err, participation) => {
                        
                        const modal = new ModalBuilder()
                            .setCustomId(`bet_estimate_modal|${betId}`)
                            .setTitle(participation ? `Modifier votre estimation` : `Proposer une estimation`);

                        const predictionInput = new TextInputBuilder()
                            .setCustomId('prediction')
                            .setLabel("Votre estimation")
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setValue(participation ? participation.prediction_value.toString() : "");

                        const amountInput = new TextInputBuilder()
                            .setCustomId('amount')
                            .setLabel("Montant de la mise")
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder(`Solde: ${balance}`)
                            .setRequired(true)
                            .setValue(participation ? participation.amount.toString() : "");

                        modal.addComponents(
                            new ActionRowBuilder().addComponents(predictionInput),
                            new ActionRowBuilder().addComponents(amountInput)
                        );

                        interaction.showModal(modal);
                    });
                });
            });
            return;
        }

        // Gérer les boutons de pari
        if (customId.startsWith('bet_join|')) {
            const [, betId, optionIndex] = customId.split('|');
            const userId = interaction.user.id;
            
            // Check if user is creator
            pointsDb.get("SELECT creator_id FROM bets WHERE id = ?", [betId], (err, bet) => {
                if (err || !bet) return interaction.reply({ content: "Pari introuvable.", flags: MessageFlags.Ephemeral });
                if (bet.creator_id === userId) {
                    return interaction.reply({ content: "❌ Vous ne pouvez pas parier sur votre propre pari !", flags: MessageFlags.Ephemeral });
                }

                pointsDb.get("SELECT balance FROM points WHERE user_id = ?", [userId], async (err, row) => {
                    const balance = row ? row.balance : 0;

                    // Vérifier si l'utilisateur a déjà parié
                    pointsDb.get("SELECT option_index, amount FROM bet_participations WHERE bet_id = ? AND user_id = ?", [betId, userId], async (err, participation) => {
                        if (err) {
                            handleException(err);
                            return interaction.reply({ content: "Erreur lors de la vérification de votre participation.", flags: MessageFlags.Ephemeral });
                        }

                        if (participation) {
                            if (participation.option_index.toString() !== optionIndex) {
                                // L'utilisateur a parié sur une autre option
                                pointsDb.get("SELECT label FROM bet_options WHERE bet_id = ? AND option_index = ?", [betId, participation.option_index], (err, opt) => {
                                    const optionLabel = opt ? opt.label : `Option ${participation.option_index}`;
                                    return interaction.reply({ 
                                        content: `Vous avez déjà parié sur **${optionLabel}**. Vous ne pouvez pas changer d'option.`, 
                                        flags: MessageFlags.Ephemeral 
                                    });
                                });
                                return;
                            }
                            // L'utilisateur a parié sur la même option, on lui permet d'ajouter des points
                        }

                        const modal = new ModalBuilder()
                            .setCustomId(`bet_modal|${betId}|${optionIndex}`)
                            .setTitle(participation ? `Ajouter à la mise (Solde: ${balance})` : `Miser (Solde: ${balance})`);

                        const amountInput = new TextInputBuilder()
                            .setCustomId('amount')
                            .setLabel(participation ? "Montant à ajouter" : "Montant de la mise")
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder(`Max: ${balance}`)
                            .setRequired(true);

                        const firstActionRow = new ActionRowBuilder().addComponents(amountInput);
                        modal.addComponents(firstActionRow);

                        await interaction.showModal(modal);
                    });
                });
            });
            return;
        }

        // Gérer le bouton de résolution de pari
        if (customId.startsWith('bet_resolve_modal|')) {
            const [, betId] = customId.split('|');
            const messageId = interaction.message.id;
            
            // Vérifier si l'utilisateur est le créateur du pari
            pointsDb.get("SELECT * FROM bets WHERE id = ?", [betId], async (err, bet) => {
                if (err || !bet) return interaction.reply({ content: "Pari introuvable.", flags: MessageFlags.Ephemeral });
                if (bet.creator_id !== interaction.user.id) return interaction.reply({ content: "Seul le créateur peut terminer le pari.", flags: MessageFlags.Ephemeral });
                
                // Autoriser la gestion si OPEN ou LOCKED
                if (bet.status !== "OPEN" && bet.status !== "LOCKED") return interaction.reply({ content: "Ce pari est déjà terminé.", flags: MessageFlags.Ephemeral });

                if (bet.is_estimation) {
                    const modal = new ModalBuilder()
                        .setCustomId(`bet_estimate_resolve_submit|${betId}|${messageId}`)
                        .setTitle("Résultat de l'estimation");

                    const resultInput = new TextInputBuilder()
                        .setCustomId('result')
                        .setLabel("La bonne réponse")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true);

                     modal.addComponents(new ActionRowBuilder().addComponents(resultInput));
                     await interaction.showModal(modal);
                     return;
                }

                // Récupérer les options du pari
                pointsDb.all("SELECT option_index, label FROM bet_options WHERE bet_id = ? ORDER BY option_index ASC", [betId], async (err, options) => {
                    if (err || !options || options.length === 0) return interaction.reply({ content: "Options introuvables.", flags: MessageFlags.Ephemeral });

                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId(`bet_resolve_select|${betId}|${messageId}`)
                        .setPlaceholder('Sélectionnez l\'option gagnante')
                        .addOptions(
                            options.map(opt => 
                                new StringSelectMenuOptionBuilder()
                                    .setLabel(`${opt.option_index}. ${opt.label}`)
                                    .setValue(opt.option_index.toString())
                            )
                        );
                    
                    // Option pour clore les paris sans résultat
                    if (bet.status === "OPEN") {
                        selectMenu.addOptions(
                            new StringSelectMenuOptionBuilder()
                                .setLabel("🔒 Clôturer les paris")
                                .setDescription("Empêche de nouveaux paris sans déclarer de vainqueur")
                                .setValue("lock")
                        );
                    }

                    selectMenu.addOptions(
                            new StringSelectMenuOptionBuilder()
                                .setLabel("❌ Annuler le pari")
                                .setDescription("Rembourse tous les participants")
                                .setValue("cancel")
                        );

                    const row = new ActionRowBuilder().addComponents(selectMenu);

                    await interaction.reply({
                        content: 'Veuillez sélectionner le résultat du pari :',
                        components: [row],
                        flags: MessageFlags.Ephemeral
                    });
                });
            });
            return;
        }
        
        // Gérer les boutons de rappel
        if (customId.startsWith('rappel|')) {
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                
                const [, reminderIdRaw] = customId.split('|');
                const userId = interaction.user.id;
                // interaction.guild est null en message privé.
                const guildId = interaction.guildId ?? '';
                const channelId = interaction.channelId ?? '';

                // Le customId ne porte plus que l'identifiant : le message et
                // l'échéance sont relus en base, ce qui lève la limite de 100
                // caractères d'un customId.
                const db = (await import('../../modules/db.js')).default;
                const source = await new Promise((resolve, reject) => {
                    db.get(
                        'SELECT message, trigger_at FROM reminders WHERE id = ?',
                        [reminderIdRaw],
                        (err, row) => (err ? reject(err) : resolve(row))
                    );
                });

                if (!source) {
                    await interaction.editReply({
                        content: '❌ Ce rappel n\'existe plus.',
                    });
                    return;
                }

                const message = source.message;
                const triggerAt = source.trigger_at;

                // Vérifier que la date est toujours dans le futur
                if (triggerAt <= Date.now()) {
                    await interaction.editReply({
                        content: '❌ Ce rappel est déjà passé !',
                    });
                    return;
                }

                // Un même utilisateur ne doit pas empiler dix copies du rappel
                // en cliquant plusieurs fois sur le bouton.
                const already = await new Promise((resolve, reject) => {
                    db.get(
                        'SELECT id FROM reminders WHERE user_id = ? AND trigger_at = ? AND message = ? AND sent = 0',
                        [userId, triggerAt, message],
                        (err, row) => (err ? reject(err) : resolve(row))
                    );
                });
                if (already) {
                    await interaction.editReply({
                        content: '✅ Tu as déjà ce rappel programmé.',
                    });
                    return;
                }

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

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('bet_resolve_select|')) {
            const [, betId, messageId] = interaction.customId.split('|');
            const selectedValue = interaction.values[0];
            const userId = interaction.user.id;

            pointsDb.get("SELECT * FROM bets WHERE id = ?", [betId], (err, bet) => {
                if (err || !bet) return interaction.reply({ content: "Pari introuvable.", flags: MessageFlags.Ephemeral });
                if (bet.creator_id !== userId) return interaction.reply({ content: "Seul le créateur peut terminer le pari.", flags: MessageFlags.Ephemeral });
                
                // Autoriser si OPEN ou LOCKED
                if (bet.status !== "OPEN" && bet.status !== "LOCKED") return interaction.reply({ content: "Ce pari est déjà terminé.", flags: MessageFlags.Ephemeral });

                if (selectedValue === 'lock') {
                    pointsDb.run("UPDATE bets SET status = 'LOCKED' WHERE id = ?", [betId]);
                    interaction.update({ content: "Les paris sont désormais clos.", components: [] });
                    
                    if (messageId) {
                        try {
                            (async () => {
                                const originalMessage = await interaction.channel.messages.fetch(messageId);
                                if (originalMessage) {
                                    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');
                                    const oldEmbed = originalMessage.embeds[0];
                                    const newEmbed = new EmbedBuilder(oldEmbed.data)
                                       .setTitle(`🔒 PARI CLOS: ${bet.title}`)
                                       .setColor('#FFA500'); // Orange
                                    
                                    // Garder seulement le bouton de résolution
                                    const resolveRow = new ActionRowBuilder().addComponents(
                                       new ButtonBuilder()
                                         .setCustomId(`bet_resolve_modal|${betId}`)
                                         .setLabel("Déclarer le résultat")
                                         .setStyle(ButtonStyle.Secondary)
                                     );
       
                                    await originalMessage.edit({ embeds: [newEmbed], components: [resolveRow] });
                                }
                            })();
                        } catch (e) {
                            handleException(e);
                        }
                    }
                    return;
                }

                if (selectedValue === 'cancel') {
                    pointsDb.all("SELECT user_id, amount FROM bet_participations WHERE bet_id = ?", [betId], (err, parts) => {
                        if (err) {
                            handleException(err);
                            return interaction.reply({ content: "Erreur lors de la récupération des participations.", flags: MessageFlags.Ephemeral });
                        }

                        pointsDb.serialize(async () => {
                            pointsDb.run("UPDATE bets SET status = 'CANCELLED' WHERE id = ?", [betId]);
                            
                            // addPoints fait un UPSERT : un remboursement ne
                            // peut pas se perdre si la ligne du joueur a disparu.
                            parts.forEach(p => addPoints(p.user_id, p.amount));

                            interaction.update({ content: "Le pari a été annulé et les mises remboursées.", components: [] });
                            
                            if (messageId) {
                                try {
                                    const originalMessage = await interaction.channel.messages.fetch(messageId);
                                    if (originalMessage) {
                                        const { EmbedBuilder } = await import('discord.js');
                                        const oldEmbed = originalMessage.embeds[0];
                                        const newEmbed = new EmbedBuilder(oldEmbed.data)
                                            .setTitle(`🚫 PARI ANNULÉ: ${bet.title}`)
                                            .setColor('#FF0000')
                                            .setDescription("Ce pari a été annulé par son créateur. Toutes les mises ont été remboursées.");
                                        
                                        await originalMessage.edit({ embeds: [newEmbed], components: [] });
                                    }
                                } catch (e) {
                                    // Message deleted or not found
                                }
                            }
                        });
                    });
                    return;
                }

                const winnerIndex = parseInt(selectedValue);

                pointsDb.get("SELECT label FROM bet_options WHERE bet_id = ? AND option_index = ?", [betId, winnerIndex], (err, winningOption) => {
                    if (err || !winningOption) return interaction.reply({ content: "Option gagnante invalide.", flags: MessageFlags.Ephemeral });

                    // Calculate results
                    pointsDb.all("SELECT user_id, option_index, amount FROM bet_participations WHERE bet_id = ?", [betId], (err, parts) => {
                        if (err) {
                            handleException(err);
                            return interaction.reply({ content: "Erreur lors de la récupération des participations.", flags: MessageFlags.Ephemeral });
                        }

                        const totalPool = parts.reduce((acc, p) => acc + p.amount, 0);
                        const winners = parts.filter(p => p.option_index === winnerIndex);
                        const totalWinningAmount = winners.reduce((acc, p) => acc + p.amount, 0);

                        pointsDb.serialize(async() => {
                            pointsDb.run("UPDATE bets SET status = 'CLOSED', winning_option_index = ? WHERE id = ?", [winnerIndex, betId]);

                            // Import stats DB
                            const statsDb = (await import('../../modules/db.js')).default;

                            // MAJ Stats: Total Wagered pour TOUS les participants
                            parts.forEach(participant => {
                                statsDb.run(
                                    `INSERT INTO bet_stats (user_id, total_wagered) VALUES (?, ?) 
                                     ON CONFLICT(user_id) DO UPDATE SET total_wagered = total_wagered + ?`,
                                    [participant.user_id, participant.amount, participant.amount]
                                );
                            });

                            // Calcul des statistiques pour l'affichage
                            const totalPoints = parts.reduce((acc, p) => acc + p.amount, 0);
                            const stats = {};
                            parts.forEach(p => {
                                if (!stats[p.option_index]) stats[p.option_index] = 0;
                                stats[p.option_index] += p.amount;
                            });

                            // Récupérer toutes les options pour l'affichage
                            pointsDb.all("SELECT option_index, label FROM bet_options WHERE bet_id = ? ORDER BY option_index ASC", [betId], async (err, allOptions) => {
                                if (err) {
                                    handleException(err);
                                    return;
                                }

                                const { EmbedBuilder } = await import('discord.js');
                                const resultEmbed = new EmbedBuilder()
                                    .setTitle(`Résultat du pari : ${bet.title}`)
                                    .setColor('#FFD700')
                                    .setDescription(`La réponse gagnante est ... || **${winningOption.label}** || !`);

                                let statsDescription = "";
                                allOptions.forEach(opt => {
                                    const amount = stats[opt.option_index] || 0;
                                    const percentage = totalPoints > 0 ? Math.round((amount / totalPoints) * 100) : 0;
                                    const isWinner = opt.option_index === winnerIndex;
                                    const icon = isWinner ? "✅" : "❌";
                                    
                                    // Barre de progression visuelle
                                    const filled = Math.round(percentage / 10);
                                    const empty = 10 - filled;
                                    const progressBar = "🟩".repeat(filled) + "⬛".repeat(empty);

                                    statsDescription += `${icon} **${opt.label}** : ${percentage}% (${amount} pts)\n${progressBar}\n\n`;
                                });
                                resultEmbed.addFields({ name: "Statistiques", value: statsDescription });

                                if (winners.length > 0) {
                                    winners.forEach(winner => {
                                        const share = winner.amount / totalWinningAmount;
                                        const winnings = Math.floor(share * totalPool);
                                        addPoints(winner.user_id, winnings);
                                        
                                        // Update MAX WIN stats
                                        statsDb.run(
                                            `INSERT INTO bet_stats (user_id, max_win) VALUES (?, ?) 
                                             ON CONFLICT(user_id) DO UPDATE SET max_win = MAX(max_win, ?)`,
                                            [winner.user_id, winnings, winnings]
                                         );
                                    });

                                    const winnerNames = winners.slice(0, 3).map(w => `<@${w.user_id}>`).join(", ");
                                    const otherWinnersCount = Math.max(0, winners.length - 3);
                                    const winnersText = otherWinnersCount > 0 
                                        ? `${winnerNames} et ${otherWinnersCount} autres` 
                                        : winnerNames;

                                    resultEmbed.addFields({ 
                                        name: "Gagnants", 
                                        value: `${winnersText} se répartissent **${totalPool}** points !` 
                                    });
                                } else {
                                    resultEmbed.addFields({ name: "Gagnants", value: "Personne n'avait parié sur cette option. La banque gagne tout ! 💸" });
                                }

                                interaction.update({ content: `Pari terminé !`, components: [] });
                                // Répondre au message original du pari si possible, sinon envoyer dans le channel
                                interaction.channel.send({ embeds: [resultEmbed] });

                                // Supprimer les boutons du message original
                                if (messageId) {
                                    try {
                                        const originalMessage = await interaction.channel.messages.fetch(messageId);
                                        if (originalMessage) {
                                            await originalMessage.edit({ components: [] });
                                        }
                                    } catch (e) {
                                        // Le message a peut-être été supprimé
                                    }
                                }
                            });
                        });
                    });
                });
            });
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('bet_estimate_resolve_submit|')) {
            const [, betId, messageId] = interaction.customId.split('|');
            const resultValueStr = interaction.fields.getTextInputValue('result');
            const resultValue = parseInt(resultValueStr);

            if (isNaN(resultValue)) {
                return interaction.reply({ content: "La réponse doit être un nombre entier.", flags: MessageFlags.Ephemeral });
            }

            pointsDb.get("SELECT title FROM bets WHERE id = ?", [betId], (err, bet) => {
                 if (err || !bet) return interaction.reply({ content: "Pari introuvable.", flags: MessageFlags.Ephemeral });

                 pointsDb.all("SELECT user_id, amount, prediction_value FROM bet_participations WHERE bet_id = ?", [betId], (err, parts) => {
                    if (err) {
                        handleException(err);
                        return interaction.reply({ content: "Erreur récupération participations.", flags: MessageFlags.Ephemeral });
                    }
                    
                    const totalPool = parts.reduce((acc, p) => acc + p.amount, 0);
                    let resultText = `La réponse correcte était **${resultValue}**.\n\n`;
                    
                    if (parts.length === 0) {
                        pointsDb.run("UPDATE bets SET status = 'CLOSED', winning_option_index = ? WHERE id = ?", [resultValue, betId]);
                        interaction.reply({ content: "Pari terminé (aucun participant).", flags: MessageFlags.Ephemeral });
                        if (interaction.channel) {
                             interaction.channel.send(`Le pari **"${bet.title}"** est terminé ! La réponse était **${resultValue}**. Aucun participant.`);
                        }
                        return;
                    }

                    // Calculate close winners.
                    // Une participation sans prediction_value donnerait un écart
                    // NaN, qui traverse le tri et fausse le classement : on l'écarte.
                    const diffs = parts
                        .filter(p => Number.isFinite(p.prediction_value))
                        .map(p => ({ ...p, diff: Math.abs(p.prediction_value - resultValue) }));
                    diffs.sort((a, b) => a.diff - b.diff);

                    if (diffs.length === 0) {
                        pointsDb.run("UPDATE bets SET status = 'CLOSED', winning_option_index = ? WHERE id = ?", [resultValue, betId]);
                        return interaction.reply({ content: "Pari terminé (aucune estimation valide).", flags: MessageFlags.Ephemeral }).catch(() => {});
                    }

                    const minDiff = diffs[0].diff;
                    const winners = diffs.filter(d => d.diff === minDiff);
                    const totalWinningAmount = winners.reduce((acc, w) => acc + w.amount, 0);

                    pointsDb.serialize(async () => {
                         pointsDb.run("UPDATE bets SET status = 'CLOSED', winning_option_index = ? WHERE id = ?", [resultValue, betId]);

                         // import DB for stats
                         const statsDb = (await import('../../modules/db.js')).default;

                         // MAJ Stats: Total Wagered pour TOUS les participants
                         parts.forEach(participant => {
                            statsDb.run(
                                `INSERT INTO bet_stats (user_id, total_wagered) VALUES (?, ?) 
                                 ON CONFLICT(user_id) DO UPDATE SET total_wagered = total_wagered + ?`,
                                [participant.user_id, participant.amount, participant.amount]
                            );
                        });

                         winners.forEach(winner => {
                             const share = winner.amount / totalWinningAmount;
                             const winnings = Math.floor(share * totalPool);
                             addPoints(winner.user_id, winnings);
                             resultText += `<@${winner.user_id}> gagne **${winnings}** points (Estimé: ${winner.prediction_value}, Diff: ${winner.diff})\n`;
                             
                             // Update MAX WIN stats
                             statsDb.run(
                                `INSERT INTO bet_stats (user_id, max_win) VALUES (?, ?) 
                                 ON CONFLICT(user_id) DO UPDATE SET max_win = MAX(max_win, ?)`,
                                [winner.user_id, winnings, winnings]
                             );
                         });

                         // Create Embed
                         const { EmbedBuilder } = await import('discord.js');
                         const resultEmbed = new EmbedBuilder()
                            .setTitle(`Résultat: ${bet.title}`)
                            .setDescription(`La bonne réponse était **${resultValue}**.\n\n${resultText}`)
                            .setColor('#FFD700')
                            .setFooter({ text: `Total en jeu: ${totalPool} points` });
                        
                        await interaction.reply({ content: "Résultats publiés !", flags: MessageFlags.Ephemeral });
                        await interaction.channel.send({ embeds: [resultEmbed] });
                        
                         // Update original message
                         if (messageId) {
                            try {
                                const originalMessage = await interaction.channel.messages.fetch(messageId);
                                if (originalMessage) await originalMessage.edit({ components: [] });
                            } catch (e) {}
                         }
                    });
                 });
            });
            return;
        }

        if (interaction.customId.startsWith('bet_estimate_modal|')) {
            const [, betId] = interaction.customId.split('|');
            const predictionStr = interaction.fields.getTextInputValue('prediction');
            const amountStr = interaction.fields.getTextInputValue('amount');
            const userId = interaction.user.id;

            const prediction = parseInt(predictionStr);
            const amount = parseInt(amountStr);

            if (isNaN(prediction)) return interaction.reply({ content: "L'estimation doit être un nombre entier.", flags: MessageFlags.Ephemeral });
            if (isNaN(amount) || amount <= 0) return interaction.reply({ content: "La mise doit être un nombre positif.", flags: MessageFlags.Ephemeral });
            if (amount > MAX_BET_AMOUNT) {
                return interaction.reply({ content: `La mise ne peut pas dépasser **${MAX_BET_AMOUNT}** points.`, flags: MessageFlags.Ephemeral });
            }

            // Le bouton vérifiait déjà le statut et le créateur, mais un modal
            // reste ouvert côté client : on revérifie au moment du dépôt, sinon
            // on peut miser sur un pari déjà clos ou déjà résolu.
            pointsDb.get("SELECT creator_id, status, is_estimation FROM bets WHERE id = ?", [betId], (err, bet) => {
                if (err) {
                    handleException(err);
                    return interaction.reply({ content: "Erreur base de données.", flags: MessageFlags.Ephemeral });
                }
                if (!bet || !bet.is_estimation) return interaction.reply({ content: "Pari introuvable.", flags: MessageFlags.Ephemeral });
                if (bet.status !== 'OPEN') return interaction.reply({ content: "Ce pari est fermé.", flags: MessageFlags.Ephemeral });
                if (bet.creator_id === userId) {
                    return interaction.reply({ content: "❌ Vous ne pouvez pas parier sur votre propre estimation !", flags: MessageFlags.Ephemeral });
                }

                pointsDb.get("SELECT amount FROM bet_participations WHERE bet_id = ? AND user_id = ?", [betId, userId], (err, existing) => {
                    if (err) {
                        handleException(err);
                        return interaction.reply({ content: "Erreur base de données.", flags: MessageFlags.Ephemeral });
                    }

                    const previousAmount = existing ? existing.amount : 0;
                    const delta = amount - previousAmount;

                    // Enregistre la participation, puis compense le mouvement de
                    // solde si l'écriture échoue.
                    const persist = () => {
                        const onWritten = (err) => {
                            if (err) {
                                handleException(err);
                                // Remboursement / re-débit symétrique du delta.
                                if (delta > 0) addPoints(userId, delta);
                                else if (delta < 0) spendPoints(userId, -delta, () => {});
                                return interaction.reply({ content: "Erreur lors de l'enregistrement de votre estimation.", flags: MessageFlags.Ephemeral }).catch(() => {});
                            }
                            interaction.reply({
                                content: existing
                                    ? `Estimation mise à jour: **${prediction}** avec **${amount}** points.`
                                    : `Estimation enregistrée: **${prediction}** avec **${amount}** points.`,
                                flags: MessageFlags.Ephemeral,
                            }).catch(() => {});
                            // Les stats de volume misé sont mises à jour à la
                            // résolution, pour ne pas gonfler à chaque édition.
                            updateEstimateEmbed(interaction, betId);
                        };

                        if (existing) {
                            pointsDb.run("UPDATE bet_participations SET amount = ?, prediction_value = ? WHERE bet_id = ? AND user_id = ?", [amount, prediction, betId, userId], onWritten);
                        } else {
                            pointsDb.run("INSERT INTO bet_participations (bet_id, user_id, option_index, amount, prediction_value) VALUES (?, ?, 0, ?, ?)", [betId, userId, amount, prediction], onWritten);
                        }
                    };

                    if (delta > 0) {
                        // Débit atomique : deux modals soumis en même temps ne
                        // peuvent plus faire passer le solde sous zéro.
                        return spendPoints(userId, delta, (err, debited) => {
                            if (err) {
                                handleException(err);
                                return interaction.reply({ content: "Erreur base de données.", flags: MessageFlags.Ephemeral });
                            }
                            if (!debited) {
                                return getBalance(userId, (err, balance) => {
                                    interaction.reply({ content: `Solde insuffisant. Il te manque **${delta - balance}** points.`, flags: MessageFlags.Ephemeral }).catch(() => {});
                                });
                            }
                            persist();
                        });
                    }
                    if (delta < 0) {
                        // Remboursement partiel : sans contrôle d'erreur, la
                        // participation serait réduite alors que les points
                        // n'ont pas été rendus.
                        return addPoints(userId, -delta, (err) => {
                            if (err) {
                                handleException(err);
                                return interaction.reply({ content: "Erreur base de données.", flags: MessageFlags.Ephemeral }).catch(() => {});
                            }
                            persist();
                        });
                    }
                    persist();
                });
            });
            return;
        }

        if (interaction.customId.startsWith('bet_modal|')) {
            const [, betId, optionIndexRaw] = interaction.customId.split('|');
            const optionIndex = parseInt(optionIndexRaw);
            const amount = parseInt(interaction.fields.getTextInputValue('amount'));
            const userId = interaction.user.id;

            if (isNaN(amount) || amount <= 0) {
                return interaction.reply({ content: "La mise doit être un nombre positif.", flags: MessageFlags.Ephemeral });
            }
            if (amount > MAX_BET_AMOUNT) {
                return interaction.reply({ content: `La mise ne peut pas dépasser **${MAX_BET_AMOUNT}** points.`, flags: MessageFlags.Ephemeral });
            }
            if (isNaN(optionIndex)) {
                return interaction.reply({ content: "Option invalide.", flags: MessageFlags.Ephemeral });
            }

            // Tout est vérifié AVANT le débit : statut du pari, créateur,
            // validité de l'option, et cohérence avec une mise déjà placée.
            pointsDb.get("SELECT creator_id, status FROM bets WHERE id = ?", [betId], (err, bet) => {
                if (err) {
                    handleException(err);
                    return interaction.reply({ content: "Erreur base de données.", flags: MessageFlags.Ephemeral });
                }
                if (!bet) return interaction.reply({ content: "Pari introuvable.", flags: MessageFlags.Ephemeral });
                if (bet.status !== "OPEN") return interaction.reply({ content: "Ce pari est fermé.", flags: MessageFlags.Ephemeral });
                if (bet.creator_id === userId) {
                    return interaction.reply({ content: "❌ Vous ne pouvez pas parier sur votre propre pari !", flags: MessageFlags.Ephemeral });
                }

                pointsDb.get("SELECT id FROM bet_options WHERE bet_id = ? AND option_index = ?", [betId, optionIndex], (err, opt) => {
                    if (err || !opt) return interaction.reply({ content: "Option invalide.", flags: MessageFlags.Ephemeral });

                    pointsDb.get("SELECT option_index, amount FROM bet_participations WHERE bet_id = ? AND user_id = ?", [betId, userId], (err, existing) => {
                        if (err) {
                            handleException(err);
                            return interaction.reply({ content: "Erreur base de données.", flags: MessageFlags.Ephemeral });
                        }
                        // Le bouton refuse déjà de changer d'option, mais deux
                        // modals ouverts en parallèle contourneraient ce garde-fou.
                        if (existing && existing.option_index !== optionIndex) {
                            return interaction.reply({ content: "Vous avez déjà parié sur une autre option. Vous ne pouvez pas changer d'option.", flags: MessageFlags.Ephemeral });
                        }

                        // Débit atomique : « décrémenter si et seulement si le
                        // solde suffit » tient en une requête, donc deux mises
                        // simultanées ne peuvent plus passer le solde sous zéro.
                        spendPoints(userId, amount, (err, debited) => {
                            if (err) {
                                handleException(err);
                                return interaction.reply({ content: "Erreur base de données.", flags: MessageFlags.Ephemeral });
                            }
                            if (!debited) {
                                return getBalance(userId, (err, balance) => {
                                    interaction.reply({
                                        content: `Vous n'avez pas assez de points. Solde: ${balance}`,
                                        flags: MessageFlags.Ephemeral,
                                    }).catch(() => {});
                                });
                            }

                            const onWritten = (err) => {
                                if (err) {
                                    handleException(err);
                                    addPoints(userId, amount); // remboursement
                                    return interaction.reply({ content: "Erreur lors de l'enregistrement de votre pari.", flags: MessageFlags.Ephemeral }).catch(() => {});
                                }
                                interaction.reply({
                                    content: existing
                                        ? `Vous avez ajouté **${amount}** points à votre mise sur l'option **${optionIndex}** du pari #${betId}. Total misé: **${existing.amount + amount}**.`
                                        : `Vous avez misé **${amount}** points sur l'option **${optionIndex}** du pari #${betId}.`,
                                    flags: MessageFlags.Ephemeral,
                                }).catch(() => {});
                                updateBetEmbed(interaction, betId);
                            };

                            if (existing) {
                                pointsDb.run(
                                    "UPDATE bet_participations SET amount = amount + ? WHERE bet_id = ? AND user_id = ?",
                                    [amount, betId, userId],
                                    onWritten
                                );
                            } else {
                                pointsDb.run(
                                    "INSERT INTO bet_participations (bet_id, user_id, option_index, amount) VALUES (?, ?, ?, ?)",
                                    [betId, userId, optionIndex, amount],
                                    onWritten
                                );
                            }
                        });
                    });
                });
            });
        }
    }

    // Helper function to update bet embed
    function updateBetEmbed(interaction, betId) {
        pointsDb.all("SELECT option_index, amount FROM bet_participations WHERE bet_id = ?", [betId], (err, rows) => {
            if (err) return;
            const stats = {};
            let totalBetPoints = 0;
            rows.forEach(r => {
                if (!stats[r.option_index]) stats[r.option_index] = 0;
                stats[r.option_index] += r.amount;
                totalBetPoints += r.amount;
            });

            pointsDb.all("SELECT option_index, label FROM bet_options WHERE bet_id = ? ORDER BY option_index ASC", [betId], async (err, options) => {
                if (err) return;
                
                try {
                    const { EmbedBuilder } = await import('discord.js');
                    if (!interaction.message) return;
                    
                    const oldEmbed = interaction.message.embeds[0];
                    if (!oldEmbed) return;

                    const newEmbed = new EmbedBuilder(oldEmbed.data);
                    
                    let description = `Cliquez sur les boutons ci-dessous pour participer !\n\n**Options:**\n`;
                    options.forEach(opt => {
                        const amount = stats[opt.option_index] || 0;
                        const percentage = totalBetPoints > 0 ? Math.round((amount / totalBetPoints) * 100) : 0;
                        
                        const filled = Math.round(percentage / 10);
                        const empty = 10 - filled;
                        const progressBar = "🟩".repeat(filled) + "⬛".repeat(empty);
                        
                        description += `${opt.option_index}. ${opt.label}\n${progressBar} **${percentage}%** (${amount} pts)\n\n`;
                    });
                    
                    newEmbed.setDescription(description);
                    
                    await interaction.message.edit({ embeds: [newEmbed] });
                } catch (e) {
                    // Ignorer les erreurs d'édition
                }
            });
        });
    }

    async function updateEstimateEmbed(interaction, betId) {
        pointsDb.all("SELECT user_id, amount, prediction_value FROM bet_participations WHERE bet_id = ?", [betId], async (err, rows) => {
            if (err) return;
            try {
                const { EmbedBuilder } = await import('discord.js');
                // Try to get message from interaction if possible
                let message = interaction.message;
                if (!message && interaction.channel) {
                     // Can't easily find message without ID, but for buttons interaction.message is set.
                }
                if (!message) return;

                const oldEmbed = message.embeds[0];
                if (!oldEmbed) return;

                const newEmbed = new EmbedBuilder(oldEmbed.data);
                let description = `Cliquez sur le bouton ci-dessous pour proposer votre estimation !\nLe gagnant sera celui qui sera le plus proche du résultat.\n\n**Participations:**\n`;

                if (!rows || rows.length === 0) {
                     description += "(Aucune pour le moment)";
                } else {
                     description += rows.map(r => `<@${r.user_id}> : **${r.prediction_value}** (${r.amount} pts)`).join('\n');
                }

                newEmbed.setDescription(description);
                await message.edit({ embeds: [newEmbed] });
            } catch (e) {
                // ignore
            }
        });
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
