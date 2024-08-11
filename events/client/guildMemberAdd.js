import dotenv from 'dotenv';
dotenv.config();

const name = 'guildMemberAdd';
const once = false;

async function execute(member) {
    // Invitation tracking
    const cachedInvites = member.client.invites.get(member.guild.id);
    const newInvites = await member.guild.invites.fetch();
    
    const inviteUsed = newInvites.find(inv => cachedInvites.get(inv.code) < inv.uses);

    if (inviteUsed) {
        console.log(`${member.user.tag} joined using invite code ${inviteUsed.code} from ${inviteUsed.inviter.tag}`);
        
        // Compare the invite code with the one in .env
        if (inviteUsed.code === process.env.TEMPORY_MEMBER_INVITE_CODE) {
            console.log('Temporary member invite code was used!');

            // Assign the temporary member role
            let tempRole = member.guild.roles.cache.get(process.env.TEMPORY_MEMBER_ROLE_ID);
            if (tempRole) {
                member.roles.add(tempRole);
                console.log(`Assigned the temporary role to ${member.user.tag}`);
            } else {
                console.log('Temporary role not found.');
            } 
        } else {
            let role = member.guild.roles.cache.get(process.env.DEFAULT_ROLE_ID);

            if (role) {
                member.roles.add(role);
            }
        }
    }

    // Update the invite cache
    member.client.invites.set(member.guild.id, new Map(newInvites.map(invite => [invite.code, invite.uses])));
}

export { name, once, execute };
