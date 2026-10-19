// Handler : annonce une génération dès qu'elle s'ouvre, puis publie le bilan de la saison qu'elle
// vient de clore.
//
// L'ouverture elle-même ne dépend d'aucun minuteur (voir activeGeneration) :
// celui-ci ne fait que la dire, à la minute près.
import { handleException } from "../../modules/utils.js";
import { announceOpenedGenerations } from "../../modules/pokemon/generations.js";
import { publishSeasonRecaps } from "../../modules/pokemon/season.js";

export default (bot) => {
  bot.handleGenerationOpeningOnTimer = async () => {
    try {
      await announceOpenedGenerations(bot);
    } catch (error) {
      handleException(error, "handleGenerationOpeningOnTimer");
    }
    // Après l'annonce, et même si elle a échoué : le bilan arrive derrière l'ouverture dans le
    // salon, et ne dépend pas d'elle pour se publier.
    try {
      await publishSeasonRecaps(bot);
    } catch (error) {
      handleException(error, "handleGenerationOpeningOnTimer (bilan de saison)");
    }
  };
};
