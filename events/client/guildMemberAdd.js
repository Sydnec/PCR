import { handleException, log } from '../../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config();

const name = 'guildMemberAdd';
const once = false;

async function execute(member) {
    try {
        // Invitation tracking
        const cachedInvites =
            member.client.invites.get(member.guild.id) ?? new Map();
        const newInvites = await member.guild.invites
            .fetch()
            .catch(() => null);

        // `?? 0` : une invitation créée pendant que le bot était hors ligne
        // n'a pas d'entrée en cache. `undefined < uses` valant false, aucune
        // invitation n'était reconnue et le nouveau membre repartait sans
        // aucun rôle.
        const inviteUsed = newInvites?.find(
            (inv) => (cachedInvites.get(inv.code) ?? 0) < inv.uses
        );

        if (inviteUsed) {
            log(
                `${member.user.tag} a rejoint avec l'invitation ${inviteUsed.code}` +
                    (inviteUsed.inviter ? ` de ${inviteUsed.inviter.tag}` : '')
            );
        } else {
            log(
                `${member.user.tag} a rejoint sans invitation identifiable : rôle par défaut`
            );
        }

        // Le rôle par défaut est attribué même quand l'invitation n'a pas pu
        // être identifiée : mieux vaut le rôle standard que pas de rôle.
        const isTemporaryMember =
            inviteUsed?.code === process.env.TEMPORY_MEMBER_INVITE_CODE;
        const roleId = isTemporaryMember
            ? process.env.TEMPORY_MEMBER_ROLE_ID
            : process.env.DEFAULT_ROLE_ID;
        const role = member.guild.roles.cache.get(roleId);

        if (role) {
            await member.roles.add(role);
        } else {
            handleException(`Rôle introuvable pour le nouveau membre : ${roleId}`);
        }

        // Update the invite cache
        if (newInvites) {
            member.client.invites.set(
                member.guild.id,
                new Map(newInvites.map((invite) => [invite.code, invite.uses]))
            );
        }
    } catch (error) {
        handleException(error, 'guildMemberAdd');
    }
}

export { name, once, execute };
