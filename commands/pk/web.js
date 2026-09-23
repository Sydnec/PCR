import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import { siteAccessDenial, siteUrl } from "../../modules/web/server.js";

// Le lien du site, en privé : il n'intéresse que celui qui le demande, et le
// salon n'a pas à se remplir d'adresses. Les chevrons évitent l'aperçu que
// Discord accrocherait sous le lien.
//
// Qui n'a pas le rôle du site apprend ici qu'il ne pourra pas y entrer, plutôt
// que devant la connexion. Si Discord ne répond pas, le lien part quand même :
// le site refera la vérification.
export default {
  describe: (sub) =>
    sub.setName("web").setDescription("Le lien du site PokéPCR : capture, parc safari, boîte PC…"),

  async execute(interaction) {
    try {
      const url = siteUrl();
      const denial = url
        ? await siteAccessDenial(interaction.client, interaction.user.id).catch((error) => {
            handleException("/pk web, lecture du membre :", error);
            return null;
          })
        : null;
      if (denial) {
        const role = interaction.guild?.roles.cache.get(process.env.DEFAULT_ROLE_ID);
        return interaction
          .reply({
            content: role
              ? `❌ Le site est réservé aux membres qui ont le rôle **${role.name}**.`
              : "❌ Le site est réservé aux membres du serveur.",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      }
      await interaction
        .reply({
          content: url
            ? `🖥️ Le jeu dans ton navigateur : <${url}>\nTu t'y connectes avec ton compte Discord.`
            : "❌ Le site n'est pas en ligne pour le moment.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    } catch (error) {
      handleException(error);
    }
  },
};
