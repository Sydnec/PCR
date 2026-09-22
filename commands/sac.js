import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException } from "../modules/utils.js";
import { getPokemonConfig } from "../modules/pokemon/config.js";
import { getInventory } from "../modules/pokemon/items.js";
import { buildBagEmbed } from "../modules/pokemon/embeds.js";

// Le sac d'un dresseur. Réponse privée, comme le Pokédex : ce qu'on a en poche
// regarde d'abord son propriétaire, et un sac vide n'a pas à s'afficher devant
// tout le salon.
export default {
  data: new SlashCommandBuilder()
    .setName("sac")
    .setDescription("Affiche les objets que tu as trouvés")
    .addUserOption((option) =>
      option
        .setName("membre")
        .setDescription("Le dresseur dont tu veux voir le sac")
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      if (!getPokemonConfig().enabled) {
        return interaction.reply({
          content: "❌ Le système Pokémon est désactivé.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const target = interaction.options.getUser("membre");
      const owner = target ?? interaction.user;

      getInventory(owner.id, (err, rows) => {
        if (err) {
          handleException("Lecture du sac :", err);
          return interaction
            .reply({
              content: "❌ Erreur base de données.",
              flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});
        }

        interaction
          .reply({
            // `user` n'est passé que pour le sac de quelqu'un d'autre : sinon
            // l'embed tutoie, comme celui du solde.
            embeds: [buildBagEmbed(rows, { user: target })],
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      });
    } catch (error) {
      handleException(error);
    }
  },
};
