import { addPoints, getBalance } from "../../modules/economy.js";
import { log } from "../../modules/utils.js";

// Offre — ou retire — des points à un dresseur. Le montant négatif est accepté
// tel quel : addPoints n'a pas de plancher, un solde peut donc passer sous zéro.
// C'est volontaire, un solde négatif bloquant tous les achats jusqu'à ce qu'il
// remonte.
export default {
  describe: (sub) =>
    sub
      .setName("points")
      .setDescription("Donne (ou retire) des points à un dresseur")
      .addUserOption((option) =>
        option.setName("membre").setDescription("Le dresseur concerné").setRequired(true)
      )
      .addIntegerOption((option) =>
        option
          .setName("montant")
          .setDescription("Positif pour donner, négatif pour retirer")
          .setRequired(true)
      ),

  async execute(interaction) {
    const target = interaction.options.getUser("membre");
    const amount = interaction.options.getInteger("montant");

    if (amount === 0) {
      return interaction.editReply({ content: "❌ Un montant de 0 ne changerait rien." });
    }

    // Les helpers d'économie sont à callbacks ; les erreurs remontent au
    // routeur, qui les journalise et répond, plutôt que d'être avalées ici.
    const before = await new Promise((resolve, reject) =>
      getBalance(target.id, (err, balance) => (err ? reject(err) : resolve(balance)))
    );
    await new Promise((resolve, reject) =>
      addPoints(target.id, amount, (err) => (err ? reject(err) : resolve()))
    );

    const after = before + amount;
    log(
      `/admin points par ${interaction.user.username} : ${amount > 0 ? "+" : ""}${amount} à ${target.username} (solde ${before} → ${after})`
    );
    await interaction
      .editReply({
        content:
          `✅ **${amount > 0 ? "+" : ""}${amount}** points pour **${target.username}**.\n` +
          `Solde : **${before}** → **${after}**` +
          (after < 0 ? " ⚠️ négatif, ses achats sont bloqués jusqu'à ce qu'il remonte." : ""),
      })
      .catch(() => {});
  },
};
