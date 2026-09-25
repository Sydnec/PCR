// Handler : annonce une génération dès qu'elle s'ouvre.
//
// L'ouverture elle-même ne dépend d'aucun minuteur (voir activeGeneration) :
// celui-ci ne fait que la dire, à la minute près.
import { handleException } from "../../modules/utils.js";
import { announceOpenedGenerations } from "../../modules/pokemon/generations.js";

export default (bot) => {
  bot.handleGenerationOpeningOnTimer = async () => {
    try {
      await announceOpenedGenerations(bot);
    } catch (error) {
      handleException(error, "handleGenerationOpeningOnTimer");
    }
  };
};
