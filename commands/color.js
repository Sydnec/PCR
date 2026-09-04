import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException, log } from "../modules/utils.js";
import dotenv from "dotenv";
dotenv.config(); // process.env.CONSTANT

// Le code est repris tel quel dans le nom d'un rôle créé à la volée. Sans
// validation, n'importe quelle chaîne devenait un nom de rôle : un membre
// pouvait saturer le serveur (250 rôles maximum) et y glisser du texte
// arbitraire. On n'accepte donc que six chiffres hexadécimaux.
const HEX_COLOR = /^[0-9A-F]{6}$/;

// Forme courte #ABC, que Discord n'accepte pas : on la déplie en #AABBCC.
const SHORT_HEX_COLOR = /^[0-9A-F]{3}$/;

function parseHexColor(input) {
  const code = String(input).trim().replace(/^#/, "").toUpperCase();
  if (HEX_COLOR.test(code)) return code;
  if (SHORT_HEX_COLOR.test(code)) {
    return code
      .split("")
      .map((char) => char + char)
      .join("");
  }
  return null;
}

export default {
  data: new SlashCommandBuilder()
    .setName("color")
    .setDescription("Changer la couleur de votre pseudo")
    .addStringOption((option) =>
      option
        .setName("hexa")
        .setDescription("code hexadécimal de la couleur (ex: #A020F0)")
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const code = parseHexColor(interaction.options.getString("hexa"));
      if (!code) {
        await interaction.editReply({
          content:
            "❌ Code couleur invalide. Utilise un hexadécimal, par exemple `#A020F0` ou `#A2F`.",
        });
        return;
      }

      const member = interaction.member;
      const guild = interaction.guild;
      if (!member || !guild) {
        await interaction.editReply({
          content: "❌ Cette commande doit être utilisée dans un serveur.",
        });
        return;
      }

      const anchorRole = guild.roles.cache.get(process.env.COLOR_ROLE_ID);
      if (!anchorRole) {
        await interaction.editReply({
          content: "❌ `COLOR_ROLE_ID` n'est pas configuré correctement.",
        });
        return;
      }

      // Retrait des anciennes couleurs, séquentiel et attendu : l'ancienne
      // version lançait tous les retraits en parallèle sans les attendre, puis
      // répondait avant que le moindre rôle ne soit retiré.
      const previousColorRoles = member.roles.cache.filter((role) =>
        role.name.startsWith("&")
      );
      for (const role of previousColorRoles.values()) {
        try {
          await member.roles.remove(role);
          log(`Role ${role.name} retiré de ${member.displayName} avec succès.`);
          // Le cache des membres est souvent partiel : on ne supprime le rôle
          // que si le serveur confirme qu'il ne reste plus personne dessus.
          const holders = await guild.members.fetch();
          const stillUsed = holders.some((m) => m.roles.cache.has(role.id));
          if (!stillUsed && role.editable) await role.delete();
        } catch (err) {
          handleException(err);
        }
      }

      let coloredRole = guild.roles.cache.find((r) => r.name === "&" + code);
      if (!coloredRole) {
        coloredRole = await guild.roles.create({
          name: "&" + code,
          color: `#${code}`,
          position: anchorRole.position,
          reason: `Couleur demandée par ${member.user.tag}`,
        });
      }

      await member.roles.add(coloredRole);
      await interaction.editReply({
        content: "Ça y est, tu es tout.e beau/belle",
      });
    } catch (error) {
      handleException(error);
      // Sans cette branche, une erreur laissait l'interaction différée sans
      // réponse et Discord affichait « L'application n'a pas répondu ».
      await interaction
        .editReply({
          content: "❌ Une erreur est survenue lors du changement de couleur.",
        })
        .catch(() => {});
    }
  },
};
