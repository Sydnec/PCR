// Handler : fait éclore les œufs dont l'échéance est passée.
//
// Le compteur de messages fait éclore un œuf au message qui franchit le seuil ;
// ce balayage couvre l'autre seuil, le temps, qui ne dépend d'aucune activité :
// un dresseur parti en vacances retrouve son bébé à son retour.
import { handleException } from "../../modules/utils.js";
import { hatchDueEggs } from "../../modules/pokemon/eggs.js";

export default (bot) => {
  bot.handleEggHatchOnTimer = () => {
    try {
      hatchDueEggs(bot);
    } catch (error) {
      handleException(error, "handleEggHatchOnTimer");
    }
  };
};
