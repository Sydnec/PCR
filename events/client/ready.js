import { log } from "../../modules/utils.js";
import dotenv from "dotenv";
dotenv.config();

const name = "ready";
const once = true;
async function execute(bot) {
	log(`Bonjour, je suis ${bot.user.tag} et j'ai bien démarré !`);
	bot.handleUpdateRoleMessage();
}

export { name, once, execute };
