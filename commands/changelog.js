import { SlashCommandBuilder, EmbedBuilder, Colors, PermissionFlagsBits } from 'discord.js';
import { announceChangelog } from '../modules/changelog.js';
import fs from 'fs';

const data = new SlashCommandBuilder()
    .setName('changelog')
    .setDescription('Gestion et publication des changelogs du bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand =>
        subcommand
            .setName('latest')
            .setDescription('Publie le changelog de la dernière release')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('version')
            .setDescription('Publie le changelog d\'une version spécifique')
            .addStringOption(option =>
                option
                    .setName('version')
                    .setDescription('Version à publier (ex: 1.0.1)')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('status')
            .setDescription('Affiche le statut du système de changelog')
    );

async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    try {
        if (subcommand === 'latest') {
            await handleLatest(interaction);
        } else if (subcommand === 'version') {
            await handleVersion(interaction);
        } else if (subcommand === 'status') {
            await handleStatus(interaction);
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

async function handleLatest(interaction) {
    await interaction.deferReply();
    
    try {
        // Lire le changelog.json
        if (!fs.existsSync('./changelog.json')) {
            throw new Error('Fichier changelog.json non trouvé');
        }
        
        const changelog = JSON.parse(fs.readFileSync('./changelog.json', 'utf8'));
        
        if (!changelog.releases || changelog.releases.length === 0) {
            throw new Error('Aucune release trouvée dans le changelog');
        }
        
        const latestRelease = changelog.releases[0];
        
        // Publier le changelog de la dernière release
        await announceChangelog(interaction.client, {
            version: latestRelease.version,
            title: latestRelease.title,
            features: latestRelease.features
        });
        
        const successEmbed = new EmbedBuilder()
            .setTitle('✅ Changelog publié')
            .setDescription(`Le changelog de la version ${latestRelease.version} a été publié avec succès.`)
            .setColor(Colors.Green)
            .addFields(
                {
                    name: '� Version',
                    value: latestRelease.version,
                    inline: true
                },
                {
                    name: '� Date',
                    value: latestRelease.date,
                    inline: true
                },
                {
                    name: '🎯 Features',
                    value: latestRelease.features.length.toString(),
                    inline: true
                }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

    } catch (error) {
        throw new Error(`Erreur lors de la publication du changelog: ${error.message}`);
    }
}

async function handleVersion(interaction) {
    await interaction.deferReply();
    
    const version = interaction.options.getString('version');
    
    try {
        // Lire le changelog.json
        if (!fs.existsSync('./changelog.json')) {
            throw new Error('Fichier changelog.json non trouvé');
        }
        
        const changelog = JSON.parse(fs.readFileSync('./changelog.json', 'utf8'));
        
        const release = changelog.releases.find(r => r.version === version);
        if (!release) {
            throw new Error(`Version ${version} non trouvée dans le changelog`);
        }
        
        // Publier le changelog de la version spécifiée
        await announceChangelog(interaction.client, {
            version: release.version,
            title: release.title,
            features: release.features
        });
        
        const successEmbed = new EmbedBuilder()
            .setTitle('✅ Changelog publié')
            .setDescription(`Le changelog de la version ${release.version} a été publié avec succès.`)
            .setColor(Colors.Green)
            .addFields(
                {
                    name: '📋 Version',
                    value: release.version,
                    inline: true
                },
                {
                    name: '📅 Date',
                    value: release.date,
                    inline: true
                },
                {
                    name: '🎯 Features',
                    value: release.features.length.toString(),
                    inline: true
                }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

    } catch (error) {
        throw new Error(`Erreur lors de la publication du changelog: ${error.message}`);
    }
}

async function handleStatus(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        let statusInfo = {
            changelogExists: false,
            currentVersion: 'Inconnue',
            totalReleases: 0,
            pendingFeatures: 0,
            lastRelease: null
        };
        
        if (fs.existsSync('./changelog.json')) {
            statusInfo.changelogExists = true;
            const changelog = JSON.parse(fs.readFileSync('./changelog.json', 'utf8'));
            
            statusInfo.currentVersion = changelog.version || 'Inconnue';
            statusInfo.totalReleases = changelog.releases?.length || 0;
            statusInfo.pendingFeatures = changelog.pending?.length || 0;
            statusInfo.lastRelease = changelog.releases?.[0] || null;
        }
        
        const statusEmbed = new EmbedBuilder()
            .setTitle('📊 Statut du Système de Changelog')
            .setColor(statusInfo.changelogExists ? Colors.Green : Colors.Red)
            .setTimestamp();

        if (!statusInfo.changelogExists) {
            statusEmbed
                .setDescription('❌ Fichier changelog.json non trouvé')
                .addFields({
                    name: '💡 Note',
                    value: 'Le système de changelog n\'est pas initialisé. Utilisez le script `pcr` pour créer une feature.',
                    inline: false
                });
        } else {
            statusEmbed
                .setDescription('✅ Système de changelog opérationnel')
                .addFields(
                    {
                        name: '📦 Version actuelle',
                        value: statusInfo.currentVersion,
                        inline: true
                    },
                    {
                        name: '📋 Total releases',
                        value: statusInfo.totalReleases.toString(),
                        inline: true
                    },
                    {
                        name: '⏳ Features en attente',
                        value: statusInfo.pendingFeatures.toString(),
                        inline: true
                    }
                );
                
            if (statusInfo.lastRelease) {
                statusEmbed.addFields({
                    name: '🏷️ Dernière release',
                    value: `${statusInfo.lastRelease.version} (${statusInfo.lastRelease.date})`,
                    inline: false
                });
            }
        }

        statusEmbed.addFields({
            name: '� Commandes disponibles',
            value: `• \`/changelog latest\` - Publier la dernière release\n• \`/changelog version\` - Publier une version spécifique\n• Script PCR pour le développement`,
            inline: false
        });

        await interaction.editReply({ embeds: [statusEmbed] });

    } catch (error) {
        throw new Error(`Erreur lors de la récupération du statut: ${error.message}`);
    }
}

export { data, execute };
