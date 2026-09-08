import { handleException, selfServiceRoles } from '../../modules/utils.js';
import { emojiRegex } from '../../modules/regex.js';

export default (bot) => {
    bot.handleUpdateRoleMessage = async () => {
        const guild = await bot.guilds.cache.get(process.env.GUILD_ID);
        // Même source de vérité que l'attribution par réaction : le message ne
        // doit jamais proposer un rôle que le handler refusera d'accorder.
        const lowerRoles = selfServiceRoles(guild);
        const messageRole = await bot.channels.cache
            .get(process.env.ROLE_CHANNEL_ID)
            .messages.fetch(process.env.ROLE_MESSAGE_ID);

        let newMessage = 'Pour être ping, réagissez à ce message :\n';
        lowerRoles.forEach((role) => {
            const emojis = role.name.match(emojiRegex);
            if (emojis) {
                messageRole.react(emojis[0]);
                newMessage += `- ${emojis[0]} pour${role.name.replace(
                    emojis[0],
                    ''
                )}\n`;
            }
        });
        messageRole.edit(newMessage);
    };
};
