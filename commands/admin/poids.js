import { EmbedBuilder, MessageFlags } from "discord.js";
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
// quand l'événement est rare — et seulement là. Au-dessus d'une chance sur deux,
// l'arrondi écrit « 1/1 », qui se lit « à tous les coups » et qui est faux : le
// pourcentage de la colonne d'à côté dit déjà tout ce qu'il y a à dire.
const surN = (probability) =>
  probability > 0 && probability <= 0.5 ? `1/${entier(Math.round(1 / probability))}` : "—";

// Les lignes d'un tableau, en-tête et total compris, alignées pour un bloc de
// code. Un objet à poids nul (un charme, un objet d'une génération fermée)
// n'y figure pas : il n'est pas dans le tirage, et la phrase sous le titre le
// nomme. Une catégorie d'espèces à poids nul reste, marquée « hors pool » :
// elle dit combien d'espèces ne sortent jamais.
function tableLines(table) {
  const gate = table.gate?.chance ?? 1;
  const multiple = table.rows.some((r) => r.count > 1);
  const rows = multiple ? table.rows : table.rows.filter((r) => r.weight > 0);

  const head = multiple
    ? [table.subject, "espèces", "poids", "total", "part", "par espèce"]
    : [table.subject, "poids", ...(table.lots ? ["lot"] : []), "part", "au tirage", "soit"];

  const lines = rows.map((r) =>
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
          ...(table.lots ? [r.lot ?? "1"] : []),
          pourcent(r.share, 1),
          pourcent(gate * r.share, 3),
          surN(gate * r.share),
        ]
  );

  const totalLine = multiple
    ? ["TOTAL", entier(table.rows.reduce((s, r) => s + r.count, 0)), "", entier(table.total), "100 %", ""]
    : [
        "TOTAL",
        entier(table.total),
        ...(table.lots ? [""] : []),
        "100 %",
        pourcent(gate, 3),
        surN(gate),
      ];

  const all = [head, ...lines, totalLine];
  // Largeur par colonne, déduite du contenu : la première à gauche, les
  // chiffres à droite, comme dans n'importe quel tableau de chiffres.
  const widths = head.map((_, i) => Math.max(...all.map((l) => l[i].length)));
  const format = (cells) =>
    cells
      .map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i])))
      .join("  ")
      .trimEnd();
  return { head: format(head), body: [...lines, totalLine].map(format) };
}

// Discord refuse un champ de plus de 1 024 caractères, et tout le message
// au-delà de 6 000 : la loterie y est arrivée à force d'objets. Un tableau trop
// long se poursuit donc dans un champ « suite », en-tête répété, et les champs
// se répartissent en autant de messages qu'il faut.
const FIELD_MAX = 1024;
const MESSAGE_MAX = 6000;

function tableFields(table) {
  const gate = table.gate ? ` — **${pourcent(table.gate.chance, 0)}** ${table.gate.label}` : "";
  const outside = table.rows.some((r) => r.count > 1)
    ? []
    : table.rows.filter((r) => r.weight <= 0).map((r) => r.label);
  const intro =
    `*${table.note}*${gate}` + (outside.length ? `\nHors tirage : ${outside.join(", ")}.` : "");
  const { head, body } = tableLines(table);

  const fields = [];
  let prefix = `${intro}\n`;
  let chunk = [];
  const block = (lines) => ["```", head, ...lines, "```"].join("\n");
  const close = () =>
    fields.push({
      name: fields.length ? `${table.name} (suite)` : table.name,
      value: prefix + block(chunk),
      inline: false,
    });
  for (const line of body) {
    if (chunk.length && (prefix + block([...chunk, line])).length > FIELD_MAX) {
      close();
      prefix = "";
      chunk = [];
    }
    chunk.push(line);
  }
  close();
  return fields;
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
            { name: "Butin des Pokémon", value: "butin" },
            { name: "Loterie quotidienne", value: "loterie" }
          )
      ),

  async execute(interaction) {
    const choisie = interaction.options.getString("table");
    const tables = describeWeightTables().filter((t) => !choisie || t.key === choisie);

    if (!tables.length) {
      return interaction.editReply({ content: "❌ Table inconnue." });
    }

    const title = "⚖️ Tables de tirage pondéré";
    const description =
      "Un poids n'est pas un pourcentage : c'est une part du total de sa table. " +
      "Doubler un poids ne double donc pas tout à fait son taux — il grossit " +
      "aussi le total, et dilue légèrement les autres lignes.";
    const footer = "Tout se règle via /admin config, à chaud.";

    // Un message par tranche de 6 000 caractères : le premier porte le titre
    // et l'explication, le dernier le pied de page.
    const messages = [];
    let fields = [];
    let size = title.length + description.length + footer.length;
    for (const field of tables.flatMap(tableFields)) {
      const cost = field.name.length + field.value.length;
      if (fields.length && (size + cost > MESSAGE_MAX || fields.length === 25)) {
        messages.push(fields);
        fields = [];
        size = footer.length;
      }
      fields.push(field);
      size += cost;
    }
    messages.push(fields);

    const embeds = messages.map((list, index) => {
      const embed = new EmbedBuilder().setColor(0x5865f2).addFields(list);
      if (index === 0) embed.setTitle(title).setDescription(description);
      if (index === messages.length - 1) embed.setFooter({ text: footer });
      return embed;
    });
    await interaction.editReply({ embeds: [embeds[0]] }).catch(() => {});
    for (const embed of embeds.slice(1)) {
      await interaction
        .followUp({ embeds: [embed], flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  },
};
