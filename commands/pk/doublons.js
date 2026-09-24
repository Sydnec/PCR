import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import { getIndividuals, listDuplicates } from "../../modules/pokemon/collection.js";
import { buildDuplicatesEmbed, buildDuplicatesRow } from "../../modules/pokemon/embeds.js";

// Les doublons d'un dresseur : ce qu'il a en plusieurs exemplaires, et combien
// peuvent partir. La question qu'on se pose avant de proposer un échange, sans
// avoir à parcourir sa boîte individu par individu.
export default {
  describe: (sub) =>
    sub
      .setName("doublons")
      .setDescription("Les Pokémon qu'un dresseur a en plusieurs exemplaires")
      .addUserOption((option) =>
        option
          .setName("membre")
          .setDescription("Le dresseur dont tu veux voir les doublons")
          .setRequired(false)
      ),

  async execute(interaction) {
    try {
      const user = interaction.options.getUser("membre") ?? interaction.user;
      // Réponse privée, comme la boîte : elle ne concerne que celui qui la
      // consulte, et personne d'autre ne tourne ses pages.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      getIndividuals(user.id, (err, rows) => {
        if (err) {
          handleException("Lecture des doublons :", err);
          return interaction
            .editReply({ content: "❌ Impossible de lire les doublons." })
            .catch(() => {});
        }
        const list = listDuplicates(rows);
        interaction
          .editReply({
            embeds: [buildDuplicatesEmbed(list, { user, page: 0 })],
            components: [buildDuplicatesRow(user.id, 0, list.length)],
          })
          .catch(() => {});
      });
    } catch (error) {
      handleException(error);
    }
  },
};
