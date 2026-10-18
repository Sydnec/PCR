// Handler : les messages publics qui n'ont pas reçu leur fin.
//
// Une capture, une fuite, un échange conclu, un parc fermé ou un objet ramassé
// réécrivent leur message sur-le-champ, avec quelques réessais. Ce qui échoue
// quand même — une panne de Discord qui dure, un redémarrage au mauvais moment —
// se rattrape ici : la base sait ce qui s'est terminé sans que son message le
// dise. Les offres d'échange échues passent aussi en « expiré » : rien d'autre
// ne les ferait bouger, personne ne cliquant plus dessus.
import { handleException } from "../../modules/utils.js";
import { repairSpawnMessages } from "../../modules/pokemon/spawn.js";
import { expireTrades, repairTradeMessages } from "../../modules/pokemon/trade-message.js";
import { repairParkMessages } from "../../modules/pokemon/safari.js";
import { repairDropMessages } from "../../modules/pokemon/drops.js";

export default (bot) => {
  bot.handlePublicMessagesOnTimer = async () => {
    // Chaque étape à part : une panne sur les offres ne doit pas priver les
    // apparitions de leur rattrapage.
    for (const [label, step] of [
      ["offres échues", expireTrades],
      ["messages d'échange", repairTradeMessages],
      ["messages d'apparition", repairSpawnMessages],
      ["messages de parc safari", repairParkMessages],
      ["messages d'objet au sol", repairDropMessages],
    ]) {
      try {
        await step(bot);
      } catch (error) {
        handleException(`Rattrapage des ${label} :`, error);
      }
    }
  };
};
