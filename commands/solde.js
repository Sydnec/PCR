import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException } from "../modules/utils.js";
import { buildBalanceEmbed, getBalance, getNextPointsAt } from "../modules/economy.js";
import { getBallStock } from "../modules/pokemon/items.js";

// Le solde, dans le même embed que celui qui suit la fiche d'un Pokémon sous une
// apparition : une seule mise en forme, donc deux réponses qui ne peuvent pas
// diverger. La lecture passe par economy.js plutôt que par un SELECT posé ici —
// la table des points a un propriétaire, autant s'adresser à lui. Les balls en
// poche et le compte à rebours avant les prochains points suivent : une ball
// offerte se lance sans toucher au solde, et le dresseur sait quand son prochain
// message rapportera.
export default {
  data: new SlashCommandBuilder()
    .setName("solde")
    .setDescription("Affiche le solde de points d'un utilisateur")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("L'utilisateur dont vous voulez voir le solde")
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      const target = interaction.options.getUser("user") || interaction.user;

      getBalance(target.id, (err, balance) => {
        if (err) {
          handleException("Lecture du solde :", err);
          return interaction
            .reply({
              content: "❌ Une erreur est survenue lors de la récupération du solde.",
              flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});
        }

        getBallStock(target.id, (errBalls, balls) => {
          // Un inventaire illisible n'empêche pas de donner le solde : l'embed
          // omet alors la ligne des balls plutôt que d'en annoncer zéro.
          if (errBalls) handleException("Lecture des balls pour /solde :", errBalls);
          getNextPointsAt(target.id, (errTimer, nextPointsAt) => {
            if (errTimer) handleException("Lecture du délai de points pour /solde :", errTimer);
            interaction
              .reply({
                // Le destinataire est nommé même quand c'est soi : la commande peut
                // viser un autre dresseur, et un embed qui changerait de formulation
                // selon la cible se lirait mal dans un fil où les deux se suivent.
                embeds: [
                  buildBalanceEmbed(balance, {
                    user: target,
                    balls: errBalls ? null : balls,
                    nextPointsAt: errTimer ? undefined : nextPointsAt,
                  }),
                ],
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => {});
          });
        });
      });
    } catch (error) {
      handleException(error);
    }
  },
};
