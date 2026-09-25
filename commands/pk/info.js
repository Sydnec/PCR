import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import { getAvailableSpecies, searchByName } from "../../modules/pokemon/data.js";
import { getSpeciesOwnership } from "../../modules/pokemon/collection.js";
import { buildSpeciesInfoEmbed, dexNumber } from "../../modules/pokemon/embeds.js";

// La fiche est construite par embeds.js, exactement comme celle du bouton
// « Infos du Pokémon » des apparitions : une seule mise en forme, donc une
// commande et un bouton qui ne peuvent pas répondre deux choses différentes.
export default {
  describe: (sub) =>
    sub
      .setName("info")
      .setDescription("Fiche d'un Pokémon : type, rareté, difficulté, sexes et lignée évolutive")
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
        name: `${dexNumber(species)} ${species.name}`,
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

      // Une collection illisible ne doit pas priver le dresseur de la fiche :
      // les compteurs retombent à zéro, et la lignée s'affiche simplement sans
      // ses pastilles de possession.
      getSpeciesOwnership(interaction.user.id, species, (err, { owned, forms }) => {
        interaction
          .reply({
            embeds: [buildSpeciesInfoEmbed(species, { owned, forms })],
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      });
    } catch (error) {
      handleException(error);
    }
  },
};
