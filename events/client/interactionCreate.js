import { handleException, log } from '../../modules/utils.js';

const name = 'interactionCreate';
const once = false;
async function execute(interaction, bot) {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName != 'safe-place')
            log(
                `/${interaction.commandName} par ${interaction.member.displayName}`
            );
        // --- Statistiques commandes les plus utilisées ---
        try {
            const db = (await import('../../modules/db.js')).default;
            db.run(
                `INSERT INTO command_stats (command, count) VALUES (?, 1)
                ON CONFLICT(command) DO UPDATE SET count = count + 1`,
                [interaction.commandName]
            );
        } catch (err) {
            handleException(err);
        }
        const { commands } = bot;
        const { commandName } = interaction;
        const command = commands.get(commandName);
        if (!command) {
            return;
        }

        try {
            await command.execute(interaction, bot);
        } catch (err) {
            handleException(err);
            await interaction.reply({
                content: `Erreur lors de l'execution de la commande.`,
                flags: MessageFlags.Ephemeral,
            });
        }
    }
    if (interaction.isButton()) {
        const { buttons } = bot;
        const { customId } = interaction;
        const button = buttons.get(customId);
        if (!button) {
            return new Error('there is no code for this button');
        }
        try {
            await button.execute(interaction, bot);
        } catch (err) {
            handleException(err);
        }
    }
    if (interaction.isContextMenuCommand()) {
        const { commands } = bot;
        const { commandName } = interaction;
        const contextCommand = commands.get(commandName);
        if (!contextCommand) {
            return;
        }
        try {
            await contextCommand.execute(interaction, bot);
        } catch (err) {
            handleException(err);
        }
    }
}
export { name, once, execute };
