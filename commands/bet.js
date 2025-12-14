import { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { handleException } from "../modules/utils.js";
import db from "../modules/points-db.js";

export default {
  data: new SlashCommandBuilder()
    .setName("bet")
    .setDescription("Système de paris")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("create")
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
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("join")
        .setDescription("Participer à un pari (Alternative aux boutons)")
        .addIntegerOption((option) =>
          option
            .setName("id")
            .setDescription("L'ID du pari")
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("option")
            .setDescription("Le numéro de l'option choisie")
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("amount")
            .setDescription("Le montant de la mise")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("resolve")
        .setDescription("Terminer un pari (Créateur seulement)")
        .addIntegerOption((option) =>
          option
            .setName("id")
            .setDescription("L'ID du pari")
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("winner")
            .setDescription("Le numéro de l'option gagnante")
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "create") {
        await handleCreate(interaction);
      } else if (subcommand === "join") {
        await handleJoin(interaction);
      } else if (subcommand === "resolve") {
        await handleResolve(interaction);
      }
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
        return interaction.reply({ content: "Erreur création pari.", flags: MessageFlags.Ephemeral });
      }
      const betId = this.lastID;

      const stmt = db.prepare("INSERT INTO bet_options (bet_id, option_index, label) VALUES (?, ?, ?)");
      options.forEach((opt, index) => {
        stmt.run(betId, index + 1, opt);
      });
      stmt.finalize();

      let optionsText = options.map((opt, i) => `${i + 1}. ${opt}`).join("\n");
      
      const embed = new EmbedBuilder()
        .setTitle(`Nouveau Pari #${betId}: ${question}`)
        .setDescription(`Cliquez sur les boutons ci-dessous pour participer !\n\n**Options:**\n${optionsText}`)
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

      interaction.reply({ embeds: [embed], components: [row] });
    }
  );
}

async function handleJoin(interaction) {
  const betId = interaction.options.getInteger("id");
  const optionIndex = interaction.options.getInteger("option");
  const amount = interaction.options.getInteger("amount");
  const userId = interaction.user.id;

  if (amount <= 0) {
    return interaction.reply({ content: "La mise doit être positive.", flags: MessageFlags.Ephemeral });
  }

  // Check balance
  db.get("SELECT balance FROM points WHERE user_id = ?", [userId], (err, row) => {
    if (err) return handleException(err);
    const balance = row ? row.balance : 0;

    if (balance < amount) {
      return interaction.reply({
        content: `Vous n'avez pas assez de points. Solde: ${balance}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Check bet status and option validity
    db.get("SELECT status FROM bets WHERE id = ?", [betId], (err, bet) => {
      if (err || !bet) return interaction.reply({ content: "Pari introuvable.", flags: MessageFlags.Ephemeral });
      if (bet.status !== "OPEN") return interaction.reply({ content: "Ce pari est fermé.", flags: MessageFlags.Ephemeral });

      db.get("SELECT id FROM bet_options WHERE bet_id = ? AND option_index = ?", [betId, optionIndex], (err, opt) => {
        if (err || !opt) return interaction.reply({ content: "Option invalide.", flags: MessageFlags.Ephemeral });

        // Deduct points and add participation
        db.serialize(() => {
          db.run("UPDATE points SET balance = balance - ? WHERE user_id = ?", [amount, userId]);
          db.run(
            "INSERT INTO bet_participations (bet_id, user_id, option_index, amount) VALUES (?, ?, ?, ?)",
            [betId, userId, optionIndex, amount],
            (err) => {
              if (err) {
                // Refund if insert fails (e.g. already bet)
                db.run("UPDATE points SET balance = balance + ? WHERE user_id = ?", [amount, userId]);
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

async function handleResolve(interaction) {
  const betId = interaction.options.getInteger("id");
  const winnerIndex = interaction.options.getInteger("winner");
  const userId = interaction.user.id;

  db.get("SELECT * FROM bets WHERE id = ?", [betId], (err, bet) => {
    if (err || !bet) return interaction.reply({ content: "Pari introuvable.", flags: MessageFlags.Ephemeral });
    if (bet.creator_id !== userId) return interaction.reply({ content: "Seul le créateur peut terminer le pari.", flags: MessageFlags.Ephemeral });
    if (bet.status !== "OPEN") return interaction.reply({ content: "Ce pari est déjà terminé.", flags: MessageFlags.Ephemeral });

    db.get("SELECT label FROM bet_options WHERE bet_id = ? AND option_index = ?", [betId, winnerIndex], (err, winningOption) => {
      if (err || !winningOption) return interaction.reply({ content: "Option gagnante invalide.", flags: MessageFlags.Ephemeral });

      // Calculate results
      db.all("SELECT user_id, option_index, amount FROM bet_participations WHERE bet_id = ?", [betId], (err, parts) => {
        if (err) return handleException(err);

        const totalPool = parts.reduce((acc, p) => acc + p.amount, 0);
        const winners = parts.filter(p => p.option_index === winnerIndex);
        const totalWinningStakes = winners.reduce((acc, p) => acc + p.amount, 0);

        db.serialize(() => {
          db.run("UPDATE bets SET status = 'CLOSED', winning_option_index = ? WHERE id = ?", [winnerIndex, betId]);

          if (winners.length > 0) {
            winners.forEach(w => {
              // Share of the pool proportional to stake
              // Formula: (Stake / TotalWinningStakes) * TotalPool
              // Or simple odds? Usually pool betting is: return stake + (stake/totalWinning * totalLosing)
              // Here: (Stake / TotalWinningStakes) * TotalPool gives the total return (including stake)
              const share = Math.floor((w.amount / totalWinningStakes) * totalPool);
              db.run("UPDATE points SET balance = balance + ? WHERE user_id = ?", [share, w.user_id]);
            });
            interaction.reply(`Pari #${betId} terminé! L'option gagnante est **${winningOption.label}**. ${totalPool} points distribués aux gagnants.`);
          } else {
            interaction.reply(`Pari #${betId} terminé! L'option gagnante est **${winningOption.label}**. Aucun gagnant.`);
          }
        });
      });
    });
  });
}
