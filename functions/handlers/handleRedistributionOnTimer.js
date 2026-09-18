// Handler : pot commun. Tick horaire plutôt qu'un cron hebdomadaire, pour deux
// raisons — la périodicité vit dans config.json et doit pouvoir changer sans
// redémarrage, et un bot éteint à l'heure dite rattrape le pot au tour suivant
// au lieu de sauter la semaine.
import { handleException } from "../../modules/utils.js";
import { maybeRunRedistribution } from "../../modules/redistribution.js";

export default (bot) => {
  bot.handleRedistributionOnTimer = async () => {
    try {
      await maybeRunRedistribution(bot);
    } catch (error) {
      handleException(error, "handleRedistributionOnTimer");
    }
  };
};
