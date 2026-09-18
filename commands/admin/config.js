import { log } from "../../modules/utils.js";
import { configChoices, formatConfigValue, writeConfigValue } from "../../modules/config.js";

export default {
  describe: (sub) =>
    sub
      .setName("config")
      .setDescription("Modifie un réglage du bot, appliqué immédiatement")
      .addStringOption((option) =>
        option
          .setName("cle")
          .setDescription("Le réglage à modifier")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName("valeur")
          .setDescription("La nouvelle valeur (liste : séparée par des virgules)")
          .setRequired(true)
      ),

  async autocomplete(interaction) {
    await interaction.respond(configChoices(interaction.options.getFocused())).catch(() => {});
  },

  async execute(interaction) {
    const key = interaction.options.getString("cle");
    const raw = interaction.options.getString("valeur");

    const result = writeConfigValue(key, raw);
    if (!result.ok) {
      return interaction.editReply({ content: `❌ ${result.reason}` });
    }

    log(
      `/admin config par ${interaction.user.username} : ${result.path} ${JSON.stringify(result.before)} → ${JSON.stringify(result.after)}`
    );
    await interaction
      .editReply({
        content:
          `✅ \`${result.path}\`\n` +
          `${formatConfigValue(result.before)} → ${formatConfigValue(result.after)}\n` +
          "Appliqué immédiatement : la config est relue à chaque usage.",
      })
      .catch(() => {});
  },
};
