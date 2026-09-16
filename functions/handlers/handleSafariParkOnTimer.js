// Handler : ouverture aléatoire du parc safari, et ménage de ce qui a expiré.
//
// Tirage horaire plutôt qu'adossé aux messages : un parc doit pouvoir tomber sur
// un serveur calme, et sa fréquence doit rester lisible (~un parc tous les trois
// jours avec les réglages par défaut) quelle que soit l'activité du salon.
import { handleException } from "../../modules/utils.js";
import { maybeOpenRandomPark, sweepSafari } from "../../modules/pokemon/safari.js";

export default (bot) => {
  bot.handleSafariParkOnTimer = async () => {
    try {
      await new Promise((resolve) => sweepSafari(bot, resolve));
      await maybeOpenRandomPark(bot);
    } catch (error) {
      handleException(error, "handleSafariParkOnTimer");
    }
  };
};
