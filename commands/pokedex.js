import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException } from "../modules/utils.js";
import { getCollection } from "../modules/pokemon/collection.js";
import { buildDexEmbed, buildDexRow } from "../modules/pokemon/embeds.js";

export default {
  data: new SlashCommandBuilder()
    .setName("pokedex")
    .setDescription("Affiche la collection de Pokémon d'un dresseur")
    .addUserOption((option) =>
      option
        .setName("membre")
        .setDescription("Le dresseur dont vous voulez voir le Pokédex")
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      const target = interaction.options.getUser("membre") || interaction.user;
      // Réponse privée : le Pokédex ne concerne que celui qui le consulte, et
      // cela évite au passage que quelqu'un d'autre manipule la pagination.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      getCollection(target.id, async (err, rows) => {
        if (err) {
          handleException(err);
          return interaction
            .editReply({ content: "❌ Impossible de lire le Pokédex." })
            .catch(() => {});
        }
        await interaction
          .editReply({
            embeds: [buildDexEmbed(target, rows || [], 0)],
            components: [buildDexRow(target.id, 0)],
          })
          .catch(() => {});
      });
    } catch (error) {
      handleException(error);
    }
  },
};
