import { SlashCommandBuilder, MessageFlags, EmbedBuilder } from "discord.js";
import { handleException, splitEmbed } from "../modules/utils.js";
import db from "../modules/db.js";
import dotenv from "dotenv";
dotenv.config();

export default {
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Affiche les statistiques du serveur ou d'un utilisateur")
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Type de statistiques à afficher")
        .setRequired(true)
        .addChoices(
          { name: "📊 Serveur", value: "server" },
          { name: "💕 Randomizabaise", value: "randomizabaise" },
          { name: "👤 Utilisateur", value: "user" }
        )
    )
    .addUserOption((option) =>
      option
        .setName("utilisateur")
        .setDescription("Utilisateur pour les stats personnelles (optionnel)")
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply();
      const type = interaction.options.getString("type");
      const targetUser = interaction.options.getUser("utilisateur") || interaction.user;

      // Utiliser le serveur actuel
      const guild = interaction.guild;

      if (type === "server") {
        await handleServerStats(interaction, guild);
      } else if (type === "randomizabaise") {
        await handleRandomizabaiseStats(interaction, guild);
      } else if (type === "user") {
        await handleUserStats(interaction, targetUser, guild);
      }
    } catch (error) {
      handleException(error);
      await interaction.editReply({
        content: "❌ Une erreur est survenue lors de la récupération des statistiques.",
      });
    }
  },
};

// ===== STATISTIQUES SERVEUR =====
async function handleServerStats(interaction, guild) {
  try {
    const client = interaction.client;
    
    // Récupération des stats
    const totalMessages = await getTotalMessages();
    const topUsers = await getTopActiveUsers(guild, client);
    const topChannels = await getTopActiveChannels(guild);
    const mostActiveDay = await getMostActiveDay();
    const totalReactions = await getTotalReactions();
    const topReactors = await getTopReactors(guild, client);
    const topEmojis = await getTopEmojis();
    const mostReactedMessage = await getMostReactedMessage(guild);
    const totalVoiceTime = await getTotalVoiceTime();
    const topVoiceUsers = await getTopVoiceUsers(guild, client);
    const longestSession = await getLongestVoiceSession(guild, client);
    const topCommands = await getTopCommands();

    // Vérifier si des données existent
    if (totalMessages === 0) {
      await interaction.editReply({
        content: "❌ Aucune statistique disponible pour le moment.",
      });
      return;
    }

    // Construction de l'embed
    const embed = new EmbedBuilder()
      .setColor("#5865F2")
      .setTitle("📊 Statistiques du Serveur")
      .setTimestamp()
      .setFooter({ text: `Statistiques de ${guild.name}` });

    // Messages
    embed.addFields({
      name: "💬 Messages",
      value:
        `**Total:** ${totalMessages.toLocaleString()} messages\n` +
        `**Top Utilisateurs:**\n${topUsers}\n` +
        `**Top Channels:**\n${topChannels}\n` +
        `**Jour le plus actif:** ${mostActiveDay}`,
      inline: false,
    });

    // Réactions
    embed.addFields({
      name: "😀 Réactions",
      value:
        `**Total:** ${totalReactions.toLocaleString()} réactions\n` +
        `**Top Réacteurs:**\n${topReactors}\n` +
        `**Top Emojis:**\n${topEmojis}\n` +
        `**Message le plus réagit:** ${mostReactedMessage}`,
      inline: false,
    });

    // Vocal
    embed.addFields({
      name: "🎤 Vocal",
      value:
        `**Temps total:** ${totalVoiceTime}\n` +
        `**Top Vocal:**\n${topVoiceUsers}\n` +
        `**Record session:** ${longestSession}`,
      inline: false,
    });

    // Commandes
    embed.addFields({
      name: "⚡ Commandes",
      value: `${topCommands}`,
      inline: false,
    });

    // Split l'embed si nécessaire
    const embeds = splitEmbed(embed);
    await interaction.editReply({ embeds });
  } catch (error) {
    handleException(error);
    await interaction.editReply({
      content: "❌ Une erreur est survenue lors de la récupération des statistiques du serveur.",
    });
  }
}

// ===== STATISTIQUES RANDOMIZABAISE =====
async function handleRandomizabaiseStats(interaction, guild) {
  const client = interaction.client;
  const mostReactedShip = await getMostReactedShip(guild, client);
  const topRealizedShips = await getTopRealizedShips(guild, client);

  const embed = new EmbedBuilder()
    .setColor("#FF69B4")
    .setTitle("💕 Statistiques Randomizabaise")
    .setDescription("Les Randomizabaise qui ont marqué le serveur")
    .setTimestamp()
    .setFooter({ text: `Statistiques de ${guild.name}` });

  embed.addFields({
    name: "🔥 Randomizabaise ayant fait le plus réagir",
    value: mostReactedShip || "Aucune donnée disponible",
    inline: false,
  });

  // Découper les ships en morceaux de max 1024 caractères
  const shipsValue = topRealizedShips || "Aucune donnée disponible";
  if (shipsValue.length <= 1024) {
    embed.addFields({
      name: "💞 Randomizabaise",
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
        // Ajouter le chunk actuel
        embed.addFields({
          name: chunkIndex === 0 ? "💞 Randomizabaise les plus réalisés" : "💞 Randomizabaise les plus réalisés (suite)",
          value: currentChunk,
          inline: false,
        });
        currentChunk = line + '\n';
        chunkIndex++;
      } else {
        currentChunk += line + '\n';
      }
    }
    
    // Ajouter le dernier chunk
    if (currentChunk) {
      embed.addFields({
        name: chunkIndex === 0 ? "💞 Randomizabaise les plus réalisés" : "💞 Randomizabaise les plus réalisés (suite)",
        value: currentChunk,
        inline: false,
      });
    }
  }

  // Split l'embed si nécessaire
  const embeds = splitEmbed(embed);
  await interaction.editReply({ embeds });
}

// ===== STATISTIQUES UTILISATEUR =====
async function handleUserStats(interaction, user, guild) {
  const client = interaction.client;
  const userMessages = await getUserMessages(user.id);
  const userReactions = await getUserReactions(user.id);
  const userVoiceTime = await getUserVoiceTime(user.id);
  const userTopEmojis = await getUserTopEmojis(user.id);
  const userTopChannels = await getUserTopChannels(user.id, guild);
  const userTopWords = await getUserTopWords(user.id);
  const userShips = await getUserShips(user.id, guild, client);

  const embed = new EmbedBuilder()
    .setColor("#00D166")
    .setTitle(`📈 Statistiques de ${user.username}`)
    .setDescription(`Activité et contributions sur le serveur`)
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .setTimestamp()
    .setFooter({ text: `Statistiques de ${guild.name}` });

  // Messages
  embed.addFields({
    name: "💬 Messages",
    value:
      `**Total:** ${userMessages.total.toLocaleString()} messages\n` +
      `**Moyenne/jour:** ${userMessages.avgPerDay} msg\n` +
      `**Channels favoris:**\n${userTopChannels}`,
    inline: false,
  });

  // Réactions
  embed.addFields({
    name: "😀 Réactions",
    value:
      `**Total:** ${userReactions.toLocaleString()} réactions\n` +
      `**Emojis favoris:**\n${userTopEmojis}`,
    inline: false,
  });

  // Vocal
  if (userVoiceTime.total > 0) {
    embed.addFields({
      name: "🎤 Vocal",
      value:
        `**Temps total:** ${formatDuration(userVoiceTime.total)}\n` +
        `**Record session:** ${formatDuration(userVoiceTime.longest)}`,
      inline: false,
    });
  }

  // Mots favoris
  if (userTopWords) {
    embed.addFields({
      name: "💭 Mots favoris",
      value: userTopWords,
      inline: false,
    });
  }

  // Ships
  if (userShips) {
    embed.addFields({
      name: "💕 Randomizabaise",
      value: userShips,
      inline: false,
    });
  }

  // Split l'embed si nécessaire
  const embeds = splitEmbed(embed);
  await interaction.editReply({ embeds });
}

// ===== FONCTIONS UTILITAIRES =====

// Helper pour récupérer le nom d'un utilisateur avec fallback sur mention
async function getUserDisplay(client, guild, userId) {
  try {
    // Essayer de récupérer depuis le guild d'abord
    try {
      const member = await guild.members.fetch(userId);
      if (member) return `<@${userId}>`;
    } catch (e) {
      // Si pas dans le guild, essayer via l'API Discord
    }
    
    // Essayer de récupérer l'utilisateur via l'API Discord
    try {
      const user = await client.users.fetch(userId);
      if (user) return `<@${userId}>`;
    } catch (e) {
      // L'utilisateur n'existe plus ou n'est pas accessible
    }
    
    // Fallback: afficher une mention même si l'utilisateur n'est pas trouvé
    // Discord affichera "@Utilisateur inconnu" ou l'ID
    return `<@${userId}>`;
  } catch (e) {
    // En cas d'erreur totale, fallback sur ID partiel
    return `User-${userId.slice(0, 8)}`;
  }
}

// Messages
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
            // Utiliser une mention de channel qui fonctionne même si on n'est pas sur le serveur
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

// Réactions
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
          // Normaliser les emojis pour regrouper les doublons
          const emojiMap = new Map();
          
          rows.forEach(row => {
            let emoji = row.emoji;
            const count = row.total; // Utiliser 'total' et non 'count'
            
            // Décoder les emojis URL-encoded (emojis natifs Discord)
            if (emoji.includes('%')) {
              try {
                emoji = decodeURIComponent(emoji);
              } catch (e) {
                // Garder tel quel si décodage échoue
              }
            }
            
            // Nettoyer le format des emojis personnalisés Discord
            // Formats possibles: <:name:id>, :name:id:, name:id, :name:
            if (emoji.includes(':')) {
              // Cas 1: Format complet avec <> : <:name:id> ou <a:name:id>
              const fullMatch = emoji.match(/<(a)?:([^:]+):(\d+)>/);
              if (fullMatch) {
                const [, animated, name, id] = fullMatch;
                emoji = animated ? `<a:${name}:${id}>` : `<:${name}:${id}>`;
              } else {
                // Cas 2: Format name:id (sans <>)
                const idMatch = emoji.match(/^([^:]+):(\d+)$/);
                if (idMatch) {
                  const [, name, id] = idMatch;
                  emoji = `<:${name}:${id}>`;
                } else {
                  // Cas 3: Format :name: (emoji natif ou sans ID)
                  const nameMatch = emoji.match(/^:([^:]+):$/);
                  if (nameMatch) {
                    emoji = `:${nameMatch[1]}:`;
                  }
                }
              }
            }
            
            // Accumuler les counts
            if (emojiMap.has(emoji)) {
              emojiMap.set(emoji, emojiMap.get(emoji) + count);
            } else {
              emojiMap.set(emoji, count);
            }
          });
          
          // Convertir en tableau, trier et prendre le top 10
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
          // Try to find the channel containing the message and build a link to it
          try {
            // populate channels cache if needed
            try { await guild.channels.fetch(); } catch (e) {}
            let link = null;
            for (const channel of guild.channels.cache.values()) {
              if (!channel || typeof channel.isTextBased !== "function" || !channel.isTextBased()) continue;
              try {
                await channel.messages.fetch(row.message_id);
                link = `https://discord.com/channels/${guild.id}/${channel.id}/${row.message_id}`;
                break;
              } catch (e) {
                // message not in this channel or not accessible, continue
              }
            }
            if (link) {
              resolve(`${link} (${row.count} réactions)`);
            } else {
              // fallback to ID if we couldn't locate the channel
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

// Vocal
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

// Commandes
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

// Randomizabaise
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
      ORDER BY count DESC`,
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

// Stats utilisateur
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
          // Normaliser les emojis pour regrouper les doublons (même logique que getTopEmojis)
          const emojiMap = new Map();
          
          rows.forEach(row => {
            let emoji = row.emoji;
            const count = row.count;
            
            // Décoder les emojis URL-encoded (emojis natifs Discord)
            if (emoji.includes('%')) {
              try {
                emoji = decodeURIComponent(emoji);
              } catch (e) {
                // Garder tel quel si décodage échoue
              }
            }
            
            // Nettoyer le format des emojis personnalisés Discord
            // Formats possibles: <:name:id>, :name:id:, name:id, :name:
            if (emoji.includes(':')) {
              // Cas 1: Format complet avec <> : <:name:id> ou <a:name:id>
              const fullMatch = emoji.match(/<(a)?:([^:]+):(\d+)>/);
              if (fullMatch) {
                const [, animated, name, id] = fullMatch;
                emoji = animated ? `<a:${name}:${id}>` : `<:${name}:${id}>`;
              } else {
                // Cas 2: Format name:id (sans <>)
                const idMatch = emoji.match(/^([^:]+):(\d+)$/);
                if (idMatch) {
                  const [, name, id] = idMatch;
                  emoji = `<:${name}:${id}>`;
                } else {
                  // Cas 3: Format :name: (emoji natif ou sans ID)
                  const nameMatch = emoji.match(/^:([^:]+):$/);
                  if (nameMatch) {
                    emoji = `:${nameMatch[1]}:`;
                  }
                }
              }
            }
            
            // Accumuler les counts
            if (emojiMap.has(emoji)) {
              emojiMap.set(emoji, emojiMap.get(emoji) + count);
            } else {
              emojiMap.set(emoji, count);
            }
          });
          
          // Convertir en tableau, trier et prendre le top 5
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
            // Utiliser une mention de channel qui fonctionne même si on n'est pas sur le serveur
            return `${index + 1}. <#${row.channel_id}>: **${row.total}** msg`;
          });
          resolve(formatted.join("\n") || "Aucune donnée");
        }
      }
    );
  });
}

function getUserTopWords(userId) {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT word, count FROM word_stats WHERE user_id = ? ORDER BY count DESC LIMIT 5",
      [userId],
      (err, rows) => {
        if (err) reject(err);
        else {
          const formatted = rows.map(
            (row, index) => `${index + 1}. **${row.word}**: ${row.count}x`
          );
          resolve(formatted.join("\n") || "Aucune donnée");
        }
      }
    );
  });
}

function getUserShips(userId, guild, client) {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT user_a, user_b, reaction_count FROM randomizabaise_stats WHERE user_a = ? OR user_b = ? ORDER BY reaction_count DESC",
      [userId, userId],
      async (err, rows) => {
        if (err) reject(err);
        else {
          if (rows.length === 0) {
            resolve(null);
            return;
          }
          
          // Compter le nombre total d'apparitions
          const totalAppearances = await getUserShipCount(userId);
          
          const formatted = await Promise.all(
            rows.map(async (row, index) => {
              const otherUserId = row.user_a === userId ? row.user_b : row.user_a;
              const userDisplay = await getUserDisplay(client, guild, otherUserId);
              return `${index + 1}. avec ${userDisplay} (${row.reaction_count} ❤️)`;
            })
          );
          
          // Ajouter le total d'apparitions en haut
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
