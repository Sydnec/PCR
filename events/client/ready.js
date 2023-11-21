import { log } from "../../modules/utils.js";

const name = "ready";
const once = true;
async function execute(bot) {
	log(`Bonjour, je suis ${bot.user.tag} et j'ai bien démarré !`);
}

export { name, once, execute };
