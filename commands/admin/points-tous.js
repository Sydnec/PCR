import { applyMovements } from "../../modules/economy.js";
import { fetchRoleMembers } from "../../modules/members.js";
import { log } from "../../modules/utils.js";

// Distribue le même montant à tous les porteurs du rôle par défaut.
export default {
  describe: (sub) =>
    sub
      .setName("points-tous")
      .setDescription("Donne (ou retire) des points à tous les membres du serveur")
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

    const { role, members, reason } = await fetchRoleMembers(interaction.guild);
    if (reason) return interaction.editReply({ content: `❌ ${reason}` });

    const failures = await applyMovements(
      members.map((member) => ({ userId: member.id, amount }))
    );
    const done = members.length - failures;

    log(
      `/admin points-tous par ${interaction.user.username} : ${amount > 0 ? "+" : ""}${amount} à ${done} membre(s) du rôle ${role.name}`
    );
    await interaction
      .editReply({
        content:
          `✅ **${amount > 0 ? "+" : ""}${amount}** points pour **${done}** membre(s) du rôle **${role.name}**.\n` +
          `Total distribué : **${amount * done}** points.` +
          (done < members.length ? `\n⚠️ ${members.length - done} échec(s), voir les logs.` : ""),
      })
      .catch(() => {});
  },
};
