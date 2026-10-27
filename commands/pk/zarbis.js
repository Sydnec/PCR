import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import { getIndividuals } from "../../modules/pokemon/collection.js";
import { isAvailable, unownSpecies } from "../../modules/pokemon/data.js";
import { buildUnownEmbed } from "../../modules/pokemon/embeds.js";

// Le suivi des lettres de Zarbi : une seule entrée de Pokédex pour toutes, si bien que
// /pk pokedex ne dit pas lesquelles il reste à trouver. Réponse privée, comme le Pokédex.
export default {
  describe: (sub) =>
    sub
      .setName("zarbis")
      .setDescription("Les lettres de Zarbi réunies et celles qui manquent")
      .addUserOption((option) =>
        option.setName("membre").setDescription("Le dresseur à regarder").setRequired(false)
      ),

  async execute(interaction) {
    try {
      const target = interaction.options.getUser("membre") || interaction.user;
      const species = unownSpecies();
      if (!isAvailable(species)) {
        return interaction
          .reply({
            content:
              `❌ Zarbi n'est pas encore dans le Pokédex` +
              (species ? ` : il arrive avec la ${species.generation}ᵉ génération.` : "."),
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      getIndividuals(target.id, (err, rows) => {
        if (err) {
          handleException("Lecture des Zarbi :", err);
          return interaction
            .editReply({ content: "❌ Impossible de lire la collection." })
            .catch(() => {});
        }
        interaction.editReply({ embeds: [buildUnownEmbed(target, species, rows)] }).catch(() => {});
      });
    } catch (error) {
      handleException(error);
    }
  },
};
