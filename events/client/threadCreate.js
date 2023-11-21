import { autoAddEmojis } from "../../modules/utils.js";
import dotenv from "dotenv";
dotenv.config();

const name = "threadCreate";
const once = false;
async function execute(thread, bot) {
	if (thread.parentId != process.env.POLL_CHANNEL_ID) return; //N'accepte que les post de #Sondage
	let message = await thread.fetchStarterMessage(); //Récupère le message du post
	autoAddEmojis(message, bot);
}

export { name, once, execute };
