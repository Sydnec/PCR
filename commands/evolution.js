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

// Espèces que ce dresseur possède en assez grand nombre pour évoluer.
function listEvolvable(userId, cb) {
  getCollection(userId, (err, rows) => {
    if (err) return cb(err, []);
    const evolvable = [];
    for (const row of rows || []) {
      const plan = describeEvolution(row.species_id);
      if (plan.error) continue;
      if (row.count >= plan.required) {
        evolvable.push({ ...row, plan });
      }
    }
    cb(null, evolvable);
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
    listEvolvable(interaction.user.id, async (err, entries) => {
      if (err) return interaction.respond([]).catch(() => {});
      const choices = entries
        .map((entry) => {
          const species = getSpecies(entry.species_id);
          return {
            name: `${entry.is_shiny ? "✨ " : ""}${species.name} (×${entry.count})`,
            value: encode(entry.species_id, entry.is_shiny),
          };
        })
        .filter((choice) => choice.name.toLowerCase().includes(query))
        .slice(0, 25);
      await interaction.respond(choices).catch(() => {});
    });
  },

  async execute(interaction) {
    try {
      const { speciesId, isShiny } = decode(interaction.options.getString("pokemon"));
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
