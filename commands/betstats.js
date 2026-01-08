import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { handleException } from "../modules/utils.js";
import db from "../modules/db.js";

export default {
    data: new SlashCommandBuilder()
        .setName("betstats")
        .setDescription("Affiche les statistiques des paris")
        .addUserOption(option => 
            option.setName("user")
                .setDescription("L'utilisateur dont voir les stats (optionnel)")
        ),

    async execute(interaction) {
        try {
            const targetUser = interaction.options.getUser("user") || interaction.user;
            const isSelf = targetUser.id === interaction.user.id;

            // 1. Get User Stats
            db.get("SELECT total_wagered, max_win FROM bet_stats WHERE user_id = ?", [targetUser.id], (err, userStats) => {
                if (err) {
                    handleException(err);
                    return interaction.reply({ content: "Erreur lors de la récupération des stats.", ephemeral: true });
                }

                const totalWagered = userStats ? userStats.total_wagered : 0;
                const maxWin = userStats ? userStats.max_win : 0;

                // 2. Get Server Global Stats
                db.get("SELECT SUM(total_wagered) as server_total, MAX(max_win) as server_max_win FROM bet_stats", (err, serverStats) => {
                    if (err) {
                        handleException(err);
                        return interaction.reply({ content: "Erreur lors de la récupération des stats globales.", ephemeral: true });
                    }
                    
                    const serverTotal = serverStats.server_total || 0;
                    const serverMaxWin = serverStats.server_max_win || 0;

                    // 3. Get Top Winner Name
                    db.get("SELECT user_id FROM bet_stats WHERE max_win = ?", [serverMaxWin], (err, topWinner) => {
                        const topWinnerId = topWinner ? topWinner.user_id : null;
                        
                        const embed = new EmbedBuilder()
                            .setTitle(`📊 Statistiques de Paris : ${targetUser.username}`)
                            .setColor('#0099ff')
                            .addFields(
                                { 
                                    name: "👤 Joueur", 
                                    value: `**Total misé :** ${totalWagered.toLocaleString()} pts\n**Plus gros gain :** ${maxWin.toLocaleString()} pts`, 
                                    inline: false 
                                },
                                { 
                                    name: "🌍 Serveur", 
                                    value: `**Volume total misé :** ${serverTotal.toLocaleString()} pts\n**Record de gain :** ${serverMaxWin.toLocaleString()} pts ${topWinnerId ? `(<@${topWinnerId}>)` : ''}`, 
                                    inline: false 
                                }
                            )
                            .setThumbnail(targetUser.displayAvatarURL())
                            .setTimestamp();

                        interaction.reply({ embeds: [embed] });
                    });
                });
            });

        } catch (error) {
            handleException(error);
        }
    },
};
