import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import { getPokemonConfig, getSafariConfig } from "../../modules/pokemon/config.js";
import {
  buildPaidEntryReply,
  buildSafariGenerationPicker,
  buildSafariView,
  freeParkNotice,
  safariPickerContent,
} from "../../modules/pokemon/embeds.js";
import { activeGeneration } from "../../modules/pokemon/data.js";
import {
  findFreeParkFor,
  resumeSession,
  startPaidSession,
} from "../../modules/pokemon/safari.js";

// Entrée payante du parc safari. L'événement aléatoire, lui, est gratuit et
// passe par le bouton de son message — cette commande sert à s'offrir une visite
// entre deux parcs.
//
// C'est aussi le seul moyen de rouvrir une visite en cours une fois le parc
// fermé derrière elle : son message n'a plus de bouton, la session, elle, court
// encore.
export default {
  describe: (sub) =>
    sub
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

      const erreur = () =>
        interaction.editReply({ content: "❌ Erreur base de données." }).catch(() => {});

      // Une visite déjà ouverte se rouvre, et rien d'autre : ni parc offert à
      // annoncer, ni entrée à faire payer une seconde fois.
      resumeSession(interaction.user.id, (err, ongoing) => {
        if (err) {
          handleException(err);
          return erreur();
        }
        if (ongoing) {
          return interaction
            .editReply(
              buildSafariView(ongoing.session, { owned: ongoing.owned, resumed: true })
            )
            .catch(() => {});
        }

        findFreeParkFor(interaction.user.id, (err, freePark) => {
          if (err) {
            handleException(err);
            return erreur();
          }

          // Une visite offerte attend : on ne débite pas 5 000 points pour la
          // même chose sans le dire.
          if (freePark) {
            return interaction.editReply({ content: freeParkNotice() }).catch(() => {});
          }

          // Plusieurs générations ouvertes : on choisit d'abord celles qu'on
          // vise, et l'entrée se paie au bouton (poke_safari_go).
          if (activeGeneration() > 1) {
            return interaction
              .editReply({
                content: safariPickerContent("paid"),
                components: buildSafariGenerationPicker("paid", 0),
              })
              .catch(() => {});
          }

          startPaidSession(interaction.user.id, {}, (err, result) => {
            if (err) {
              handleException(err);
              return erreur();
            }
            interaction.editReply(buildPaidEntryReply(result)).catch(() => {});
          });
        });
      });
    } catch (error) {
      handleException(error);
    }
  },
};
