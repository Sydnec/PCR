import { handleException, log } from '../../modules/utils.js';
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import pointsDb from '../../modules/points-db.js';
import { handlePokemonButton } from '../../modules/pokemon/interactions.js';

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
                            
                            parts.forEach(p => {
                                pointsDb.run("UPDATE points SET balance = balance + ? WHERE user_id = ?", [p.amount, p.user_id]);
                            });

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
                                        pointsDb.run("UPDATE points SET balance = balance + ? WHERE user_id = ?", [winnings, winner.user_id]);
                                        
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

                    // Calculate close winners
                    const diffs = parts.map(p => ({ ...p, diff: Math.abs(p.prediction_value - resultValue) }));
                    diffs.sort((a, b) => a.diff - b.diff);
                    
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
                             pointsDb.run("UPDATE points SET balance = balance + ? WHERE user_id = ?", [winnings, winner.user_id]);
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

            pointsDb.get("SELECT balance FROM points WHERE user_id = ?", [userId], (err, row) => {
                if (err) return interaction.reply({ content: "Erreur BD.", flags: MessageFlags.Ephemeral });
                const balance = row ? row.balance : 0;
                
                // Check if updating
                pointsDb.get("SELECT amount FROM bet_participations WHERE bet_id = ? AND user_id = ?", [betId, userId], (err, existing) => {
                     const previousAmount = existing ? existing.amount : 0;
                     const cost = amount - previousAmount; // Can be negative if reducing bet, but we usually only allow adding? The prompt said "participants by providing a value".
                     // If I allow changing prediction, I must account for amount differences.
                     // The user can change amount. If amount > previousAmount, they pay more.
                     // If amount < previousAmount, they get refund? Let's check logic.
                     
                     if (balance < cost) {
                         return interaction.reply({ content: `Solde insuffisant. Manque ${cost - balance} points.`, flags: MessageFlags.Ephemeral });
                     }

                     pointsDb.serialize(async () => {
                         // Update balance
                         pointsDb.run("UPDATE points SET balance = balance - ? WHERE user_id = ?", [cost, userId]);
                         
                         // Import stats DB
                         // const statsDb = (await import('../../modules/db.js')).default; // REMOVED: Stats updated mostly on resolve
                     
                         if (existing) {
                             pointsDb.run("UPDATE bet_participations SET amount = ?, prediction_value = ? WHERE bet_id = ? AND user_id = ?", [amount, prediction, betId, userId]);
                             interaction.reply({ content: `Estimation mise à jour: **${prediction}** avec **${amount}** points.`, flags: MessageFlags.Ephemeral });
                         } else {
                             pointsDb.run("INSERT INTO bet_participations (bet_id, user_id, option_index, amount, prediction_value) VALUES (?, ?, 0, ?, ?)", [betId, userId, amount, prediction]);
                             interaction.reply({ content: `Estimation enregistrée: **${prediction}** avec **${amount}** points.`, flags: MessageFlags.Ephemeral });
                         }
                         
                         // Update TOTAL WAGERED stats moved to resolution to avoid inflation on edit/cancel
                         
                         updateEstimateEmbed(interaction, betId);
                     });
                });
            });
            return;
        }

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
                        pointsDb.serialize(async () => {
                            pointsDb.run("UPDATE points SET balance = balance - ? WHERE user_id = ?", [amount, userId]);
                            
                            // Check if user already participated to update or insert
                            pointsDb.get("SELECT amount FROM bet_participations WHERE bet_id = ? AND user_id = ?", [betId, userId], (err, existing) => {
                                if (existing) {
                                    // Update existing participation
                                    pointsDb.run(
                                        "UPDATE bet_participations SET amount = amount + ? WHERE bet_id = ? AND user_id = ?",
                                        [amount, betId, userId],
                                        (err) => {
                                            if (err) {
                                                // Refund if update fails
                                                pointsDb.run("UPDATE points SET balance = balance + ? WHERE user_id = ?", [amount, userId]);
                                                return interaction.reply({ content: "Erreur lors de la mise à jour de votre pari.", flags: MessageFlags.Ephemeral });
                                            }
                                            
                                            // Stats update moved to resolution
                                            
                                            interaction.reply({ content: `Vous avez ajouté **${amount}** points à votre mise sur l'option **${optionIndex}** du pari #${betId}. Total misé: **${existing.amount + amount}**.`, flags: MessageFlags.Ephemeral });
                                            updateBetEmbed(interaction, betId);
                                        }
                                    );
                                } else {
                                    // Insert new participation
                                    pointsDb.run(
                                        "INSERT INTO bet_participations (bet_id, user_id, option_index, amount) VALUES (?, ?, ?, ?)",
                                        [betId, userId, optionIndex, amount],
                                        (err) => {
                                            if (err) {
                                                // Refund if insert fails
                                                pointsDb.run("UPDATE points SET balance = balance + ? WHERE user_id = ?", [amount, userId]);
                                                return interaction.reply({ content: "Erreur lors de l'enregistrement de votre pari.", flags: MessageFlags.Ephemeral });
                                            }
                                            
                                            // Stats update moved to resolution

                                            interaction.reply({ content: `Vous avez misé **${amount}** points sur l'option **${optionIndex}** du pari #${betId}.`, flags: MessageFlags.Ephemeral });
                                            updateBetEmbed(interaction, betId);
                                        }
                                    );
                                }
                            });
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
