import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { handleException } from '../modules/utils.js';
import { forceAnnounceVersion, checkAndAnnounceNewRelease } from '../modules/changelog-notifier.js';
import { readChangelog } from '../modules/version-manager.js';

export default {
    data: new SlashCommandBuilder()
        .setName('changelog')
        .setDescription('Gère les annonces de changelog')
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Vérifier s\'il y a une nouvelle version à annoncer'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('force')
                .setDescription('Forcer l\'annonce de la version actuelle'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Voir l\'état actuel du changelog'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        try {
            const subcommand = interaction.options.getSubcommand();

            switch (subcommand) {
                case 'check':
                    await interaction.reply({ 
                        content: '🔍 Vérification des nouvelles releases...', 
                        ephemeral: true 
                    });
                    
                    await checkAndAnnounceNewRelease(interaction.client);
                    
                    await interaction.editReply({ 
                        content: '✅ Vérification terminée ! Consultez les logs pour plus de détails.' 
                    });
                    break;

                case 'force':
                    await interaction.reply({ 
                        content: '🚀 Annonce forcée de la version actuelle...', 
                        ephemeral: true 
                    });
                    
                    const changelog = readChangelog();
                    await forceAnnounceVersion(interaction.client, changelog.version);
                    
                    await interaction.editReply({ 
                        content: `✅ Annonce forcée pour la version ${changelog.version} !` 
                    });
                    break;

                case 'status':
                    const changelogData = readChangelog();
                    const statusMessage = [
                        `📦 **Version actuelle**: ${changelogData.version}`,
                        `🎯 **Features en attente**: ${changelogData.pending.length}`,
                        `📋 **Total releases**: ${changelogData.releases.length}`,
                        `🏷️ **Dernière release**: ${changelogData.releases[0]?.version || 'Aucune'} (${changelogData.releases[0]?.date || 'N/A'})`
                    ].join('\n');

                    await interaction.reply({ 
                        content: `📊 **Statut du Changelog**\n\n${statusMessage}`,
                        ephemeral: true 
                    });
                    break;

                default:
                    await interaction.reply({ 
                        content: '❌ Sous-commande non reconnue.', 
                        ephemeral: true 
                    });
            }

        } catch (error) {
            handleException(error, interaction);
            await interaction.reply({ 
                content: '❌ Erreur lors de l\'exécution de la commande changelog.', 
                ephemeral: true 
            }).catch(() => {}); // Au cas où la réponse a déjà été envoyée
        }
    },
};
