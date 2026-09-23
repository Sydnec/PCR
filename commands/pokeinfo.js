import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException } from "../modules/utils.js";
import {
  evolutionChain,
  getAvailableSpecies,
  searchByName,
} from "../modules/pokemon/data.js";
import { getOwnedVariantsFor } from "../modules/pokemon/collection.js";
import { buildSpeciesInfoEmbed } from "../modules/pokemon/embeds.js";

// La fiche est construite par embeds.js, exactement comme celle du bouton
// « Infos du Pokémon » des apparitions : une seule mise en forme, donc une
// commande et un bouton qui ne peuvent pas répondre deux choses différentes.
export default {
  data: new SlashCommandBuilder()
    .setName("pokeinfo")
    .setDescription("Fiche d'un Pokémon : type, rareté, difficulté et lignée évolutive")
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
      // Une saisie tapée à la main peut viser une génération encore fermée.
      const species = getAvailableSpecies(interaction.options.getString("pokemon"));
      if (!species) {
        return interaction.reply({
          content: "❌ Pokémon inconnu.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const chain = evolutionChain(species);
      getOwnedVariantsFor(
        interaction.user.id,
        chain.map((link) => link.id),
        (err, owned) => {
          // Une collection illisible ne doit pas priver le dresseur de la
          // fiche : getOwnedVariantsFor rend des compteurs à zéro, et la lignée
          // s'affiche simplement sans ses pastilles de possession.
          if (err) handleException("Lecture de la collection pour /pokeinfo :", err);
          interaction
            .reply({
              embeds: [buildSpeciesInfoEmbed(species, { owned })],
              flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});
        }
      );
    } catch (error) {
      handleException(error);
    }
  },
};
