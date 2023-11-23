import { error, log } from "../../modules/utils.js";
import { twitterRegex } from "../../modules/regex.js";
import dotenv from "dotenv";
dotenv.config();

const name = "messageCreate";
const once = false;
async function execute(message) {
	try {
		if (message.author.bot) return;
		const messageContent = message.content;
		if (twitterRegex.test(messageContent)) {
			// Remplacez les occurrences trouvées par "fxtwitter.com"
			const newMessageContent = messageContent.replace(
				twitterRegex,
				"https://vxtwitter.com"
			);
			message.channel
				.send("Remplacement de lien twitter")
				.then((newMessage) => {
					// Modifiez le message en ajoutant une mention
					newMessage.edit(
						`<@!${message.author.id}> a envoyé : \n${newMessageContent}`
					);
				})
				.then(message.delete())
				.catch((e) => error(e));
		}
	} catch (e) {
		error(e);
	}
}

export { name, once, execute };
