import {
  configChoices,
  formatConfigValue,
  listConfigPaths,
  readConfigValue,
} from "../../modules/config.js";

export default {
  name: "config-voir",
  describe: (sub) =>
    sub
      .setName("config-voir")
      .setDescription("Affiche un réglage — ou une branche entière — et sa valeur par défaut")
      .addStringOption((option) =>
        option
          .setName("cle")
          .setDescription("Le réglage ou la branche (tout si absent)")
          .setRequired(false)
          .setAutocomplete(true)
      ),

  async autocomplete(interaction) {
    await interaction.respond(configChoices(interaction.options.getFocused())).catch(() => {});
  },

  async execute(interaction) {
    // Sans clé, on montre la racine : les deux branches du fichier.
    const key = interaction.options.getString("cle") ?? "";
    const result = key
      ? readConfigValue(key)
      : { ok: true, path: "(tout)", current: undefined, fallback: undefined };

    if (!result.ok) return interaction.editReply({ content: `❌ ${result.reason}` });

    if (!key) {
      const lines = listConfigPaths("").map(({ path }) => {
        const { current } = readConfigValue(path);
        return `\`${path}\` = ${Array.isArray(current) ? current.join(",") : current}`;
      });
      // Un champ Discord plafonne à 2000 caractères : on coupe proprement.
      let body = "";
      let shown = 0;
      for (const line of lines) {
        if (body.length + line.length + 1 > 1800) break;
        body += `${line}\n`;
        shown++;
      }
      const rest = lines.length - shown;
      return interaction.editReply({
        content: body + (rest > 0 ? `\n*et ${rest} autre(s) — précise une clé pour les voir.*` : ""),
      });
    }

    const identical = JSON.stringify(result.current) === JSON.stringify(result.fallback);
    await interaction
      .editReply({
        content:
          `\`${result.path}\`\n` +
          `Actuel : ${formatConfigValue(result.current)}\n` +
          (identical ? "*(c'est la valeur par défaut)*" : `Défaut : ${formatConfigValue(result.fallback)}`),
      })
      .catch(() => {});
  },
};
