import { addPoints, applyMovements, getBalance } from "../../modules/economy.js";
import { resolveTarget } from "../../modules/members.js";
import { log } from "../../modules/utils.js";

const signed = (amount) => `${amount > 0 ? "+" : ""}${amount.toLocaleString("fr-FR")}`;

// Offre — ou retire — des points à un dresseur, ou à tous les porteurs d'un
// rôle. Le montant négatif est accepté tel quel : addPoints n'a pas de plancher,
// un solde peut donc passer sous zéro. C'est volontaire, un solde négatif
// bloquant tous les achats jusqu'à ce qu'il remonte.
export default {
  describe: (sub) =>
    sub
      .setName("points")
      .setDescription("Donne (ou retire) des points à un dresseur ou à tout un rôle")
      .addMentionableOption((option) =>
        option
          .setName("cible")
          .setDescription("Un dresseur, ou un rôle pour servir tous ceux qui le portent")
          .setRequired(true)
      )
      .addIntegerOption((option) =>
        option
          .setName("montant")
          .setDescription("Positif pour donner, négatif pour retirer")
          .setRequired(true)
      ),

  async execute(interaction) {
    const amount = interaction.options.getInteger("montant");
    if (amount === 0) {
      return interaction.editReply({ content: "❌ Un montant de 0 ne changerait rien." });
    }

    const { user, role, members, reason } = await resolveTarget(interaction);
    if (reason) return interaction.editReply({ content: `❌ ${reason}` });

    if (role) {
      // Une transaction pour tout le rôle, comme le pot commun : une
      // distribution interrompue à mi-chemin ne doit servir personne à moitié.
      const failures = await applyMovements(
        members.map((member) => ({ userId: member.id, amount }))
      );
      const done = members.length - failures;
      log(
        `/admin points par ${interaction.user.username} : ${signed(amount)} à ${done} membre(s) du rôle ${role.name}`
      );
      return interaction
        .editReply({
          content:
            `✅ **${signed(amount)}** points pour **${done}** membre(s) du rôle **${role.name}**.\n` +
            `Total distribué : **${signed(amount * done)}** points.` +
            (failures ? `\n⚠️ ${failures} échec(s), voir les logs.` : ""),
        })
        .catch(() => {});
    }

    // Les helpers d'économie sont à callbacks ; les erreurs remontent au
    // routeur, qui les journalise et répond, plutôt que d'être avalées ici.
    const before = await new Promise((resolve, reject) =>
      getBalance(user.id, (err, balance) => (err ? reject(err) : resolve(balance)))
    );
    await new Promise((resolve, reject) =>
      addPoints(user.id, amount, (err) => (err ? reject(err) : resolve()))
    );

    const after = before + amount;
    log(
      `/admin points par ${interaction.user.username} : ${signed(amount)} à ${user.username} (solde ${before} → ${after})`
    );
    await interaction
      .editReply({
        content:
          `✅ **${signed(amount)}** points pour **${user.username}**.\n` +
          `Solde : **${before.toLocaleString("fr-FR")}** → **${after.toLocaleString("fr-FR")}**` +
          (after < 0 ? " ⚠️ négatif, ses achats sont bloqués jusqu'à ce qu'il remonte." : ""),
      })
      .catch(() => {});
  },
};
