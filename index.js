import { Client, Collection, GatewayIntentBits } from 'discord.js'; 
import { readdirSync } from 'fs';
import { handleException } from './modules/utils.js';
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

    // Initialize invite cache
    bot.invites = new Map();

    bot.on('ready', async () => {
        console.log(`Logged in as ${bot.user.tag}`);

        // Load and cache invites
        bot.guilds.cache.forEach(async guild => {
            const firstInvites = await guild.invites.fetch();
            bot.invites.set(guild.id, new Map(firstInvites.map(invite => [invite.code, invite.uses])));
        });
    });

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

    // cron.schedule(process.env.ADVENT_CRON_TIMER, () => {
    //     bot.handleAdventCalendarOnTimer();
    // });

    cron.schedule(process.env.COTD_CRON_TIMER, () => {
        bot.handleCOTDOnTimer();
    });

    bot.on('error', (e) => {
        handleException(e);
    });
} catch (e) {
    handleException(e);
            }

process.on('unhandledRejection', (e) => {
    handleException(e);
});
