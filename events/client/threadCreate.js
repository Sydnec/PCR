import { autoAddEmojis, updateThreadList } from "../../modules/utils.js";
import { PermissionsBitField, ChannelType } from "discord.js";
import dotenv from "dotenv";
dotenv.config();

const name = "threadCreate";
const once = false;

async function execute(thread) {
  // Si ce n'est pas dans le channel sondage, on liste tous les fils du serveur
  if (thread.parentId != process.env.POLL_CHANNEL_ID) {
    // Ignorer les threads du calendrier de l'avent
    if (thread.parentId === process.env.ADVENT_CHANNEL_ID) {
      return;
    }

    // Vérifier si le canal parent est visible par le rôle par défaut
    const defaultRole = thread.guild.roles.cache.get(
      process.env.DEFAULT_ROLE_ID
    );
    const parentChannel = thread.parent;

    if (
      parentChannel &&
      parentChannel.type === ChannelType.GuildText &&
      parentChannel
        .permissionsFor(defaultRole)
        ?.has(PermissionsBitField.Flags.ViewChannel)
    ) {
      updateThreadList(thread.guild);
    }
  } else {
    //N'accepte que les post de #Sondage
    let message = await thread.fetchStarterMessage();
    autoAddEmojis(message);
  }
}

export { name, once, execute };
