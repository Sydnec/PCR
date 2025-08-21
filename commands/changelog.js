import { SlashCommandBuilder, EmbedBuilder, Colors, PermissionFlagsBits } from 'discord.js';
import { getAutoChangelogStats, resetLastProcessedCommit, processAutoChangelogs } from '../modules/auto-changelog.js';
import { announceChangelog } from '../modules/changelog.js';

const data = new SlashCommandBuilder()
    .setName('changelog')
    .setDescription('Gestion des changelogs automatiques du bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand =>
        subcommand
            .setName('status')
            .setDescription('Affiche le statut du système de changelog automatique')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('force')
            .setDescription('Force la vérification des nouveaux commits et publie les changelogs')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('reset')
            .setDescription('Réinitialise l\'historique des commits traités')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('manual')
            .setDescription('Publie un changelog manuel')
            .addStringOption(option =>
                option
                    .setName('version')
                    .setDescription('Version du changelog')
                    .setRequired(true)
            )
            .addStringOption(option =>
                option
                    .setName('features')
                    .setDescription('Liste des fonctionnalités (séparées par des virgules)')
                    .setRequired(true)
            )
            .addStringOption(option =>
                option
                    .setName('title')
                    .setDescription('Titre personnalisé du changelog')
                    .setRequired(false)
            )
    );

async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    try {
        if (subcommand === 'status') {
            await handleStatus(interaction);
        } else if (subcommand === 'force') {
            await handleForce(interaction);
        } else if (subcommand === 'reset') {
            await handleReset(interaction);
        } else if (subcommand === 'manual') {
            await handleManual(interaction);
        }
    } catch (error) {
        console.error('❌ Erreur dans la commande changelog:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Erreur')
            .setDescription('Une erreur est survenue lors de l\'exécution de la commande.')
            .setColor(Colors.Red)
            .addFields({
                name: 'Détails',
                value: `\`\`\`${error.message}\`\`\``,
                inline: false
            })
            .setTimestamp();

        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ embeds: [errorEmbed] });
        } else {
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    }
}

async function handleStatus(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    const stats = getAutoChangelogStats();
    
    const statusEmbed = new EmbedBuilder()
        .setTitle('📊 Statut du Système de Changelog Automatique')
        .setColor(stats.isUpToDate ? Colors.Green : Colors.Orange)
        .setTimestamp();

    if (stats.error) {
        statusEmbed
            .setDescription('❌ Erreur lors de la récupération du statut')
            .addFields({
                name: 'Erreur',
                value: `\`\`\`${stats.error}\`\`\``,
                inline: false
            });
    } else {
        statusEmbed
            .setDescription(stats.isUpToDate ? 
                '✅ Le système est à jour' : 
                '⚠️ De nouveaux commits peuvent être disponibles'
            )
            .addFields(
                {
                    name: '📝 Dernier commit traité',
                    value: stats.lastProcessedCommit,
                    inline: true
                },
                {
                    name: '🔄 Commit actuel',
                    value: stats.currentCommit,
                    inline: true
                },
                {
                    name: '📁 Fichier de log',
                    value: stats.logFileExists ? '✅ Existe' : '❌ Absent',
                    inline: true
                }
            );
    }

    statusEmbed.addFields({
        name: '💡 Actions disponibles',
        value: `• \`/changelog force\` - Forcer la vérification\n• \`/changelog reset\` - Réinitialiser l'historique\n• \`/changelog manual\` - Changelog manuel`,
        inline: false
    });

    await interaction.editReply({ embeds: [statusEmbed] });
}

async function handleForce(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const resultEmbed = new EmbedBuilder()
            .setTitle('🔄 Vérification forcée des commits')
            .setDescription('Analyse en cours des nouveaux commits...')
            .setColor(Colors.Blue)
            .setTimestamp();

        await interaction.editReply({ embeds: [resultEmbed] });

        // Traiter les changelogs automatiques
        await processAutoChangelogs(interaction.client);

        resultEmbed
            .setTitle('✅ Vérification terminée')
            .setDescription('L\'analyse des commits a été effectuée avec succès.')
            .setColor(Colors.Green)
            .addFields({
                name: '📋 Résultat',
                value: 'Consultez les logs du serveur pour voir les détails des changelogs publiés.',
                inline: false
            });

        await interaction.editReply({ embeds: [resultEmbed] });

    } catch (error) {
        const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Erreur lors de la vérification')
            .setDescription('Une erreur est survenue lors de l\'analyse des commits.')
            .setColor(Colors.Red)
            .addFields({
                name: 'Détails',
                value: `\`\`\`${error.message}\`\`\``,
                inline: false
            })
            .setTimestamp();

        await interaction.editReply({ embeds: [errorEmbed] });
    }
}

async function handleReset(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        resetLastProcessedCommit();
        
        const successEmbed = new EmbedBuilder()
            .setTitle('🔄 Historique réinitialisé')
            .setDescription('L\'historique des commits traités a été réinitialisé avec succès.')
            .setColor(Colors.Green)
            .addFields({
                name: '📝 Note',
                value: 'Au prochain redémarrage du bot, les 5 derniers commits seront analysés.',
                inline: false
            })
            .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

    } catch (error) {
        throw new Error(`Erreur lors de la réinitialisation: ${error.message}`);
    }
}

async function handleManual(interaction) {
    await interaction.deferReply();
    
    const version = interaction.options.getString('version');
    const featuresString = interaction.options.getString('features');
    const title = interaction.options.getString('title') || `Changelog Manuel - Version ${version}`;
    
    try {
        // Parser les fonctionnalités
        const featuresList = featuresString.split(',').map(f => f.trim()).filter(f => f.length > 0);
        
        if (featuresList.length === 0) {
            throw new Error('Aucune fonctionnalité fournie');
        }

        const features = featuresList.map(feature => ({
            type: 'feature',
            name: feature.length > 50 ? feature.substring(0, 50) + '...' : feature,
            description: feature
        }));

        // Publier le changelog
        await announceChangelog(interaction.client, {
            version: version,
            title: title,
            features: features
        });

        const successEmbed = new EmbedBuilder()
            .setTitle('✅ Changelog publié')
            .setDescription(`Le changelog manuel version ${version} a été publié avec succès.`)
            .setColor(Colors.Green)
            .addFields(
                {
                    name: '📋 Fonctionnalités incluses',
                    value: featuresList.map(f => `• ${f}`).join('\n').substring(0, 1020) + (featuresList.join('\n').length > 1020 ? '...' : ''),
                    inline: false
                }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

    } catch (error) {
        throw new Error(`Erreur lors de la publication du changelog: ${error.message}`);
    }
}

export { data, execute };
