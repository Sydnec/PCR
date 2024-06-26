import { handleException } from '../../modules/utils.js';
import { emojiRegex } from '../../modules/regex.js';

export default (bot) => {
    bot.handleUpdateRoleMessage = async () => {
        const guild = await bot.guilds.cache.get(process.env.GUILD_ID);
        const pingRole = await guild.roles.cache.get(process.env.PING_ROLE_ID);
        const lowerRoles = await guild.roles.cache.filter(
            (role) => role.position < pingRole.position
        );
        const messageRole = await bot.channels.cache
            .get(process.env.ROLE_CHANNEL_ID)
            .messages.fetch(process.env.ROLE_MESSAGE_ID);

        let newMessage = 'Pour être ping, réagissez à ce message :\n';
        await lowerRoles.forEach(async (role) => {
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
