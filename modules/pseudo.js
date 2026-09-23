// Le pseudo d'un membre, pour les journaux : son nom sur le serveur, à défaut
// son nom Discord, et son identifiant seulement si Discord ne le connaît plus.
// Un identifiant ne dit rien à qui lit les journaux ; un pseudo, si. Partout
// le même, pour qu'on retrouve quelqu'un d'une ligne à l'autre.
let bot = null;

// Le client se déclare au démarrage (clientReady) : les modules du jeu n'en
// ont pas toujours un sous la main, et un journal ne doit pas en dépendre.
export function setPseudoClient(client) {
  bot = client;
}

// Depuis une interaction : le membre est déjà là, rien à demander à Discord.
export const pseudoOf = (interaction) =>
  interaction.member?.displayName ??
  interaction.user?.displayName ??
  interaction.user?.username ??
  String(interaction.user?.id);

// Depuis un identifiant. guild.members.fetch lit le cache de discord.js avant
// d'appeler Discord : la plupart des journaux ne coûtent aucune requête.
export async function pseudo(userId) {
  const id = String(userId);
  if (!bot) return id;
  try {
    const guild = await bot.guilds.fetch(process.env.GUILD_ID);
    return (await guild.members.fetch(id)).displayName;
  } catch {
    try {
      return (await bot.users.fetch(id)).displayName;
    } catch {
      return id;
    }
  }
}

// Plusieurs pseudos d'un coup, dans l'ordre des identifiants.
export const pseudos = (...userIds) => Promise.all(userIds.map(pseudo));
