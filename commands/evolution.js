import {
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { handleException } from "../modules/utils.js";
import { getCollection, describeEvolution } from "../modules/pokemon/collection.js";
import { embedColor, getSpecies, spriteUrl } from "../modules/pokemon/data.js";
import { displayName } from "../modules/pokemon/embeds.js";

// Les options d'inventaire encodent l'espèce ET la variante shiny, car un
// shiny est une entrée de Pokédex distincte qui évolue séparément.
const encode = (speciesId, isShiny) => `${speciesId}:${isShiny ? 1 : 0}`;
export const decode = (value) => {
  const [speciesId, shiny] = String(value).split(":");
  return { speciesId: Number(speciesId), isShiny: shiny === "1" };
};

// Discord n'autorise pas de liste vide accompagnée d'un message : une
// proposition inerte est le seul moyen d'expliquer pourquoi il n'y a rien à
// choisir. Sa valeur ne correspond à aucune espèce, donc execute() la refuse.
const HINT_VALUE = "0:0";

// Espèces que ce dresseur possède : celles qu'il peut faire évoluer, et celles
// qui pourraient évoluer mais dont il manque des exemplaires. Le second groupe
// sert à expliquer une liste vide au lieu de la laisser muette — c'est
// exactement ce qui faisait croire à une commande cassée.
function listEvolvable(userId, cb) {
  getCollection(userId, (err, rows) => {
    if (err) return cb(err, [], []);
    const evolvable = [];
    const incomplete = [];
    for (const row of rows || []) {
      const plan = describeEvolution(row.species_id);
      if (plan.error) continue;
      if (row.count >= plan.required) evolvable.push({ ...row, plan });
      else incomplete.push({ ...row, plan });
    }
    // Les plus proches du seuil d'abord : ce sont les plus utiles à afficher.
    incomplete.sort((a, b) => b.count - a.count);
    cb(null, evolvable, incomplete);
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
          value: encode(entry.species_id, entry.is_shiny),
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
      const { speciesId, isShiny } = decode(interaction.options.getString("pokemon"));
      if (!getSpecies(speciesId)) {
        return interaction.reply({
          content:
            "❌ Choisis une proposition dans la liste d'autocomplétion.",
          flags: MessageFlags.Ephemeral,
        });
      }
      const plan = describeEvolution(speciesId);
      if (plan.error) {
        return interaction.reply({
          content: `❌ ${plan.error}`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const species = plan.species;
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
            `un exemplaire est toujours conservé)`,
          inline: false,
        });

      const row = new ActionRowBuilder();
      if (plan.branching) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`poke_evo|${speciesId}|${isShiny ? 1 : 0}|random`)
            .setLabel(`Évolution aléatoire (${plan.points} pts)`)
            .setEmoji("🎲")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`poke_evo|${speciesId}|${isShiny ? 1 : 0}|choose`)
            .setLabel(
              `Choisir l'évolution (${describeEvolution(speciesId, plan.targets[0].id).points} pts)`
            )
            .setEmoji("🎯")
            .setStyle(ButtonStyle.Secondary)
        );
      } else {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`poke_evo|${speciesId}|${isShiny ? 1 : 0}|random`)
            .setLabel(`Faire évoluer (${plan.points} pts)`)
            .setEmoji("✨")
            .setStyle(ButtonStyle.Success)
        );
      }

      await interaction.reply({
        embeds: [embed],
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      handleException(error);
    }
  },
};
