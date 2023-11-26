import { Client, Collection, GatewayIntentBits } from 'discord.js'; // , Events, Routes, REST
import { readdirSync } from 'fs';
import { handleException, log, error } from './modules/utils.js';
import cron from 'node-cron';
import dotenv from 'dotenv';
dotenv.config();

try {
    const bot = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildMessageReactions,
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.MessageContent,
        ],
    });

    bot.commands = new Collection();
    bot.commandsArray = [];
    bot.buttons = new Collection();

    const functionFolders = readdirSync('./functions');
    for (const folder of functionFolders) {
        const functionFiles = readdirSync(`./functions/${folder}`).filter(
            (file) => file.endsWith('.js')
        );
        for (const file of functionFiles) {
            const { default: importedFunction } = await import(
                `./functions/${folder}/${file}`
            );
            importedFunction(bot);
        }
    }

    bot.handleEvents();
    bot.handleCommands();

    bot.login(process.env.DISCORD_TOKEN);

    cron.schedule(process.env.ADVENT_CRON_TIMER, () => {
        bot.handleAdventCalendarOnTimer();
    });

    bot.on('error', error);
} catch (e) {
    handleException(e);
}

process.on('unhandledRejection', (e) => {
    handleException(e);
});
import './modules/utils.js';
