import { EmbedBuilder } from 'discord.js';
import { handleException, splitEmbed } from '../../modules/utils.js';
import db from '../../modules/db.js';
import { 
    filterSignificantWords, 
    analyzeSentiment, 
    detectFillerWords,
    calculateLexicalDiversity,
    generateWordSummary,
    calculateServerWordAverages,
    detectOverusedWords
} from '../../modules/word-analysis.js';
import dotenv from 'dotenv';
dotenv.config();

export default (bot) => {
    bot.handleAnnualRecapOnTimer = async () => {
        try {
            console.log('🎉 Démarrage du récapitulatif annuel...');
            
            const guild = bot.guilds.cache.get(process.env.GUILD_ID);
            if (!guild) {
                console.error('❌ Guild introuvable');
                return;
            }

            const annualRecapChannel = guild.channels.cache.get(process.env.ANNUAL_RECAP_CHANNEL_ID);
            if (!annualRecapChannel) {
                console.error('❌ Canal de récapitulatif annuel introuvable');
                return;
            }

            // Récupérer tous les membres du serveur
            await guild.members.fetch();
            const members = guild.members.cache.filter(member => !member.user.bot);

            // Calculer les moyennes serveur pour les mots (une seule fois)
            console.log('📊 Calcul des moyennes serveur pour l\'analyse des mots...');
            let serverAverages = null;
            try {
                serverAverages = await getServerWordAverages();
                console.log(`✅ Moyennes calculées pour ${Object.keys(serverAverages).length} mots uniques`);
            } catch (error) {
                console.error('⚠️ Erreur calcul moyennes serveur:', error.message);
            }

            // Envoyer les stats personnelles à chaque utilisateur
            console.log(`📨 Envoi des récaps personnels à ${members.size} utilisateurs...`);
            for (const [userId, member] of members) {
                try {
                    await sendPersonalRecap(bot, member.user, guild, serverAverages);
                    console.log(`✅ Recap envoyé à ${member.user.tag}`);
                } catch (error) {
                    console.error(`❌ Erreur envoi recap à ${member.user.tag}:`, error.message);
                }
            }

            // Envoyer les stats globales sur le canal de récapitulatif annuel
            console.log('📊 Envoi des stats globales sur le canal de récapitulatif annuel...');
            await sendGlobalRecap(bot, annualRecapChannel, guild);

            // Envoyer TOUTES les stats à SYDNEC_USER_ID
            const sydnecUserId = process.env.SYDNEC_USER_ID;
            if (sydnecUserId) {
                try {
                    const sydnecUser = await bot.users.fetch(sydnecUserId);
                    console.log('👑 Envoi de TOUTES les stats à Sydnec...');
                    await sendAdminRecap(bot, sydnecUser, guild, members, serverAverages);
                    console.log('✅ Stats admin envoyées à Sydnec');
                } catch (error) {
                    console.error('❌ Erreur envoi stats admin:', error.message);
                }
            }

            console.log('🎉 Récapitulatif annuel terminé !');
        } catch (error) {
            handleException(error);
            console.error('❌ Erreur lors du récapitulatif annuel:', error);
        }
    };
};

// ===== RÉCAP PERSONNEL =====
async function sendPersonalRecap(bot, user, guild, serverAverages = null) {
    const year = new Date().getFullYear();
    const userMessages = await getUserMessages(user.id);
    const userReactions = await getUserReactions(user.id);
    const userVoiceTime = await getUserVoiceTime(user.id);
    const userTopEmojis = await getUserTopEmojis(user.id);
    const userTopChannels = await getUserTopChannels(user.id, guild);
    const userTopWords = await getUserTopWords(user.id, serverAverages);
    const userShips = await getUserShips(user.id, guild, bot);

    const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle(`🎊 Ton Récap ${year} sur ${guild.name}`)
        .setDescription(`Hey ${user.username} ! Voici ton année sur le serveur 🌟`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setTimestamp()
        .setFooter({ text: `Récapitulatif annuel ${year}` });

    // Messages
    if (userMessages.total > 0) {
        embed.addFields({
            name: '💬 Tes Messages',
            value:
                `**Total:** ${userMessages.total.toLocaleString()} messages\n` +
                `**Moyenne/jour:** ${userMessages.avgPerDay} msg\n` +
                `**Tes channels favoris:**\n${userTopChannels}`,
            inline: false,
        });
    }

    // Réactions
    if (userReactions > 0) {
        embed.addFields({
            name: '😀 Tes Réactions',
            value:
                `**Total:** ${userReactions.toLocaleString()} réactions\n` +
                `**Tes emojis favoris:**\n${userTopEmojis}`,
            inline: false,
        });
    }

    // Vocal
    if (userVoiceTime.total > 0) {
        embed.addFields({
            name: '🎤 Ton Vocal',
            value:
                `**Temps total:** ${formatDuration(userVoiceTime.total)}\n` +
                `**Record session:** ${formatDuration(userVoiceTime.longest)}`,
            inline: false,
        });
    }

    // Mots favoris
    if (userTopWords) {
        embed.addFields({
            name: '💭 Ton Profil Linguistique',
            value: userTopWords,
            inline: false,
        });
    }

    // Ships
    if (userShips) {
        embed.addFields({
            name: '💕 Tes Randomizabaise',
            value: userShips,
            inline: false,
        });
    }

    try {
        const embeds = splitEmbed(embed);
        await user.send({ embeds });
    } catch (error) {
        console.error(`Impossible d'envoyer le récap à ${user.tag}: ${error.message}`);
    }
}

// ===== RÉCAP GLOBAL (Canal Général) =====
async function sendGlobalRecap(bot, channel, guild) {
    const year = new Date().getFullYear();
    
    // Stats serveur
    const totalMessages = await getTotalMessages();
    const topUsers = await getTopActiveUsers(guild, bot);
    const topChannels = await getTopActiveChannels(guild);
    const mostActiveDay = await getMostActiveDay();
    const totalReactions = await getTotalReactions();
    const topReactors = await getTopReactors(guild, bot);
    const topEmojis = await getTopEmojis();
    const mostReactedMessage = await getMostReactedMessage(guild);
    const totalVoiceTime = await getTotalVoiceTime();
    const topVoiceUsers = await getTopVoiceUsers(guild, bot);
    const longestSession = await getLongestVoiceSession(guild, bot);
    const topCommands = await getTopCommands();

    const serverEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`🎉 Récap ${year} - Statistiques du Serveur`)
        .setDescription(`L'année ${year} sur ${guild.name} en chiffres !`)
        .setTimestamp()
        .setFooter({ text: `Récapitulatif annuel ${year}` });

    // Messages
    serverEmbed.addFields({
        name: '💬 Messages',
        value:
            `**Total:** ${totalMessages.toLocaleString()} messages\n` +
            `**Top Utilisateurs:**\n${topUsers}\n` +
            `**Top Channels:**\n${topChannels}\n` +
            `**Jour le plus actif:** ${mostActiveDay}`,
        inline: false,
    });

    // Réactions
    serverEmbed.addFields({
        name: '😀 Réactions',
        value:
            `**Total:** ${totalReactions.toLocaleString()} réactions\n` +
            `**Top Réacteurs:**\n${topReactors}\n` +
            `**Top Emojis:**\n${topEmojis}\n` +
            `**Message le plus réagi:** ${mostReactedMessage}`,
        inline: false,
    });

    // Vocal
    serverEmbed.addFields({
        name: '🎤 Vocal',
        value:
            `**Temps total:** ${totalVoiceTime}\n` +
            `**Top Vocal:**\n${topVoiceUsers}\n` +
            `**Record session:** ${longestSession}`,
        inline: false,
    });

    // Commandes
    serverEmbed.addFields({
        name: '⚡ Commandes',
        value: `${topCommands}`,
        inline: false,
    });

    // Stats Randomizabaise
    const totalRandomizabaise = await getTotalRandomizabaise();
    const mostReactedShip = await getMostReactedShip(guild, bot);
    const topBaiseur = await getTopBaiseur(guild, bot);
    const topRealizedShips = await getTopRealizedShips(guild, bot);

    const randomizabaiseEmbed = new EmbedBuilder()
        .setColor('#FF69B4')
        .setTitle(`💕 Récap ${year} - Randomizabaise`)
        .setDescription(`**Nombre total de randomizabaise:** ${totalRandomizabaise.toLocaleString()}\n\nLes Randomizabaise qui ont marqué l'année !`)
        .setTimestamp()
        .setFooter({ text: `Récapitulatif annuel ${year}` });

    randomizabaiseEmbed.addFields({
        name: '🔥 Randomizabaise ayant fait le plus réagir',
        value: mostReactedShip || 'Aucune donnée disponible',
        inline: false,
    });

    randomizabaiseEmbed.addFields({
        name: '<:hehe:1182374886544289832> Le plus gros baiseur',
        value: topBaiseur || 'Aucune donnée disponible',
        inline: false,
    });

    // Découper les ships en morceaux de max 1024 caractères
    const shipsValue = topRealizedShips || 'Aucune donnée disponible';
    if (shipsValue.length <= 1024) {
        randomizabaiseEmbed.addFields({
            name: '💞 Top 15 Randomizabaise',
            value: shipsValue,
            inline: false,
        });
    } else {
        // Split manuellement par lignes
        const lines = shipsValue.split('\n');
        let currentChunk = '';
        let chunkIndex = 0;
        
        for (const line of lines) {
            if ((currentChunk + line + '\n').length > 1024) {
                randomizabaiseEmbed.addFields({
                    name: chunkIndex === 0 ? '💞 Top 15 Randomizabaise' : '💞 Top 15 Randomizabaise (suite)',
                    value: currentChunk,
                    inline: false,
                });
                currentChunk = line + '\n';
                chunkIndex++;
            } else {
                currentChunk += line + '\n';
            }
        }
        
        if (currentChunk) {
            randomizabaiseEmbed.addFields({
                name: chunkIndex === 0 ? '💞 Top 15 Randomizabaise' : '💞 Top 15 Randomizabaise (suite)',
                value: currentChunk,
                inline: false,
            });
        }
    }

    // Envoyer les embeds
    const serverEmbeds = splitEmbed(serverEmbed);
    const randomizabaiseEmbeds = splitEmbed(randomizabaiseEmbed);
    
    await channel.send({ embeds: serverEmbeds });
    await channel.send({ embeds: randomizabaiseEmbeds });
}

// ===== RÉCAP ADMIN (TOUTES LES STATS) =====
async function sendAdminRecap(bot, adminUser, guild, members, serverAverages = null) {
    const year = new Date().getFullYear();
    
    // Envoyer les stats globales
    await sendGlobalRecapToDM(bot, adminUser, guild, year);
    
    // Envoyer un message d'introduction pour les stats individuelles
    try {
        await adminUser.send(`📊 **STATS INDIVIDUELLES DE TOUS LES UTILISATEURS (${year})**\n\n`);
    } catch (error) {
        console.error('Erreur envoi intro stats admin:', error.message);
    }
    
    // Envoyer les stats détaillées de chaque utilisateur
    console.log(`📊 Envoi des stats individuelles de ${members.size} utilisateurs...`);
    
    for (const [userId, member] of members) {
        try {
            // Récupérer les stats de l'utilisateur
            const userMessages = await getUserMessages(userId);
            const userReactions = await getUserReactions(userId);
            const userVoiceTime = await getUserVoiceTime(userId);
            const userTopEmojis = await getUserTopEmojis(userId);
            const userTopChannels = await getUserTopChannels(userId, guild);
            const userTopWords = await getUserTopWords(userId, serverAverages);
            const userShips = await getUserShips(userId, guild, bot);

            // Créer l'embed pour cet utilisateur
            const embed = new EmbedBuilder()
                .setColor('#00D166')
                .setTitle(`👑 ADMIN - Stats ${year} de ${member.user.username}`)
                .setDescription(`Stats envoyées à <@${userId}>`)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setTimestamp()
                .setFooter({ text: `Récapitulatif annuel ${year}` });

            // Messages
            if (userMessages.total > 0) {
                embed.addFields({
                    name: '💬 Messages',
                    value:
                        `**Total:** ${userMessages.total.toLocaleString()} messages\n` +
                        `**Moyenne/jour:** ${userMessages.avgPerDay} msg\n` +
                        `**Channels favoris:**\n${userTopChannels}`,
                    inline: false,
                });
            }

            // Réactions
            if (userReactions > 0) {
                embed.addFields({
                    name: '😀 Réactions',
                    value:
                        `**Total:** ${userReactions.toLocaleString()} réactions\n` +
                        `**Emojis favoris:**\n${userTopEmojis}`,
                    inline: false,
                });
            }

            // Vocal
            if (userVoiceTime.total > 0) {
                embed.addFields({
                    name: '🎤 Vocal',
                    value:
                        `**Temps total:** ${formatDuration(userVoiceTime.total)}\n` +
                        `**Record session:** ${formatDuration(userVoiceTime.longest)}`,
                    inline: false,
                });
            }

            // Mots favoris
            if (userTopWords) {
                embed.addFields({
                    name: '💭 Profil Linguistique',
                    value: userTopWords,
                    inline: false,
                });
            }

            // Ships
            if (userShips) {
                embed.addFields({
                    name: '💕 Randomizabaise',
                    value: userShips,
                    inline: false,
                });
            }

            // Envoyer l'embed
            const embeds = splitEmbed(embed);
            await adminUser.send({ embeds });
            
            console.log(`✅ Stats détaillées de ${member.user.tag} envoyées à l'admin`);
        } catch (error) {
            console.error(`❌ Erreur envoi stats admin pour ${member.user.tag}:`, error.message);
        }
    }
}

// Fonction pour envoyer les stats globales en DM à l'admin
async function sendGlobalRecapToDM(bot, adminUser, guild, year) {
    // Stats serveur
    const totalMessages = await getTotalMessages();
    const topUsers = await getTopActiveUsers(guild, bot);
    const topChannels = await getTopActiveChannels(guild);
    const mostActiveDay = await getMostActiveDay();
    const totalReactions = await getTotalReactions();
    const topReactors = await getTopReactors(guild, bot);
    const topEmojis = await getTopEmojis();
    const mostReactedMessage = await getMostReactedMessage(guild);
    const totalVoiceTime = await getTotalVoiceTime();
    const topVoiceUsers = await getTopVoiceUsers(guild, bot);
    const longestSession = await getLongestVoiceSession(guild, bot);
    const topCommands = await getTopCommands();

    const serverEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`👑 ADMIN - Récap ${year} - Stats Serveur`)
        .setDescription(`Statistiques complètes de ${guild.name}`)
        .setTimestamp()
        .setFooter({ text: `Récapitulatif annuel ${year}` });

    serverEmbed.addFields({
        name: '💬 Messages',
        value:
            `**Total:** ${totalMessages.toLocaleString()} messages\n` +
            `**Top Utilisateurs:**\n${topUsers}\n` +
            `**Top Channels:**\n${topChannels}\n` +
            `**Jour le plus actif:** ${mostActiveDay}`,
        inline: false,
    });

    serverEmbed.addFields({
        name: '😀 Réactions',
        value:
            `**Total:** ${totalReactions.toLocaleString()} réactions\n` +
            `**Top Réacteurs:**\n${topReactors}\n` +
            `**Top Emojis:**\n${topEmojis}\n` +
            `**Message le plus réagi:** ${mostReactedMessage}`,
        inline: false,
    });

    serverEmbed.addFields({
        name: '🎤 Vocal',
        value:
            `**Temps total:** ${totalVoiceTime}\n` +
            `**Top Vocal:**\n${topVoiceUsers}\n` +
            `**Record session:** ${longestSession}`,
        inline: false,
    });

    serverEmbed.addFields({
        name: '⚡ Commandes',
        value: `${topCommands}`,
        inline: false,
    });

    // Stats Randomizabaise
    const totalRandomizabaise = await getTotalRandomizabaise();
    const mostReactedShip = await getMostReactedShip(guild, bot);
    const topBaiseur = await getTopBaiseur(guild, bot);
    const topRealizedShips = await getTopRealizedShips(guild, bot);

    const randomizabaiseEmbed = new EmbedBuilder()
        .setColor('#FF69B4')
        .setTitle(`👑 ADMIN - Récap ${year} - Randomizabaise`)
        .setDescription(`**Nombre total de randomizabaise:** ${totalRandomizabaise.toLocaleString()}\n\nStatistiques complètes des Randomizabaise`)
        .setTimestamp()
        .setFooter({ text: `Récapitulatif annuel ${year}` });

    randomizabaiseEmbed.addFields({
        name: '🔥 Randomizabaise ayant fait le plus réagir',
        value: mostReactedShip || 'Aucune donnée disponible',
        inline: false,
    });

    randomizabaiseEmbed.addFields({
        name: '<:hehe:1182374886544289832> Le plus gros baiseur',
        value: topBaiseur || 'Aucune donnée disponible',
        inline: false,
    });

    const shipsValue = topRealizedShips || 'Aucune donnée disponible';
    if (shipsValue.length <= 1024) {
        randomizabaiseEmbed.addFields({
            name: '💞 Top 15 Randomizabaise',
            value: shipsValue,
            inline: false,
        });
    } else {
        const lines = shipsValue.split('\n');
        let currentChunk = '';
        let chunkIndex = 0;
        
        for (const line of lines) {
            if ((currentChunk + line + '\n').length > 1024) {
                randomizabaiseEmbed.addFields({
                    name: chunkIndex === 0 ? '💞 Top 15 Randomizabaise' : '💞 Top 15 Randomizabaise (suite)',
                    value: currentChunk,
                    inline: false,
                });
                currentChunk = line + '\n';
                chunkIndex++;
            } else {
                currentChunk += line + '\n';
            }
        }
        
        if (currentChunk) {
            randomizabaiseEmbed.addFields({
                name: chunkIndex === 0 ? '💞 Top 15 Randomizabaise' : '💞 Top 15 Randomizabaise (suite)',
                value: currentChunk,
                inline: false,
            });
        }
    }

    const serverEmbeds = splitEmbed(serverEmbed);
    const randomizabaiseEmbeds = splitEmbed(randomizabaiseEmbed);
    
    for (const embed of serverEmbeds) {
        await adminUser.send({ embeds: [embed] });
    }
    for (const embed of randomizabaiseEmbeds) {
        await adminUser.send({ embeds: [embed] });
    }
}

// ===== FONCTIONS UTILITAIRES (copies de stats.js) =====

async function getUserDisplay(client, guild, userId) {
    try {
        try {
            const member = await guild.members.fetch(userId);
            if (member) return `<@${userId}>`;
        } catch (e) {}
        
        try {
            const user = await client.users.fetch(userId);
            if (user) return `<@${userId}>`;
        } catch (e) {}
        
        return `<@${userId}>`;
    } catch (e) {
        return `User-${userId.slice(0, 8)}`;
    }
}

function getTotalMessages() {
    return new Promise((resolve, reject) => {
        db.get("SELECT SUM(count) as total FROM message_stats WHERE user_id = '__global__'", (err, row) => {
            if (err) reject(err);
            else resolve(row?.total || 0);
        });
    });
}

function getTopActiveUsers(guild, client) {
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT user_id, SUM(count) as total FROM message_stats WHERE user_id != '__global__' GROUP BY user_id ORDER BY total DESC LIMIT 5",
            async (err, rows) => {
                if (err) reject(err);
                else {
                    const formatted = await Promise.all(
                        rows.map(async (row, index) => {
                            const userDisplay = await getUserDisplay(client, guild, row.user_id);
                            return `${index + 1}. ${userDisplay}: **${row.total.toLocaleString()}** msg`;
                        })
                    );
                    resolve(formatted.join("\n") || "Aucune donnée");
                }
            }
        );
    });
}

function getTopActiveChannels(guild) {
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT channel_id, SUM(count) as total FROM message_stats WHERE user_id != '__global__' GROUP BY channel_id ORDER BY total DESC LIMIT 5",
            async (err, rows) => {
                if (err) reject(err);
                else {
                    const formatted = rows.map((row, index) => {
                        return `${index + 1}. <#${row.channel_id}>: **${row.total.toLocaleString()}** msg`;
                    });
                    resolve(formatted.join("\n") || "Aucune donnée");
                }
            }
        );
    });
}

function getMostActiveDay() {
    return new Promise((resolve, reject) => {
        db.get(
            "SELECT date, SUM(count) as total FROM message_stats WHERE user_id != '__global__' GROUP BY date ORDER BY total DESC LIMIT 1",
            (err, row) => {
                if (err) reject(err);
                else resolve(row ? `${row.date} (${row.total.toLocaleString()} msg)` : "Aucune donnée");
            }
        );
    });
}

function getTotalReactions() {
    return new Promise((resolve, reject) => {
        db.get("SELECT SUM(count) as total FROM reaction_stats WHERE user_id != '__global__'", (err, row) => {
            if (err) reject(err);
            else resolve(row?.total || 0);
        });
    });
}

function getTopReactors(guild, client) {
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT user_id, count FROM reaction_stats WHERE user_id != '__global__' ORDER BY count DESC LIMIT 5",
            async (err, rows) => {
                if (err) reject(err);
                else {
                    const formatted = await Promise.all(
                        rows.map(async (row, index) => {
                            const userDisplay = await getUserDisplay(client, guild, row.user_id);
                            return `${index + 1}. ${userDisplay}: **${row.count.toLocaleString()}** réactions`;
                        })
                    );
                    resolve(formatted.join("\n") || "Aucune donnée");
                }
            }
        );
    });
}

function getTopEmojis() {
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT emoji, SUM(count) as total FROM emoji_stats WHERE user_id != '__global__' GROUP BY emoji ORDER BY total DESC LIMIT 100",
            (err, rows) => {
                if (err) reject(err);
                else {
                    const emojiMap = new Map();
                    
                    rows.forEach(row => {
                        let emoji = row.emoji;
                        const count = row.total;
                        
                        if (emoji.includes('%')) {
                            try {
                                emoji = decodeURIComponent(emoji);
                            } catch (e) {}
                        }
                        
                        if (emoji.includes(':')) {
                            const fullMatch = emoji.match(/<(a)?:([^:]+):(\d+)>/);
                            if (fullMatch) {
                                const [, animated, name, id] = fullMatch;
                                emoji = animated ? `<a:${name}:${id}>` : `<:${name}:${id}>`;
                            } else {
                                const idMatch = emoji.match(/^([^:]+):(\d+)$/);
                                if (idMatch) {
                                    const [, name, id] = idMatch;
                                    emoji = `<:${name}:${id}>`;
                                } else {
                                    const nameMatch = emoji.match(/^:([^:]+):$/);
                                    if (nameMatch) {
                                        emoji = `:${nameMatch[1]}:`;
                                    }
                                }
                            }
                        }
                        
                        if (emojiMap.has(emoji)) {
                            emojiMap.set(emoji, emojiMap.get(emoji) + count);
                        } else {
                            emojiMap.set(emoji, count);
                        }
                    });
                    
                    const sortedEmojis = Array.from(emojiMap.entries())
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 10);
                    
                    const formatted = sortedEmojis.map(
                        ([emoji, count], index) => `${index + 1}. ${emoji} **${count.toLocaleString()}**`
                    );
                    resolve(formatted.join("\n") || "Aucune donnée");
                }
            }
        );
    });
}

function getMostReactedMessage(guild) {
    return new Promise((resolve, reject) => {
        db.get(
            "SELECT message_id, count FROM message_reactions ORDER BY count DESC LIMIT 1",
            async (err, row) => {
                if (err) reject(err);
                else {
                    if (!row) {
                        resolve("Aucune donnée");
                        return;
                    }
                    try {
                        try { await guild.channels.fetch(); } catch (e) {}
                        let link = null;
                        for (const channel of guild.channels.cache.values()) {
                            if (!channel || typeof channel.isTextBased !== "function" || !channel.isTextBased()) continue;
                            try {
                                await channel.messages.fetch(row.message_id);
                                link = `https://discord.com/channels/${guild.id}/${channel.id}/${row.message_id}`;
                                break;
                            } catch (e) {}
                        }
                        if (link) {
                            resolve(`${link} (${row.count} réactions)`);
                        } else {
                            resolve(`ID: ${row.message_id} (${row.count} réactions)`);
                        }
                    } catch (e) {
                        resolve(`ID: ${row.message_id} (${row.count} réactions)`);
                    }
                }
            }
        );
    });
}

function getTotalVoiceTime() {
    return new Promise((resolve, reject) => {
        db.get("SELECT SUM(total_time_ms) as total FROM voice_time", (err, row) => {
            if (err) reject(err);
            else resolve(formatDuration(row?.total || 0));
        });
    });
}

function getTopVoiceUsers(guild, client) {
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT user_id, total_time_ms FROM voice_time ORDER BY total_time_ms DESC LIMIT 5",
            async (err, rows) => {
                if (err) reject(err);
                else {
                    const formatted = await Promise.all(
                        rows.map(async (row, index) => {
                            const userDisplay = await getUserDisplay(client, guild, row.user_id);
                            return `${index + 1}. ${userDisplay}: **${formatDuration(row.total_time_ms)}**`;
                        })
                    );
                    resolve(formatted.join("\n") || "Aucune donnée");
                }
            }
        );
    });
}

function getLongestVoiceSession(guild, client) {
    return new Promise((resolve, reject) => {
        db.get(
            "SELECT user_id, longest_session FROM voice_time ORDER BY longest_session DESC LIMIT 1",
            async (err, row) => {
                if (err) reject(err);
                else {
                    if (!row) {
                        resolve("Aucune donnée");
                        return;
                    }
                    const userDisplay = await getUserDisplay(client, guild, row.user_id);
                    resolve(`${userDisplay}: **${formatDuration(row.longest_session)}**`);
                }
            }
        );
    });
}

function getTopCommands() {
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT command, count FROM command_stats ORDER BY count DESC LIMIT 3",
            (err, rows) => {
                if (err) reject(err);
                else {
                    const formatted = rows.map(
                        (row, index) => `${index + 1}. /${row.command}: **${row.count.toLocaleString()}**`
                    );
                    resolve(formatted.join("\n") || "Aucune donnée");
                }
            }
        );
    });
}

function getTotalRandomizabaise() {
    return new Promise((resolve, reject) => {
        db.get("SELECT COUNT(*) as total FROM randomizabaise_stats", (err, row) => {
            if (err) reject(err);
            else resolve(row?.total || 0);
        });
    });
}

function getMostReactedShip(guild, client) {
    return new Promise((resolve, reject) => {
        db.get(
            "SELECT message_id, user_a, user_b, reaction_count FROM randomizabaise_stats ORDER BY reaction_count DESC LIMIT 1",
            async (err, row) => {
                if (err) reject(err);
                else {
                    if (!row) {
                        resolve("Aucune donnée");
                        return;
                    }
                    const userA = await getUserDisplay(client, guild, row.user_a);
                    const userB = await getUserDisplay(client, guild, row.user_b);
                    resolve(`${userA} 💕 ${userB} (${row.reaction_count} réactions)`);
                }
            }
        );
    });
}

function getTopRealizedShips(guild, client) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT 
                CASE WHEN user_a < user_b THEN user_a ELSE user_b END as userA,
                CASE WHEN user_a < user_b THEN user_b ELSE user_a END as userB,
                COUNT(*) as count
            FROM randomizabaise_stats
            GROUP BY userA, userB
            ORDER BY count DESC
            LIMIT 15`,
            async (err, rows) => {
                if (err) reject(err);
                else {
                    const formatted = await Promise.all(
                        rows.map(async (row, index) => {
                            const userA = await getUserDisplay(client, guild, row.userA);
                            const userB = await getUserDisplay(client, guild, row.userB);
                            return `${index + 1}. ${userA} 💕 ${userB}: ${row.count}x`;
                        })
                    );
                    resolve(formatted.join("\n") || "Aucune donnée");
                }
            }
        );
    });
}

function getTopBaiseur(guild, client) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT user_id, COUNT(*) as count
            FROM (
                SELECT user_a as user_id FROM randomizabaise_stats
                UNION ALL
                SELECT user_b as user_id FROM randomizabaise_stats
            )
            GROUP BY user_id
            ORDER BY count DESC
            LIMIT 1`,
            async (err, rows) => {
                if (err) reject(err);
                else {
                    if (!rows || rows.length === 0) {
                        resolve("Aucune donnée");
                        return;
                    }
                    const topUser = rows[0];
                    const userDisplay = await getUserDisplay(client, guild, topUser.user_id);
                    resolve(`${userDisplay} (${topUser.count} apparitions)`);
                }
            }
        );
    });
}

function getUserMessages(userId) {
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT SUM(count) as total, COUNT(DISTINCT date) as days FROM message_stats WHERE user_id = ?",
            [userId],
            (err, rows) => {
                if (err) reject(err);
                else {
                    const total = rows[0]?.total || 0;
                    const days = rows[0]?.days || 1;
                    const avgPerDay = Math.round(total / days);
                    resolve({ total, avgPerDay });
                }
            }
        );
    });
}

function getUserReactions(userId) {
    return new Promise((resolve, reject) => {
        db.get("SELECT count FROM reaction_stats WHERE user_id = ?", [userId], (err, row) => {
            if (err) reject(err);
            else resolve(row?.count || 0);
        });
    });
}

function getUserVoiceTime(userId) {
    return new Promise((resolve, reject) => {
        db.get(
            "SELECT total_time_ms, longest_session FROM voice_time WHERE user_id = ?",
            [userId],
            (err, row) => {
                if (err) reject(err);
                else
                    resolve({
                        total: row?.total_time_ms || 0,
                        longest: row?.longest_session || 0,
                    });
            }
        );
    });
}

function getUserTopEmojis(userId) {
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT emoji, count FROM emoji_stats WHERE user_id = ? ORDER BY count DESC LIMIT 100",
            [userId],
            (err, rows) => {
                if (err) reject(err);
                else {
                    const emojiMap = new Map();
                    
                    rows.forEach(row => {
                        let emoji = row.emoji;
                        const count = row.count;
                        
                        if (emoji.includes('%')) {
                            try {
                                emoji = decodeURIComponent(emoji);
                            } catch (e) {}
                        }
                        
                        if (emoji.includes(':')) {
                            const fullMatch = emoji.match(/<(a)?:([^:]+):(\d+)>/);
                            if (fullMatch) {
                                const [, animated, name, id] = fullMatch;
                                emoji = animated ? `<a:${name}:${id}>` : `<:${name}:${id}>`;
                            } else {
                                const idMatch = emoji.match(/^([^:]+):(\d+)$/);
                                if (idMatch) {
                                    const [, name, id] = idMatch;
                                    emoji = `<:${name}:${id}>`;
                                } else {
                                    const nameMatch = emoji.match(/^:([^:]+):$/);
                                    if (nameMatch) {
                                        emoji = `:${nameMatch[1]}:`;
                                    }
                                }
                            }
                        }
                        
                        if (emojiMap.has(emoji)) {
                            emojiMap.set(emoji, emojiMap.get(emoji) + count);
                        } else {
                            emojiMap.set(emoji, count);
                        }
                    });
                    
                    const sortedEmojis = Array.from(emojiMap.entries())
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5);
                    
                    const formatted = sortedEmojis.map(
                        ([emoji, count], index) => `${index + 1}. ${emoji} **${count.toLocaleString()}**`
                    );
                    resolve(formatted.join("\n") || "Aucune donnée");
                }
            }
        );
    });
}

function getUserTopChannels(userId, guild) {
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT channel_id, SUM(count) as total FROM message_stats WHERE user_id = ? GROUP BY channel_id ORDER BY total DESC LIMIT 3",
            [userId],
            async (err, rows) => {
                if (err) reject(err);
                else {
                    const formatted = rows.map((row, index) => {
                        return `${index + 1}. <#${row.channel_id}>: **${row.total}** msg`;
                    });
                    resolve(formatted.join("\n") || "Aucune donnée");
                }
            }
        );
    });
}

function getUserTopWords(userId, serverAverages = null) {
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT word, count FROM word_stats WHERE user_id = ?",
            [userId],
            (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                if (rows.length === 0) {
                    resolve(null);
                    return;
                }

                // Convertir en objet {mot: count}
                const wordCounts = {};
                rows.forEach(row => {
                    wordCounts[row.word] = row.count;
                });

                // Analyser avec le module word-analysis
                const summary = generateWordSummary(wordCounts, serverAverages);
                
                // Construire le message formaté
                let formatted = [];

                // 1. Mots significatifs (top 5)
                if (summary.topWords.length > 0) {
                    const topWordsText = summary.topWords
                        .slice(0, 5)
                        .map(([word, count], index) => `${index + 1}. **${word}**: ${count}x`)
                        .join('\n');
                    formatted.push(topWordsText);
                }
                
                // 4. Tics de langage détectés
                if (summary.fillerWords.length > 0) {
                    const topFiller = summary.fillerWords[0];
                    formatted.push(`🗣️ **Ton tic:** "${topFiller[0]}" (${topFiller[1]}x)`);
                }

                // 5. Mots sur-utilisés vs serveur
                if (summary.overusedWords.length > 0 && serverAverages) {
                    const topOverused = summary.overusedWords[0];
                    formatted.push(`🔥 **Signature:** "${topOverused.word}" (${topOverused.ratio}x la moyenne)`);
                }

                resolve(formatted.join('\n') || null);
            }
        );
    });
}

function getUserShips(userId, guild, client) {
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT user_a, user_b, reaction_count FROM randomizabaise_stats WHERE user_a = ? OR user_b = ? ORDER BY reaction_count DESC LIMIT 5",
            [userId, userId],
            async (err, rows) => {
                if (err) reject(err);
                else {
                    if (rows.length === 0) {
                        resolve(null);
                        return;
                    }
                    
                    const totalAppearances = await getUserShipCount(userId);
                    
                    const formatted = await Promise.all(
                        rows.map(async (row, index) => {
                            const otherUserId = row.user_a === userId ? row.user_b : row.user_a;
                            const userDisplay = await getUserDisplay(client, guild, otherUserId);
                            return `${index + 1}. avec ${userDisplay} (${row.reaction_count} ❤️)`;
                        })
                    );
                    
                    const result = `**Total:** ${totalAppearances} randomizabaise\n${formatted.join("\n")}`;
                    resolve(result);
                }
            }
        );
    });
}

function getUserShipCount(userId) {
    return new Promise((resolve, reject) => {
        db.get(
            "SELECT COUNT(*) as total FROM randomizabaise_stats WHERE user_a = ? OR user_b = ?",
            [userId, userId],
            (err, row) => {
                if (err) reject(err);
                else resolve(row?.total || 0);
            }
        );
    });
}

function formatDuration(ms) {
    if (!ms || ms === 0) return "0h 0m";
    
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 24) {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        return `${days}j ${remainingHours}h`;
    }
    
    return `${hours}h ${minutes}m`;
}

// Calculer les moyennes serveur pour les mots
function getServerWordAverages() {
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT user_id, word, count FROM word_stats",
            (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }

                // Grouper par utilisateur
                const userWordCounts = {};
                rows.forEach(row => {
                    if (!userWordCounts[row.user_id]) {
                        userWordCounts[row.user_id] = {};
                    }
                    userWordCounts[row.user_id][row.word] = row.count;
                });

                // Convertir en format pour calculateServerWordAverages
                const allUsersWordCounts = Object.entries(userWordCounts).map(([userId, wordCounts]) => ({
                    userId,
                    wordCounts
                }));

                // Calculer les moyennes
                const averages = calculateServerWordAverages(allUsersWordCounts);
                resolve(averages);
            }
        );
    });
}
