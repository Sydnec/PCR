import { Collection } from 'discord.js';

const name = 'inviteCreate';
const once = false;

async function execute(invite) {
    const cachedInvites = invite.guild.invites.cache || new Collection();
    
    // Add the new invite to the cache
    cachedInvites.set(invite.code, invite.uses);
    
    // Update the client's invite cache
    invite.client.invites.set(invite.guild.id, cachedInvites);

    console.log(`New invite created with code ${invite.code} by ${invite.inviter.tag}`);
}

export { name, once, execute };
