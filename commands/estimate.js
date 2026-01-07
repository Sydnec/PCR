import { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { handleException } from "../modules/utils.js";
import db from "../modules/points-db.js";

export default {
    data: new SlashCommandBuilder()
        .setName("estimate")
        .setDescription("Créer un nouveau pari d'estimation (Le plus proche gagne)")
        .addStringOption((option) =>
            option
                .setName("question")
                .setDescription("La question du pari")
                .setRequired(true)
        ),

    async execute(interaction) {
        try {
            await handleCreate(interaction);
        } catch (error) {
            handleException(error);
        }
    },
};

async function handleCreate(interaction) {
    const question = interaction.options.getString("question");

    db.run(
        "INSERT INTO bets (creator_id, title, is_estimation) VALUES (?, ?, 1)",
        [interaction.user.id, question],
        function (err) {
            if (err) {
                handleException(err);
                return interaction.reply({ content: "Erreur création pari.", flags: MessageFlags.Ephemeral });
            }
            const betId = this.lastID;

            const embed = new EmbedBuilder()
                .setTitle(`Nouveau Pari d'Estimation #${betId}: ${question}`)
                .setDescription(`Cliquez sur le bouton ci-dessous pour proposer votre estimation !\nLe gagnant sera celui qui sera le plus proche du résultat.\n\n**Participations:**\n(Aucune pour le moment)`)
                .setColor(0x00ffaa) // Teal color for differentiation
                .setFooter({ text: `Créé par ${interaction.user.username}` });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`bet_estimate_join|${betId}`)
                    .setLabel(`Proposer une estimation`)
                    .setStyle(ButtonStyle.Primary)
            );

            const resolveRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`bet_resolve_modal|${betId}`)
                    .setLabel("Déclarer le résultat")
                    .setStyle(ButtonStyle.Secondary)
            );

            const roleId = process.env.DISCORD_BET_ROLE_ID;
            const content = roleId ? `<@&${roleId}>` : undefined;

            interaction.reply({ content, embeds: [embed], components: [row, resolveRow] });
        }
    );
}
