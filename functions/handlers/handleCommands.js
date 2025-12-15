import { readdirSync } from 'fs';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { handleException, log } from '../../modules/utils.js';

export default (bot) => {
    bot.handleCommands = async () => {
        const commandsFiles = readdirSync(`./commands`).filter((filer) =>
            filer.endsWith('.js')
        );

        const { commands, commandsArray } = bot;
        for (const file of commandsFiles) {
            try {
                const commandModule = await import(`../../commands/${file}`);
                const command = commandModule.default || commandModule;
                commands.set(command.data.name, command);
                commandsArray.push(command.data.toJSON());
                log(
                    `Command: ${command.data.name} has passed through the handler`
                );
            } catch (error) {
                handleException(error);
            }
        }

        const clientId = process.env.CLIENT_ID;
        const guildId = process.env.GUILD_ID;
        const rest = new REST({ version: '10' }).setToken(
            process.env.DISCORD_TOKEN
        );
        try {
            await refreshCommands(rest, clientId, guildId, bot);
        } catch (err) {
            handleException(err);
        }
    };
};
async function refreshCommands(rest, clientId, guildId, bot) {
    try {
        // Supprime les commandes globales (en mettant une liste vide)
        await rest.put(Routes.applicationCommands(clientId), { body: [] });

        // Ajoute les commandes à la guilde spécifique
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
            body: bot.commandsArray,
        });

        log('Successfully reloaded application (/) commands.');
    } catch (error) {
        handleException(error);
    }
}
