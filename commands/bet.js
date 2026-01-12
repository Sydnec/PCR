import {
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { handleException } from "../modules/utils.js";
import db from "../modules/points-db.js";

export default {
  data: new SlashCommandBuilder()
    .setName("bet")
    .setDescription("Créer un nouveau pari")
    .addStringOption((option) =>
      option
        .setName("question")
        .setDescription("La question du pari")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("option1").setDescription("Option 1").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("option2").setDescription("Option 2").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("option3").setDescription("Option 3").setRequired(false)
    )
    .addStringOption((option) =>
      option.setName("option4").setDescription("Option 4").setRequired(false)
    )
    .addStringOption((option) =>
      option.setName("option5").setDescription("Option 5").setRequired(false)
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
  const options = [];
  for (let i = 1; i <= 5; i++) {
    const opt = interaction.options.getString(`option${i}`);
    if (opt) options.push(opt);
  }

  if (options.length < 2) {
    return interaction.reply({
      content: "Il faut au moins 2 options pour créer un pari.",
      flags: MessageFlags.Ephemeral,
    });
  }

  db.run(
    "INSERT INTO bets (creator_id, title) VALUES (?, ?)",
    [interaction.user.id, question],
    function (err) {
      if (err) {
        handleException(err);
        return interaction.reply({
          content: "Erreur création pari.",
          flags: MessageFlags.Ephemeral,
        });
      }
      const betId = this.lastID;

      const stmt = db.prepare(
        "INSERT INTO bet_options (bet_id, option_index, label) VALUES (?, ?, ?)"
      );
      options.forEach((opt, index) => {
        stmt.run(betId, index + 1, opt);
      });
      stmt.finalize();

      let optionsText = options.map((opt, i) => `${i + 1}. ${opt}`).join("\n");

      const embed = new EmbedBuilder()
        .setTitle(`Nouveau Pari #${betId}: ${question}`)
        .setDescription(
          `Cliquez sur les boutons ci-dessous pour participer !\n\n**Options:**\n${optionsText}`
        )
        .setColor(0x00ff00)
        .setFooter({ text: `Créé par ${interaction.user.username}` });

      const row = new ActionRowBuilder();
      options.forEach((opt, index) => {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`bet_join|${betId}|${index + 1}`)
            .setLabel(`${index + 1}. ${opt}`)
            .setStyle(ButtonStyle.Primary)
        );
      });

      const resolveRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`bet_resolve_modal|${betId}`)
          .setLabel("Déclarer le résultat")
          .setStyle(ButtonStyle.Secondary)
      );

      const roleId = process.env.DISCORD_BET_ROLE_ID;
      const content = roleId ? `<@&${roleId}>` : undefined;

      interaction.reply({
        content,
        embeds: [embed],
        components: [row, resolveRow],
      });
    }
  );
}
