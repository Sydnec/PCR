import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import { getPokemonConfig, getSafariConfig } from "../../modules/pokemon/config.js";
import { buildPaidEntryPrompt } from "../../modules/pokemon/embeds.js";
import { getEntryOffer } from "../../modules/pokemon/safari.js";

// Entrée payante du parc safari. L'événement aléatoire, lui, est gratuit et
// passe par le bouton de son message — cette commande sert à s'offrir une visite
// entre deux parcs.
//
// La commande ne débite jamais : elle dit ce que l'entrée consomme et attend le
// clic qui paie (poke_safari_go). Un Ticket Safari et des points sont des
// ressources rares, un « /pk safari » tapé par réflexe ne doit pas les prendre.
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

      // Une visite déjà ouverte se rouvre, et rien d'autre : ni parc offert à
      // annoncer, ni entrée à faire payer une seconde fois. L'ordre est celui de
      // getEntryOffer.
      getEntryOffer(interaction.user.id, (err, offer) => {
        if (err) {
          handleException(err);
          return interaction
            .editReply({ content: "❌ Erreur base de données." })
            .catch(() => {});
        }
        interaction.editReply(buildPaidEntryPrompt(offer)).catch(() => {});
      });
    } catch (error) {
      handleException(error);
    }
  },
};
