import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { handleException } from "../modules/utils.js";
import {
  RARITIES,
  difficultyLabel,
  embedColor,
  evolutionTargets,
  getSpecies,
  probabilitiesByBall,
  rarityOf,
  searchByName,
  spriteUrl,
} from "../modules/pokemon/data.js";
import { getOwned } from "../modules/pokemon/collection.js";

export default {
  data: new SlashCommandBuilder()
    .setName("pokeinfo")
    .setDescription("Fiche d'un Pokémon : rareté, difficulté et chances de capture")
    .addStringOption((option) =>
      option
        .setName("pokemon")
        .setDescription("Le Pokémon à consulter")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const query = interaction.options.getFocused();
    await interaction.respond(
      searchByName(query, 25).map((species) => ({
        name: `#${String(species.id).padStart(3, "0")} ${species.name}`,
        value: String(species.id),
      }))
    );
  },

  async execute(interaction) {
    try {
      const species = getSpecies(interaction.options.getString("pokemon"));
      if (!species) {
        return interaction.reply({
          content: "❌ Pokémon inconnu.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const rarity = RARITIES[rarityOf(species)];
      const probabilities = probabilitiesByBall(species.catchRate)
        .filter((ball) => !ball.guaranteed)
        .map(
          (ball) =>
            `${ball.emoji} **${ball.label}** — ${(ball.probability * 100).toFixed(1)} % · ${ball.price} pts`
        )
        .join("\n");

      const evolutions = evolutionTargets(species);
      const embed = new EmbedBuilder()
        .setTitle(`#${String(species.id).padStart(3, "0")} ${species.name}`)
        .setColor(embedColor(species, false))
        .setThumbnail(spriteUrl(species, false))
        .addFields(
          { name: "Type", value: species.types.join(" / "), inline: true },
          { name: "Rareté", value: `${rarity.icon} ${rarity.label}`, inline: true },
          {
            name: "Difficulté",
            value: `${difficultyLabel(species.catchRate)} (taux ${species.catchRate})`,
            inline: true,
          },
          { name: "Chances de capture", value: probabilities, inline: false }
        );

      if (species.tradeEvolution) {
        embed.addFields({
          name: "⚠️ Introuvable à l'état sauvage",
          value: "Ce Pokémon s'obtient uniquement par fusion de doublons.",
          inline: false,
        });
      }

      if (evolutions.length) {
        embed.addFields({
          name: "Évolutions",
          value: evolutions.map((target) => `→ ${target.name}`).join("\n"),
          inline: false,
        });
      }

      getOwned(interaction.user.id, species.id, false, (err, count) => {
        if (!err) {
          embed.setFooter({
            text: count ? `Tu en possèdes ${count}` : "Tu n'en possèdes aucun",
          });
        }
        interaction
          .reply({ embeds: [embed], flags: MessageFlags.Ephemeral })
          .catch(() => {});
      });
    } catch (error) {
      handleException(error);
    }
  },
};
