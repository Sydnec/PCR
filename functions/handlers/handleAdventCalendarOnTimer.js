import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';

const randomArray = [
    13, 21, 14, 20, 6, 8, 12, 10, 4, 22, 2, 9, 15, 18, 23, 11, 19, 16, 1, 3, 17,
    5, 24, 7,
];

export default (bot) => {
    bot.handleAdventCalendarOnTimer = async () => {
        const channel = bot.channels.cache.get(process.env.ADVENT_CHANNEL_ID);
        createMatrix(channel);
    };
};

async function createMatrix(channel) {
    await clear(channel);
    for (let rows = 0; rows < 5; rows++) {
        let row = new ActionRowBuilder();
        for (let buttons = 0; buttons < 5; buttons++) {
            if (buttons + 5 * rows < 24) {
                const button = new ButtonBuilder()
                    .setCustomId(`${randomArray[buttons + 5 * rows]}`)
                    .setLabel(`${randomArray[buttons + 5 * rows]}`);
                if (randomArray[buttons + 5 * rows] <= new Date().getDate()) {
                    button.setStyle(ButtonStyle.Primary);
                } else {
                    button.setStyle(ButtonStyle.Secondary);
                }
                row.addComponents(button);
            }
        }
        channel.send({ components: [row] });
    }
}

async function clear(channel) {
    const messages = await channel.messages.fetch({ limit: 5 });
    channel.bulkDelete(messages);
}