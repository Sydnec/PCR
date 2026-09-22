import {
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { handleException } from "../modules/utils.js";
import {
  decodeEntry,
  describeEvolution,
  encodeEntry,
  getCollection,
  getOwned,
} from "../modules/pokemon/collection.js";
import { embedColor, getSpecies, spriteUrl } from "../modules/pokemon/data.js";
import { getInventory, getItem } from "../modules/pokemon/items.js";
import { displayName } from "../modules/pokemon/embeds.js";

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

// Toutes les façons de faire évoluer cette entrée, aides comprises. Chacune
// porte son propre plan : une pierre ne coûte pas ce que coûte un bonbon, et le
// nombre d'exemplaires requis change avec elle.
function evolutionPaths(row, helpers) {
  const paths = [];
  const base = describeEvolution(row.species_id);
  if (!base.error && row.count >= base.required) paths.push({ plan: base, helper: null });

  for (const helper of helpers) {
    const plan = describeEvolution(row.species_id, null, helper.key);
    // Une aide qui ne change rien à ce qui manque n'a pas à encombrer l'écran :
    // on ne la propose que si elle rend la fusion possible, ou moins chère.
    if (plan.error || row.count < plan.required) continue;
    if (!paths.length || plan.points < base.points || plan.required < base.required) {
      paths.push({ plan, helper });
    }
  }
  return paths;
}

// Espèces que ce dresseur possède : celles qu'il peut faire évoluer — par ses
// propres moyens ou avec un objet — et celles qui pourraient évoluer mais dont
// il manque des exemplaires. Le second groupe sert à expliquer une liste vide au
// lieu de la laisser muette : c'est exactement ce qui faisait croire à une
// commande cassée.
function listEvolvable(userId, cb) {
  usableHelpers(userId, (err, helpers) => {
    if (err) return cb(err, [], []);
    getCollection(userId, (err, rows) => {
      if (err) return cb(err, [], []);
      const evolvable = [];
      const incomplete = [];
      for (const row of rows || []) {
        const paths = evolutionPaths(row, helpers);
        if (paths.length) {
          evolvable.push({ ...row, paths, plan: paths[0].plan });
          continue;
        }
        const plan = describeEvolution(row.species_id);
        if (!plan.error) incomplete.push({ ...row, plan });
      }
      // Les plus proches du seuil d'abord : ce sont les plus utiles à afficher.
      incomplete.sort((a, b) => b.count - a.count);
      cb(null, evolvable, incomplete);
    });
  });
}

export default {
  data: new SlashCommandBuilder()
    .setName("evolution")
    .setDescription("Fait évoluer un Pokémon en sacrifiant des doublons")
    .addStringOption((option) =>
      option
        .setName("pokemon")
        .setDescription("Le Pokémon à faire évoluer")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const query = interaction.options.getFocused().toLowerCase();
    listEvolvable(interaction.user.id, async (err, entries, incomplete) => {
      if (err) {
        handleException("Autocomplétion d'évolution :", err);
        return interaction.respond([]).catch(() => {});
      }
      const label = (entry) =>
        `${entry.is_shiny ? "✨ " : ""}${getSpecies(entry.species_id).name}`;

      const choices = entries
        .map((entry) => ({
          name: `${label(entry)} (×${entry.count})`,
          value: encodeEntry(entry.species_id, entry.is_shiny),
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
      const { speciesId, isShiny } = decodeEntry(interaction.options.getString("pokemon"));
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
        getOwned(interaction.user.id, speciesId, isShiny, (err, owned) => {
        if (err) {
          handleException("Lecture de la collection pour /evolution :", err);
          owned = 0;
        }

        const species = plan.species;
        const suffix = isShiny ? 1 : 0;
        const embed = new EmbedBuilder()
          .setTitle(`Évolution de ${displayName(species, isShiny)}`)
          .setColor(embedColor(species, isShiny))
          .setThumbnail(spriteUrl(species, isShiny))
          .setDescription(
            plan.branching
              ? `**${species.name}** peut évoluer en ${plan.targets
                  .map((target) => `**${target.name}**`)
                  .join(", ")}.\n\n` +
                  `Tu peux laisser le hasard décider, ou payer plus cher pour choisir.`
              : `**${species.name}** peut évoluer en **${plan.targets[0].name}**.`
          )
          .addFields({
            name: "Coût",
            value:
              `**${plan.duplicates}** doublons consommés (il t'en faut **${plan.required}** au total, ` +
              `un exemplaire est toujours conservé) et **${plan.points}** points`,
            inline: false,
          });

        const rows = [];
        const normale = new ActionRowBuilder();
        if (owned < plan.required) {
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
          if (aide.error || owned < aide.required) continue;
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
