import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import { siteUrl } from "../../modules/web/server.js";

// Le lien du site, en privé : il n'intéresse que celui qui le demande, et le
// salon n'a pas à se remplir d'adresses. Les chevrons évitent l'aperçu que
// Discord accrocherait sous le lien.
export default {
  describe: (sub) =>
    sub.setName("web").setDescription("Le lien du site PokéPCR : capture, parc safari, boîte PC…"),

  async execute(interaction) {
    try {
      const url = siteUrl();
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
