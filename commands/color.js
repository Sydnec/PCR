import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException, log } from "../modules/utils.js";
import dotenv from "dotenv";
dotenv.config(); // process.env.CONSTANT

export default {
  data: new SlashCommandBuilder()
    .setName("color")
    .setDescription("Changer la couleur de votre pseudo")
    .addStringOption((option) =>
      option
        .setName("hexa")
        .setDescription("code hexadécimal de la couleur")
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.member;
    const guild = interaction.guild;
    const code = interaction.options
      .getString("hexa")
      .replace("#", "")
      .toUpperCase();

    // Validation stricte : la saisie sert à créer un rôle, dont le nom est
    // « &<code> ». Sans contrôle, n'importe quelle chaîne créait un rôle
    // arbitraire, et il suffisait de répéter la commande pour saturer le
    // serveur (250 rôles maximum) avec des rôles impossibles à nettoyer.
    if (!/^[0-9A-F]{6}$/.test(code)) {
      await interaction.editReply({
        content:
          "❌ Code invalide : donne un code hexadécimal à 6 chiffres, par exemple `#A020F0`.",
      });
      return;
    }

    user.roles.cache
      .filter((role) => role.name.startsWith("&"))
      .forEach((role) => {
        user.roles
          .remove(role)
          .then(() => {
            log(`Role ${role.name} retiré de ${user.displayName} avec succès.`);
            const count = guild.members.cache.filter((member) =>
              member.roles.cache.has(role.id)
            ).size;
            if (count <= 1) {
              role.delete();
            }
          })
          .catch(handleException);
      });
    try {
      let coloredRole = guild.roles.cache.find((r) => r.name === "&" + code);
      if (!coloredRole) {
        const colorRole = guild.roles.cache.get(process.env.COLOR_ROLE_ID);
        coloredRole = await guild.roles.create({
          name: "&" + code,
          color: `#${code}`,
          position: colorRole?.position,
          reason: `/color demandé par ${interaction.user.tag}`,
        });
      }
      await user.roles.add(coloredRole);
      await interaction.editReply({
        content: "Ça y est, tu es tout.e beau/belle",
      });
    } catch (error) {
      handleException(error);
      await interaction
        .editReply({
          content: "❌ Impossible d'appliquer cette couleur pour le moment.",
        })
        .catch(() => {});
    }
  },
};
