import {
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { handleException } from "../../modules/utils.js";
import {
  describeEvolution,
  getIndividuals,
  groupIndividuals,
  resolveSelector,
} from "../../modules/pokemon/collection.js";
import { embedColor, getSpecies, spriteUrl } from "../../modules/pokemon/data.js";
import { getInventory, getItem } from "../../modules/pokemon/items.js";
import {
  displayName,
  individualChoices,
  wantsIndividual,
} from "../../modules/pokemon/embeds.js";

// Discord n'autorise pas de liste vide accompagnée d'un message : une
// proposition inerte est le seul moyen d'expliquer pourquoi il n'y a rien à
// choisir. Sa valeur ne correspond à aucune espèce, donc execute() la refuse.
const HINT_VALUE = "0:0";

// Les objets d'évolution que ce dresseur a en assez grand nombre pour s'en
// servir. Trois bonbons ou rien : deux ne remplacent pas deux tiers d'un
// Pikachu.
function usableHelpers(userId, cb) {
  getInventory(userId, (err, rows) => {
    if (err) return cb(err, []);
    const helpers = [];
    for (const row of rows || []) {
      const item = getItem(row.item_key);
      if (item?.evolution && row.count >= (item.evolution.quantity ?? 1)) {
        helpers.push({ ...item, held: row.count });
      }
    }
    cb(null, helpers);
  });
}

// Ce qu'un groupe (espèce, variante, sexe) permet de payer. L'entrée entière
// fournit les doublons, quel que soit leur sexe ; le groupe fournit l'individu
// qui évolue. Le seul interdit est d'emmener le dernier de l'entrée, et
// `required` compte déjà l'exemplaire qui reste.
// `stock` : { total, count, spare } — l'entrée, puis le groupe.
const canPay = (plan, stock) =>
  !plan.error &&
  stock.total >= plan.required &&
  (plan.duplicates > 0 ? stock.spare >= 1 : stock.count >= 1);

// Toutes les façons de faire évoluer ce groupe, aides comprises. Chacune porte
// son propre plan : une pierre ne coûte pas ce que coûte un bonbon, et le
// nombre d'exemplaires requis change avec elle.
function evolutionPaths(speciesId, stock, helpers) {
  const paths = [];
  const base = describeEvolution(speciesId);
  if (canPay(base, stock)) paths.push({ plan: base, helper: null });

  for (const helper of helpers) {
    const plan = describeEvolution(speciesId, null, helper.key);
    // Une aide qui ne change rien à ce qui manque n'a pas à encombrer l'écran :
    // on ne la propose que si elle rend la fusion possible, ou moins chère.
    if (!canPay(plan, stock)) continue;
    if (!paths.length || plan.points < base.points || plan.required < base.required) {
      paths.push({ plan, helper });
    }
  }
  return paths;
}

// Le stock d'un groupe : l'entrée entière et, dedans, le groupe du sexe choisi
// — ou le seul individu désigné par son identifiant.
function stockOf(rows, speciesId, isShiny, sex, pokemonId = null) {
  const entry = rows.filter(
    (row) => row.species_id === speciesId && Boolean(row.is_shiny) === Boolean(isShiny)
  );
  const group = entry.filter((row) =>
    pokemonId ? row.id === pokemonId : !sex || row.sex === sex
  );
  return {
    total: entry.length,
    count: group.length,
    spare: Math.min(group.length, Math.max(0, entry.length - 1)),
  };
}

// Groupes (espèce, variante, sexe) que ce dresseur possède : ceux qu'il peut
// faire évoluer — par ses propres moyens ou avec un objet — et les entrées qui
// pourraient évoluer mais dont il manque des exemplaires. Le second lot sert à
// expliquer une liste vide au lieu de la laisser muette : c'est exactement ce
// qui faisait croire à une commande cassée.
function listEvolvable(userId, cb) {
  usableHelpers(userId, (err, helpers) => {
    if (err) return cb(err, [], []);
    getIndividuals(userId, (err, rows) => {
      if (err) return cb(err, [], []);
      const evolvable = [];
      const incomplete = [];
      for (const group of groupIndividuals(rows, { bySex: true })) {
        const stock = stockOf(rows, group.speciesId, group.isShiny, group.sex);
        const paths = evolutionPaths(group.speciesId, stock, helpers);
        if (paths.length) {
          evolvable.push({ ...group, stock, paths, plan: paths[0].plan });
        }
      }
      for (const entry of groupIndividuals(rows)) {
        if (evolvable.some((g) => g.speciesId === entry.speciesId && g.isShiny === entry.isShiny)) {
          continue;
        }
        const plan = describeEvolution(entry.speciesId);
        if (!plan.error) incomplete.push({ ...entry, plan });
      }
      // Les plus proches du seuil d'abord : ce sont les plus utiles à afficher.
      incomplete.sort((a, b) => b.count - a.count);
      cb(null, evolvable, incomplete);
    });
  });
}

export default {
  describe: (sub) =>
    sub
      .setName("evolution")
      .setDescription("Fait évoluer un Pokémon en sacrifiant des doublons")
      .addStringOption((option) =>
        option
          .setName("pokemon")
          .setDescription("Le Pokémon à faire évoluer (ou #numéro d'un Pokémon précis)")
          .setRequired(true)
          .setAutocomplete(true)
      ),

  async autocomplete(interaction) {
    const query = interaction.options.getFocused().toLowerCase();
    // « #123 » : un individu précis, qui peut évoluer et n'est pas le dernier de
    // son espèce. Les chiffres du coût se vérifient ensuite, sur l'écran de fusion.
    if (wantsIndividual(query)) {
      return getIndividuals(interaction.user.id, (err, rows) => {
        if (err) return interaction.respond([]).catch(() => {});
        const choices = individualChoices(
          rows,
          query,
          (row) => !row.last && !describeEvolution(row.species_id).error
        );
        interaction
          .respond(
            choices.length
              ? choices
              : [{ name: "Aucun Pokémon de ce numéro ne peut évoluer", value: HINT_VALUE }]
          )
          .catch(() => {});
      });
    }
    listEvolvable(interaction.user.id, async (err, entries, incomplete) => {
      if (err) {
        handleException("Autocomplétion d'évolution :", err);
        return interaction.respond([]).catch(() => {});
      }
      const label = (entry) => displayName(getSpecies(entry.speciesId), entry.isShiny, entry.sex);

      // Le sexe choisi est celui de l'individu qui évolue : il le garde.
      const choices = entries
        .map((entry) => ({
          name: `${label(entry)} (×${entry.count}, ${entry.stock.total} au total)`,
          value: entry.key,
        }))
        .filter((choice) => choice.name.toLowerCase().includes(query))
        .slice(0, 25);

      if (choices.length > 0) {
        return interaction.respond(choices).catch(() => {});
      }

      // Rien à proposer : on dit ce qui manque, espèce par espèce.
      const hints = incomplete
        .map((entry) => ({
          name: `⚠️ ${label(entry)} : ${entry.plan.required} exemplaires requis, tu en as ${entry.count}`,
          value: HINT_VALUE,
        }))
        .filter((choice) => choice.name.toLowerCase().includes(query))
        .slice(0, 25);

      await interaction
        .respond(
          hints.length
            ? hints
            : [
                {
                  name: "Aucun Pokémon de ta collection ne peut évoluer",
                  value: HINT_VALUE,
                },
              ]
        )
        .catch(() => {});
    });
  },

  async execute(interaction) {
    try {
      const selector = await new Promise((resolve, reject) =>
        resolveSelector(interaction.user.id, interaction.options.getString("pokemon"), (err, s) =>
          err ? reject(err) : resolve(s)
        )
      );
      if (selector.error) {
        return interaction.reply({ content: `\u274C ${selector.error}`, flags: MessageFlags.Ephemeral });
      }
      const { speciesId, isShiny, sex, pokemonId } = selector;
      if (!getSpecies(speciesId)) {
        return interaction.reply({
          content:
            "\u274C Choisis une proposition dans la liste d'autocomplétion.",
          flags: MessageFlags.Ephemeral,
        });
      }
      const plan = describeEvolution(speciesId);
      if (plan.error) {
        return interaction.reply({
          content: `\u274C ${plan.error}`,
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      usableHelpers(interaction.user.id, (err, helpers) => {
        if (err) {
          handleException("Lecture des objets d'évolution :", err);
          helpers = [];
        }
        // Ce que le dresseur possède vraiment décide des boutons affichés : une
        // fusion qu'il ne peut pas payer n'a pas à lui être proposée, et c'est
        // d'autant plus vrai depuis que les objets le font entrer dans cet
        // écran avec un exemplaire de moins que le minimum.
        getIndividuals(interaction.user.id, (err, individuals) => {
        if (err) handleException("Lecture de la collection pour /pk evolution :", err);
        const stock = stockOf(err ? [] : individuals, speciesId, isShiny, sex, pokemonId);
        const owned = stock.total;

        const species = plan.species;
        // Variante et sexe voyagent ensemble dans le deuxième segment du
        // customId : « 1F » pour une femelle shiny, « 0 » pour n'importe quel
        // sexe — le format d'avant, que les anciens boutons portent encore —,
        // ou « #123 » pour un individu précis.
        const suffix = pokemonId ? `#${pokemonId}` : `${isShiny ? 1 : 0}${sex ?? ""}`;
        const embed = new EmbedBuilder()
          .setTitle(
            `Évolution de ${pokemonId ? `#${pokemonId} ` : ""}${displayName(species, isShiny, sex)}`
          )
          .setColor(embedColor(species, isShiny))
          .setThumbnail(spriteUrl(species, isShiny))
          .setDescription(
            plan.branching
              ? `**${species.name}** peut évoluer en ${plan.targets
                  .map((target) => `**${target.name}**`)
                  .join(", ")}.\n\n` +
                  `Tu peux laisser le hasard décider, ou payer plus cher pour choisir.`
              : `**${species.name}** peut évoluer en **${plan.targets[0].name}**.`
          );

        // Le coût de la fusion ordinaire n'a sa place que si elle est
        // proposée : au-dessus d'un unique bouton « Pierre Feu → Pyroli
        // (gratuit) », annoncer « 2 doublons et 2000 points » se contredit.
        if (canPay(plan, stock)) {
          embed.addFields({
            name: "Coût",
            value:
              `**${plan.duplicates}** doublons consommés (il t'en faut **${plan.required}** au total, ` +
              `un exemplaire est toujours conservé) et **${plan.points}** points`,
            inline: false,
          });
        }

        const rows = [];
        const normale = new ActionRowBuilder();
        if (!canPay(plan, stock)) {
          // Rien du tout : ni les exemplaires, ni de quoi les remplacer.
        } else if (plan.branching) {
          normale.addComponents(
            new ButtonBuilder()
              .setCustomId(`poke_evo|${speciesId}|${suffix}|random`)
              .setLabel(`Évolution aléatoire (${plan.points} pts)`)
              .setEmoji("\u{1F3B2}")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`poke_evo|${speciesId}|${suffix}|choose`)
              .setLabel(
                `Choisir l'évolution (${describeEvolution(speciesId, plan.targets[0].id).points} pts)`
              )
              .setEmoji("\u{1F3AF}")
              .setStyle(ButtonStyle.Secondary)
          );
        } else {
          normale.addComponents(
            new ButtonBuilder()
              .setCustomId(`poke_evo|${speciesId}|${suffix}|random`)
              .setLabel(`Faire évoluer (${plan.points} pts)`)
              .setEmoji("\u2728")
              .setStyle(ButtonStyle.Success)
          );
        }
        if (normale.components.length) rows.push(normale);

        // Un bouton par objet utilisable, dans une rangée à part : ce sont des
        // chemins moins chers, pas des variantes du premier. Discord en accepte
        // cinq par rangée, et le catalogue n'en propose pas davantage.
        const aides = new ActionRowBuilder();
        const lignes = [];
        for (const helper of helpers.slice(0, 5)) {
          const aide = describeEvolution(speciesId, null, helper.key);
          if (!canPay(aide, stock)) continue;
          const cible = aide.target ? ` → ${aide.target.name}` : "";
          const prix = aide.points > 0 ? `${aide.points} pts` : "gratuit";
          aides.addComponents(
            new ButtonBuilder()
              .setCustomId(`poke_evo|${speciesId}|${suffix}|random|${helper.key}`)
              .setLabel(`${helper.label}${cible} (${prix})`)
              .setEmoji(helper.emoji)
              .setStyle(ButtonStyle.Secondary)
          );
          lignes.push(
            `${helper.emoji} **${helper.evolution.quantity}× ${helper.label}**` +
              `${cible} — ${aide.required} exemplaire${aide.required > 1 ? "s" : ""} requis, ${prix}`
          );
        }
        if (aides.components.length) {
          rows.push(aides);
          embed.addFields({
            name: "Tes objets",
            value: lignes.join("\n"),
            inline: false,
          });
        }

        // Aucun chemin : on le dit avec le chiffre qui manque, plutôt que
        // d'afficher un embed orné de boutons qui refuseraient tous.
        if (!rows.length) {
          return interaction
            .editReply({
              content:
                `❌ Il te faut **${plan.required}** exemplaires de **${species.name}**` +
                `${isShiny ? " ✨" : ""} pour cette fusion, tu en as **${owned}**.\n` +
                `Trois 🍬 Super Bonbons peuvent tenir lieu d'un exemplaire manquant.`,
            })
            .catch(() => {});
        }

        interaction.editReply({ embeds: [embed], components: rows }).catch(() => {});
        });
      });
    } catch (error) {
      handleException(error);
    }
  },
};
