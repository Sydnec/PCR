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
    await interaction.deferReply({ ephemeral: true });
    const user = interaction.member;
    const guild = interaction.guild;
    const code = interaction.options
      .getString("hexa")
      .replace("#", "")
      .toUpperCase();
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
    let coloredRole = guild.roles.cache.find((r) => r.name === "&" + code);
    if (!coloredRole) {
      const colorRole = guild.roles.cache.get(process.env.COLOR_ROLE_ID);
      coloredRole = await guild.roles.create({
        name: "&" + code,
        color: code,
        position: colorRole.position,
      });
    }
    user.roles.add(coloredRole);
    await interaction.editReply({
      content: "Ça y est, tu es tout.e beau/belle",
    });
  },
};
