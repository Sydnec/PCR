import { handleException, log } from '../../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config();

const name = 'guildMemberAdd';
const once = false;

// Attribue le rôle d'arrivée en fonction de l'invitation utilisée.
//
// Trois défauts corrigés :
//   - `cachedInvites` était supposée exister ; sur un serveur dont le cache
//     n'avait pas pu être chargé, l'appel à .get levait une TypeError et le
//     membre restait sans aucun rôle ;
//   - une invitation créée après le démarrage était absente du cache, donc
//     `undefined < uses` valait false et l'invitation n'était jamais reconnue ;
//   - quand aucune invitation n'était identifiée (URL personnalisée, cache
//     périmé, permission manquante), le membre repartait sans rôle du tout.
async function execute(member) {
	try {
		const client = member.client;
		const cachedInvites = client.invites.get(member.guild.id) ?? new Map();

		let newInvites = null;
		try {
			newInvites = await member.guild.invites.fetch();
		} catch (error) {
			log(
				`⚠️ Invitations illisibles pour ${member.guild.name}, attribution du rôle par défaut`
			);
		}

		let inviteUsed = null;
		if (newInvites) {
			inviteUsed =
				newInvites.find((inv) => {
					const previousUses = cachedInvites.get(inv.code);
					// Invitation inconnue du cache : elle a été créée depuis le
					// dernier rafraîchissement, donc toute utilisation compte.
					const before = previousUses ?? 0;
					return (inv.uses ?? 0) > before;
				}) ?? null;

			// Rafraîchir le cache dans tous les cas, y compris sans correspondance.
			client.invites.set(
				member.guild.id,
				new Map(newInvites.map((invite) => [invite.code, invite.uses ?? 0]))
			);
		}

		if (inviteUsed) {
			log(
				`${member.user.tag} joined using invite code ${inviteUsed.code} from ${
					inviteUsed.inviter?.tag ?? 'inconnu'
				}`
			);
		}

		const isTemporaryInvite =
			inviteUsed &&
			process.env.TEMPORY_MEMBER_INVITE_CODE &&
			inviteUsed.code === process.env.TEMPORY_MEMBER_INVITE_CODE;

		// Sans invitation identifiée on retombe sur le rôle par défaut : mieux
		// vaut un membre correctement accueilli qu'un membre sans rôle.
		const roleId = isTemporaryInvite
			? process.env.TEMPORY_MEMBER_ROLE_ID
			: process.env.DEFAULT_ROLE_ID;

		if (!roleId) return;
		const role = member.guild.roles.cache.get(roleId);
		if (!role) {
			log(`⚠️ Rôle ${roleId} introuvable, aucun rôle attribué à ${member.user.tag}`);
			return;
		}

		await member.roles.add(role);
		log(`Rôle ${role.name} attribué à ${member.user.tag}`);
	} catch (error) {
		handleException(error, 'guildMemberAdd');
	}
}

export { name, once, execute };
