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
            import(`../../commands/${file}`)
                .then((commandModule) => {
                    const command = commandModule.default || commandModule;
                    commands.set(command.data.name, command);
                    commandsArray.push(command.data.toJSON());
                    log(
                        `Command: ${command.data.name} has passed through the handler`
                    );
                })
                .catch(handleException);

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
    await deleteAllCommands(rest, clientId, guildId);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: bot.commandsArray,
    });
    log('Successuflly reloaded applications (/) commands');
}

async function deleteAllCommands(rest, clientId, guildId) {
    const existingGlobalCommands = await rest
        .get(Routes.applicationCommands(clientId))
        .catch(handleException);

    for (const command of existingGlobalCommands) {
        await rest
            .delete(`${Routes.applicationCommands(clientId)}/${command.id}`)
            .catch(handleException);
    }
    const existingServerOnlyCommands = await rest
        .get(Routes.applicationGuildCommands(clientId, guildId))
        .catch(handleException);
    for (const command of existingServerOnlyCommands) {
        await rest
            .delete(
                `${Routes.applicationGuildCommands(clientId, guildId)}/${
                    command.id
                }`
            )
            .catch(handleException);
    }
}
