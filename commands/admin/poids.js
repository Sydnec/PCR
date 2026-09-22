import { EmbedBuilder } from "discord.js";
import { describeWeightTables } from "../../modules/pokemon/weights.js";

// Les tables de tirage pondéré, converties en probabilités.
//
// Un poids ne se lit pas : 400 ne veut rien dire tant qu'on ne connaît pas la
// somme des autres, et cette somme bouge dès qu'on ajoute une ligne. Doubler un
// poids ne double donc pas tout à fait son taux, puisqu'il grossit aussi le
// total. Cette commande fait la conversion, pour qu'un réglage se décide sur le
// chiffre qu'on cherche à obtenir plutôt qu'à tâtons.
//
// Tout passe par un bloc de code : les colonnes doivent s'aligner, et une
// police à chasse fixe est le seul moyen de le garantir sur Discord. C'est aussi
// pourquoi les libellés y sont en toutes lettres — un emoji personnalisé ne
// s'affiche pas dans un bloc de code.
const pourcent = (value, decimals = 2) =>
  `${(value * 100).toFixed(decimals).replace(".", ",")} %`;

// Le séparateur de milliers du format fr-FR est une espace insécable ÉTROITE
// (U+202F). Elle compte pour un caractère dans String.length, qui sert à calculer
// les largeurs, mais ne vaut pas une cellule en chasse fixe : toutes les lignes
// à quatre chiffres décalaient leurs colonnes de droite. On la ramène à une
// espace ordinaire, qui vaut exactement une cellule.
const entier = (value) => value.toLocaleString("fr-FR").replace(/[\u202F\u00A0]/g, " ");

// « une chance sur N », qui se lit mieux qu'un pourcentage à trois décimales
// quand l'événement est rare.
const surN = (probability) =>
  probability > 0 ? `1/${entier(Math.round(1 / probability))}` : "—";

function renderTable(table) {
  const gate = table.gate?.chance ?? 1;
  const multiple = table.rows.some((r) => r.count > 1);

  const head = multiple
    ? [table.subject, "espèces", "poids", "total", "part", "par espèce"]
    : [table.subject, "poids", "part", "au tirage", "soit"];

  // Un poids nul n'est pas « 0,0 % de chances » : la ligne est simplement hors
  // du tirage, que ce soit une évolution par échange ou un objet de collection.
  // Afficher un pourcentage lui donnerait l'air d'être dans le pool.
  const lines = table.rows.map((r) =>
    multiple
      ? [
          r.label,
          entier(r.count),
          entier(r.weight),
          entier(r.total),
          r.weight > 0 ? pourcent(r.share, 1) : "hors pool",
          r.weight > 0 ? pourcent(r.unitShare) : "—",
        ]
      : [
          r.label,
          entier(r.weight),
          r.weight > 0 ? pourcent(r.share, 1) : "hors pool",
          r.weight > 0 ? pourcent(gate * r.share, 3) : "—",
          r.weight > 0 ? surN(gate * r.share) : "—",
        ]
  );

  const totalLine = multiple
    ? ["TOTAL", entier(table.rows.reduce((s, r) => s + r.count, 0)), "", entier(table.total), "100 %", ""]
    : ["TOTAL", entier(table.total), "100 %", pourcent(gate, 3), surN(gate)];

  const all = [head, ...lines, totalLine];
  // Largeur par colonne, déduite du contenu : la première à gauche, les
  // chiffres à droite, comme dans n'importe quel tableau de chiffres.
  const widths = head.map((_, i) => Math.max(...all.map((l) => l[i].length)));
  const format = (cells) =>
    cells
      .map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i])))
      .join("  ")
      .trimEnd();

  return [
    "```",
    format(head),
    ...lines.map(format),
    format(totalLine),
    "```",
  ].join("\n");
}

export default {
  describe: (sub) =>
    sub
      .setName("poids")
      .setDescription("Convertit les poids de tirage en probabilités réelles")
      .addStringOption((option) =>
        option
          .setName("table")
          .setDescription("Une seule table, au lieu de toutes")
          .setRequired(false)
          .addChoices(
            { name: "Apparitions sauvages", value: "spawn" },
            { name: "Rencontres du parc safari", value: "safari" },
            { name: "Butin des Pokémon", value: "butin" }
          )
      ),

  async execute(interaction) {
    const choisie = interaction.options.getString("table");
    const tables = describeWeightTables().filter((t) => !choisie || t.key === choisie);

    if (!tables.length) {
      return interaction.editReply({ content: "❌ Table inconnue." });
    }

    const embed = new EmbedBuilder()
      .setTitle("⚖️ Tables de tirage pondéré")
      .setColor(0x5865f2)
      .setDescription(
        "Un poids n'est pas un pourcentage : c'est une part du total de sa table. " +
          "Doubler un poids ne double donc pas tout à fait son taux — il grossit " +
          "aussi le total, et dilue légèrement les autres lignes."
      );

    for (const table of tables) {
      const gate = table.gate
        ? ` — **${pourcent(table.gate.chance, 0)}** ${table.gate.label}`
        : "";
      embed.addFields({
        name: table.name,
        value: `*${table.note}*${gate}\n${renderTable(table)}`,
        inline: false,
      });
    }

    embed.setFooter({ text: "Tout se règle via /admin config, à chaud." });
    await interaction.editReply({ embeds: [embed] }).catch(() => {});
  },
};
