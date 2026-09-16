import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException } from "../modules/utils.js";
import { getPokemonConfig, getSafariConfig } from "../modules/pokemon/config.js";
import { buildSafariView } from "../modules/pokemon/embeds.js";
import { findFreeParkFor, startPaidSession } from "../modules/pokemon/safari.js";

// Entrée payante du parc safari. L'événement aléatoire, lui, est gratuit et
// passe par le bouton de son message — cette commande sert à s'offrir une visite
// entre deux parcs.
export default {
  data: new SlashCommandBuilder()
    .setName("safari")
    .setDescription(
      "Paie l'entrée du parc safari : 25 actions gratuites et des raretés boostées"
    ),

  async execute(interaction) {
    try {
      const config = getSafariConfig();
      if (!getPokemonConfig().enabled || !config.enabled) {
        return interaction.reply({
          content: "❌ Le parc safari est fermé pour le moment.",
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      findFreeParkFor(interaction.user.id, (err, freePark) => {
        if (err) {
          handleException(err);
          return interaction.editReply({ content: "❌ Erreur base de données." }).catch(() => {});
        }

        // Une visite offerte attend : on ne débite pas 4 000 points pour la
        // même chose sans le dire.
        if (freePark) {
          return interaction
            .editReply({
              content:
                "🏕️ Un parc safari est ouvert en ce moment et **ton entrée est offerte** !\n" +
                "Utilise le bouton *« Entrer dans le parc »* sur son message plutôt que " +
                `de payer **${config.entryPrice}** points.`,
            })
            .catch(() => {});
        }

        startPaidSession(interaction.user.id, (err, result) => {
          if (err) {
            handleException(err);
            return interaction.editReply({ content: "❌ Erreur base de données." }).catch(() => {});
          }

          if (!result.ok) {
            const content =
              result.code === "COOLDOWN"
                ? `⏳ Tu as déjà visité le parc récemment. Prochaine entrée possible <t:${Math.floor(result.retryAt / 1000)}:R>.`
                : `❌ ${result.reason}`;
            return interaction.editReply({ content }).catch(() => {});
          }

          interaction
            .editReply({
              content:
                `🏕️ Tu paies **${config.entryPrice}** points et franchis les grilles du parc safari. ` +
                `**${config.actionsPerSession} actions**, et plus rien à débourser.`,
              ...buildSafariView(result.session, { owned: result.owned }),
            })
            .catch(() => {});
        });
      });
    } catch (error) {
      handleException(error);
    }
  },
};
