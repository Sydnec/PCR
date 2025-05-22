import { autoAddEmojis, updateThreadList } from '../../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config();

const name = 'threadCreate';
const once = false;

async function execute(thread) {
    // Si ce n'est pas dans le channel sondage, on liste tous les fils du serveur
    if (thread.parentId != process.env.POLL_CHANNEL_ID) {
        updateThreadList(thread.guild);
    } else { 
        //N'accepte que les post de #Sondage
        let message = await thread.fetchStarterMessage();
        autoAddEmojis(message);
    }
}

export { name, once, execute };