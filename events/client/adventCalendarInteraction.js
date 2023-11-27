import { readFile } from 'fs/promises';

const name = 'interactionCreate';
const once = false;

async function execute(interaction, bot) {
    const today = new Date().getDate()-10;
    if (interaction.isButton()) {
        const { customId } = interaction;
        const jsonData = await readFile('./modules/advent.json', 'utf-8');
        const funFact = await JSON.parse(jsonData).find(
            (item) => item.jour == customId
        );
        const contenu =
            `# Jour ${funFact.jour}\n### ${funFact.categorie}` +
            (funFact.contenu ? `\n\n${funFact.contenu}` : '');
        await interaction.deferReply({ ephemeral: true });
        
        if (today >= funFact.jour) {
            if (funFact.image)
                await interaction.editReply({
                    content: contenu,
                    files: [funFact.image],
                });
            else
                await interaction.editReply({
                    content: contenu,
                });
        } else {
            await interaction.editReply({
                content: `Ne sois pas si impatient, nous ne sommes que le ${
                    today
                } Décembre, reviens dans ${funFact.jour - today} jours`,
            });
        }
    }
}
export { name, once, execute };
