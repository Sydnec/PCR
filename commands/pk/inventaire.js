import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import { getPokemonConfig } from "../../modules/pokemon/config.js";
import { getInventory } from "../../modules/pokemon/items.js";
import { buildInventoryEmbed } from "../../modules/pokemon/embeds.js";

// L'inventaire d'un dresseur. Réponse privée, comme le Pokédex : ce qu'on a en
// poche regarde d'abord son propriétaire, et un inventaire vide n'a pas à
// s'afficher devant tout le salon.
export default {
  describe: (sub) =>
    sub
      .setName("inventaire")
      .setDescription("Affiche les objets que tu as trouvés")
      .addUserOption((option) =>
        option
          .setName("membre")
          .setDescription("Le dresseur dont tu veux voir l'inventaire")
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
          handleException("Lecture de l'inventaire :", err);
          return interaction
            .reply({
              content: "❌ Erreur base de données.",
              flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});
        }

        interaction
          .reply({
            // `user` n'est passé que pour l'inventaire de quelqu'un d'autre :
            // sinon l'embed tutoie, comme celui du solde.
            embeds: [buildInventoryEmbed(rows, { user: target })],
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      });
    } catch (error) {
      handleException(error);
    }
  },
};
