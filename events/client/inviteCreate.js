import { log } from '../../modules/utils.js';

const name = 'inviteCreate';
const once = false;

async function execute(invite) {
    // Le cache du client associe un code au NOMBRE d'utilisations. La version
    // précédente y déversait le cache de discord.js, qui associe un code à un
    // objet Invite : la comparaison faite dans guildMemberAdd devenait
    // impossible et le suivi des invitations décrochait.
    const guildInvites = invite.client.invites.get(invite.guild.id) ?? new Map();
    guildInvites.set(invite.code, invite.uses ?? 0);
    invite.client.invites.set(invite.guild.id, guildInvites);

    log(
        `Nouvelle invitation ${invite.code}` +
            (invite.inviter ? ` créée par ${invite.inviter.tag}` : '')
    );
}

export { name, once, execute };
