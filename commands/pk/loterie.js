import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import { getPokemonConfig } from "../../modules/pokemon/config.js";
import { play } from "../../modules/pokemon/lottery.js";
import { buildLotteryEmbed } from "../../modules/pokemon/embeds.js";

// Le tirage quotidien. Réponse privée, comme l'inventaire, le solde et la
// revente : tout ce qui ne concerne que la poche d'un dresseur reste dans son
// éphémère, et un « rien cette fois » n'a pas à occuper le salon une fois par
// joueur et par jour.
//
// « Tu as déjà joué » n'est pas traité comme une erreur : c'est la règle de la
// commande, elle s'affiche dans le même embed que les deux autres issues, avec
// l'heure du prochain tirage.
export default {
  describe: (sub) =>
    sub
      .setName("loterie")
      .setDescription("Tente ta chance : un tirage par jour, un lot ou rien"),

  async execute(interaction) {
    try {
      if (!getPokemonConfig().enabled) {
        return interaction.reply({
          content: "❌ Le système Pokémon est désactivé.",
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      play(interaction.user.id, (err, result) => {
        if (err) {
          handleException("Loterie :", err);
          return interaction
            .editReply({ content: "❌ Erreur base de données, ton tirage est intact." })
            .catch(() => {});
        }

        // Seul le refus « déjà joué » garde son embed : une loterie fermée par
        // la configuration n'a pas de prochain tirage à annoncer.
        if (!result.ok && !result.played) {
          return interaction.editReply({ content: `❌ ${result.reason}` }).catch(() => {});
        }

        interaction.editReply({ embeds: [buildLotteryEmbed(result)] }).catch(() => {});
      });
    } catch (error) {
      handleException(error);
    }
  },
};
