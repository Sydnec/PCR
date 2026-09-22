import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException } from "../modules/utils.js";
import { getPokemonConfig, getSafariConfig } from "../modules/pokemon/config.js";
import { buildSafariView } from "../modules/pokemon/embeds.js";
import {
  findFreeParkFor,
  resumeSession,
  startPaidSession,
} from "../modules/pokemon/safari.js";

// Entrée payante du parc safari. L'événement aléatoire, lui, est gratuit et
// passe par le bouton de son message — cette commande sert à s'offrir une visite
// entre deux parcs.
//
// C'est aussi le seul moyen de rouvrir une visite en cours une fois le parc
// fermé derrière elle : son message n'a plus de bouton, la session, elle, court
// encore.
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
              return erreur();
            }

            // Ce que l'entrée a rendu, s'il a fallu défaire quelque chose. La
            // phrase suit les DEUX sorties : un refus après un ticket consommé
            // laissait croire que l'objet le plus rare du jeu avait été mangé
            // pour rien.
            const rendu = result.refunded
              ? ` Tes **${result.refunded}** points t'ont été rendus.`
              : result.ticketRendu
                ? " Ton **Ticket Safari** t'a été rendu."
                : "";

            if (!result.ok) {
              const content =
                result.code === "COOLDOWN"
                  ? `⏳ Tu as déjà visité le parc récemment. Prochaine entrée possible <t:${Math.floor(result.retryAt / 1000)}:R>.`
                  : `❌ ${result.reason}`;
              return interaction.editReply({ content: content + rendu }).catch(() => {});
            }

            // Le contenu s'écrit APRÈS l'étalement de la vue : celle-ci porte le
            // sien (la phrase de reprise, ou null pour effacer ce qui traîne),
            // et l'ordre inverse le ferait écraser.
            //
            // Une visite ouverte entre la vérification et le débit est rendue
            // telle quelle : c'est une reprise, pas l'entrée qu'on vient de payer.
            const view = buildSafariView(result.session, {
              owned: result.owned,
              resumed: result.resumed,
            });
            const content = result.resumed
              ? view.content + rendu
              : result.ticket
                ? `🎟️ Tu présentes ton **${result.ticket.label}** à l'entrée et franchis les grilles ` +
                  `du parc safari. **${config.actionsPerSession} actions**, et pas un point dépensé.`
                : `🏕️ Tu paies **${config.entryPrice}** points et franchis les grilles du parc safari. ` +
                  `**${config.actionsPerSession} actions**, et plus rien à débourser.`;

            interaction.editReply({ ...view, content }).catch(() => {});
          });
        });
      });
    } catch (error) {
      handleException(error);
    }
  },
};
