import {
  configChoices,
  configOverrideStatus,
  formatConfigValue,
  listConfigEntries,
  previewConfigValue,
  readConfigValue,
} from "../../modules/config.js";

// Un champ de message Discord plafonne à 2000 caractères ; on s'arrête avant.
const MAX_BODY = 1800;

// Liste les feuilles sous un préfixe, tronquée. Sans préfixe, c'est tout le
// fichier ; avec, c'est une branche. Les deux cas passent par ici : afficher une
// branche via formatConfigValue produisait un bloc JSON de près de 4 000
// caractères, que Discord refusait purement et simplement.
function listBranch(prefix) {
  const entries = listConfigEntries(prefix).filter(
    (entry) => !prefix || entry.path === prefix || entry.path.startsWith(`${prefix}.`)
  );
  let body = "";
  let shown = 0;
  for (const { path, current } of entries) {
    const line = `\`${path}\` = ${previewConfigValue(current)}`;
    if (body.length + line.length + 1 > MAX_BODY) break;
    body += `${line}\n`;
    shown++;
  }
  const rest = entries.length - shown;
  return body + (rest > 0 ? `\n*et ${rest} autre(s) — précise une clé pour les voir.*` : "");
}

export default {
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
    // Une surcharge illisible fait retomber tout sur les défauts sans un mot :
    // c'est précisément ici qu'on viendrait constater qu'un réglage « n'a pas
    // pris », et c'est donc ici qu'il faut le dire.
    const statut = configOverrideStatus();
    const alerte = statut.ok ? "" : `${statut.reason}\n\n`;
    const key = interaction.options.getString("cle") ?? "";
    if (!key) return interaction.editReply({ content: alerte + listBranch("") });

    const result = readConfigValue(key);
    if (!result.ok) return interaction.editReply({ content: alerte + `❌ ${result.reason}` });
    if (result.type === "objet") {
      return interaction.editReply({
        content: `${alerte}**\`${result.path}\`**\n${listBranch(result.path)}`,
      });
    }

    const identical = JSON.stringify(result.current) === JSON.stringify(result.fallback);
    await interaction
      .editReply({
        content:
          alerte +
          `\`${result.path}\`\n` +
          `Actuel : ${formatConfigValue(result.current)}\n` +
          (identical
            ? "*(c'est la valeur par défaut)*"
            : `Défaut : ${formatConfigValue(result.fallback)}`),
      })
      .catch(() => {});
  },
};
