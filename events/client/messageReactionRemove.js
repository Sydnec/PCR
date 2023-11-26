import { handleException, error, log } from '../../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config();

const name = 'messageReactionRemove';
const once = false;
async function execute(reaction, user) {
    if (user.id === process.env.CLIENT_ID) return;
    if (reaction.message.id === process.env.ROLE_MESSAGE_ID) {
        const guildMember = await reaction.message.guild.members.cache.get(
            user.id
        );
        const matchingRoles = await reaction.message.guild.roles.cache.filter(
            (role) => role.name.startsWith(reaction.emoji.name)
        );
        await guildMember.roles.remove(matchingRoles);
    }
}

export { name, once, execute };
