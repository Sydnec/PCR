const name = 'inviteCreate';
const once = false;

// Maintient le cache `client.invites`, dont la forme est
// guildId -> Map(code -> nombre d'utilisations).
//
// L'ancienne version partait de `invite.guild.invites.cache`, une Collection
// d'objets Invite, y insérait un nombre, puis remplaçait TOUT le cache du
// serveur par cette collection hybride. Le suivi d'invitation comparait ensuite
// un objet Invite à un nombre — comparaison toujours fausse — et plus aucun
// nouveau membre ne recevait de rôle.
async function execute(invite) {
	const guildId = invite.guild?.id;
	if (!guildId) return;

	const cache = invite.client.invites.get(guildId) ?? new Map();
	cache.set(invite.code, invite.uses ?? 0);
	invite.client.invites.set(guildId, cache);

	// `inviter` est absent des invitations de widget et des URL personnalisées.
	console.log(
		`New invite created with code ${invite.code} by ${invite.inviter?.tag ?? 'inconnu'}`
	);
}

export { name, once, execute };
