import { autoAddEmojis } from '../../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config();

const name = 'threadCreate';
const once = false;

async function execute(thread) {
    const guild = thread.guild;
    const CHANNEL_ID = process.env.THREAD_LIST_CHANNEL_ID;
    let listMessageId = process.env.THREAD_LIST_MESSAGE_ID;

    // Si ce n'est pas le channel sondage, on liste tous les fils du serveur
    if (thread.parentId != process.env.POLL_CHANNEL_ID) {
        const channel = await thread.client.channels.fetch(CHANNEL_ID);

        // Récupère tous les salons textuels
        const textChannels = guild.channels.cache.filter(
            c => c.isTextBased() && c.type !== 4 // Exclut les catégories
        );

        let allThreads = [];
        for (const [, ch] of textChannels) {
            const active = await ch.threads.fetchActive();
            allThreads.push(...active.threads.values());
        }

        const threadList = allThreads.length
            ? allThreads.map(t => `- <#${t.id}> (${t.name})`).join('\n')
            : 'Aucun fil.';

        let listMessage;
        if (listMessageId) {
            try {
                listMessage = await channel.messages.fetch(listMessageId);
                await listMessage.edit(`**Liste des fils actifs du serveur :**\n${threadList}`);
            } catch (e) {
                listMessage = await channel.send(`**Liste des fils actifs du serveur :**\n${threadList}`);
                // Affiche l'ID à ajouter dans le .env
                console.log('Nouveau THREAD_LIST_MESSAGE_ID :', listMessage.id);
            }
        } else {
            listMessage = await channel.send(`**Liste des fils actifs du serveur :**\n${threadList}`);
            // Affiche l'ID à ajouter dans le .env
            console.log('Nouveau THREAD_LIST_MESSAGE_ID :', listMessage.id);
        }
    } else { 
        //N'accepte que les post de #Sondage
        let message = await thread.fetchStarterMessage();
        autoAddEmojis(message);
    }
}

export { name, once, execute };