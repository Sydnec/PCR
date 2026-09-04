import { handleException, log } from '../../modules/utils.js';
import { emojiRegexGlobal } from '../../modules/regex.js';

// Reconstruit le message d'attribution de rôles par réaction.
//
// L'ancienne version supposait que le serveur, le rôle de référence, le salon
// et le message existaient tous en cache : la moindre valeur manquante levait
// une TypeError, non attrapée puisque l'appelant (clientReady) n'attend pas
// cette fonction. Les réactions étaient de plus posées sans être attendues,
// donc partiellement perdues par le limiteur de débit.
export default (bot) => {
	bot.handleUpdateRoleMessage = async () => {
		try {
			const guild = bot.guilds.cache.get(process.env.GUILD_ID);
			if (!guild) {
				log('⚠️ GUILD_ID introuvable, message des rôles non mis à jour');
				return;
			}

			const pingRole = guild.roles.cache.get(process.env.PING_ROLE_ID);
			if (!pingRole) {
				log('⚠️ PING_ROLE_ID introuvable, message des rôles non mis à jour');
				return;
			}

			const channel = await bot.channels
				.fetch(process.env.ROLE_CHANNEL_ID)
				.catch(() => null);
			const messageRole = await channel?.messages
				.fetch(process.env.ROLE_MESSAGE_ID)
				.catch(() => null);
			if (!messageRole) {
				log('⚠️ Message des rôles introuvable, mise à jour ignorée');
				return;
			}

			const lowerRoles = guild.roles.cache.filter(
				(role) => role.position < pingRole.position
			);

			let newMessage = 'Pour être ping, réagissez à ce message :\n';
			const emojisToAdd = [];
			for (const role of lowerRoles.values()) {
				const emojis = role.name.match(emojiRegexGlobal());
				if (!emojis) continue;
				emojisToAdd.push(emojis[0]);
				newMessage += `- ${emojis[0]} pour${role.name.replace(
					emojis[0],
					''
				)}\n`;
			}

			await messageRole.edit(newMessage);
			for (const emoji of emojisToAdd) {
				try {
					await messageRole.react(emoji);
				} catch (e) {
					log(`⚠️ Réaction ${emoji} impossible : ${e.message}`);
				}
			}
		} catch (error) {
			handleException(error, 'handleUpdateRoleMessage');
		}
	};
};
