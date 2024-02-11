import dotenv from 'dotenv';
dotenv.config();

const name = 'guildMemberAdd';
const once = false;
async function execute(member, bot) {
    // Récupère les invitations du serveur
    const guildInvites = await member.guild.invites.fetch();

    // Trouve l'invitation utilisée
    const usedInvite = guildInvites.find(inv => guildInvites.get(inv.code));

    let role;
    if (usedInvite) {
        switch (usedInvite.code) {
            case process.env.TEMPORY_MEMBER_INVITE_CODE:
                role = member.guild.roles.cache.get(process.env.TEMPORY_MEMBER_ROLE_ID);
                break;
        
            default:
                role = member.guild.roles.cache.get(process.env.DEFAULT_ROLE_ID);
                break;
        }
        
    }

    if (role) {
        member.roles.add(role);
    }
}


export { name, once, execute };
