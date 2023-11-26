import { handleException, log } from '../../modules/utils.js';

const name = 'interactionCreate';
const once = false;
async function execute(interaction, bot) {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName != 'safe-place')
            log(
                `/${interaction.commandName} par ${interaction.member.displayName}`
            );
        const { commands } = bot;
        const { commandName } = interaction;
        const command = commands.get(commandName);
        if (!command) {
            return;
        }

        try {
            await command.execute(interaction, bot);
        } catch (e) {
            handleException(e);
            await interaction.reply({
                content: `Erreur lors de l'execution de la commande.`,
                ephemeral: true,
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
        } catch (e) {
            handleException(e);
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
        } catch (e) {
            handleException(e);
        }
    }
}
export { name, once, execute };
