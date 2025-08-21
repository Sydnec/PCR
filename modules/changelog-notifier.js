import { EmbedBuilder } from 'discord.js';
import { readChangelog } from './version-manager.js';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const LAST_ANNOUNCED_FILE = './last-announced-version.txt';

/**
 * Lit la dernière version annoncée
 */
function getLastAnnouncedVersion() {
    try {
        if (fs.existsSync(LAST_ANNOUNCED_FILE)) {
            return fs.readFileSync(LAST_ANNOUNCED_FILE, 'utf8').trim();
        }
        return null;
    } catch (error) {
        console.error('Erreur lecture dernière version annoncée:', error.message);
        return null;
    }
}

/**
 * Sauvegarde la dernière version annoncée
 */
function saveLastAnnouncedVersion(version) {
    try {
        fs.writeFileSync(LAST_ANNOUNCED_FILE, version);
        return true;
    } catch (error) {
        console.error('Erreur sauvegarde dernière version annoncée:', error.message);
        return false;
    }
}

/**
 * Détermine si une version est une release patch
 */
function isPatchRelease(currentVersion, previousVersion) {
    if (!previousVersion) return false;
    
    const [currMajor, currMinor, currPatch] = currentVersion.split('.').map(Number);
    const [prevMajor, prevMinor, prevPatch] = previousVersion.split('.').map(Number);
    
    // C'est un patch si seul le patch number a changé
    return currMajor === prevMajor && currMinor === prevMinor && currPatch !== prevPatch;
}

/**
 * Vérifie s'il y a une nouvelle release à annoncer et l'annonce si nécessaire
 */
export async function checkAndAnnounceNewRelease(bot) {
    try {
        const changelogChannelId = process.env.CHANGELOG_CHANNEL_ID;
        if (!changelogChannelId) {
            console.log('⚠️ CHANGELOG_CHANNEL_ID non configuré, notifications ignorées');
            return;
        }

        const changelog = readChangelog();
        const currentVersion = changelog.version;
        const lastAnnouncedVersion = getLastAnnouncedVersion();

        // Si c'est la même version que la dernière annoncée, ne rien faire
        if (currentVersion === lastAnnouncedVersion) {
            console.log(`📋 Version ${currentVersion} déjà annoncée`);
            return;
        }

        // Vérifier si c'est juste un patch
        if (lastAnnouncedVersion && isPatchRelease(currentVersion, lastAnnouncedVersion)) {
            console.log(`🔧 Version ${currentVersion} est un patch, pas d'annonce Discord`);
            // Mettre à jour quand même le fichier pour éviter de re-vérifier
            saveLastAnnouncedVersion(currentVersion);
            return;
        }

        // Trouver la release correspondante
        const currentRelease = changelog.releases.find(r => r.version === currentVersion);
        if (!currentRelease) {
            console.log(`⚠️ Release ${currentVersion} non trouvée dans changelog.json`);
            return;
        }

        // Récupérer le canal Discord
        const channel = await bot.channels.fetch(changelogChannelId);
        if (!channel) {
            console.error(`❌ Canal changelog non trouvé: ${changelogChannelId}`);
            return;
        }

        // Créer l'embed
        const embed = new EmbedBuilder()
            .setTitle(`🚀 PCR Bot v${currentVersion} déployé !`)
            .setDescription(currentRelease.title || `Release ${currentVersion}`)
            .setColor(0x00ff00)
            .setTimestamp()
            .setFooter({ 
                text: 'Déploiement automatique',
                iconURL: bot.user.displayAvatarURL()
            });

        // Ajouter les features par type
        if (currentRelease.features && currentRelease.features.length > 0) {
            const featuresByType = currentRelease.features.reduce((acc, feature) => {
                if (!acc[feature.type]) acc[feature.type] = [];
                acc[feature.type].push(feature);
                return acc;
            }, {});

            Object.entries(featuresByType).forEach(([type, features]) => {
                const typeTitle = {
                    'command': '⚡ Nouvelles Commandes',
                    'event': '🎯 Nouveaux Événements',
                    'feature': '✨ Nouvelles Fonctionnalités',
                    'fix': '🐛 Corrections',
                    'enhancement': '🔧 Améliorations'
                }[type] || '📋 Autres';

                const featureList = features
                    .map(f => `• **${f.name}**: ${f.description}`)
                    .join('\n');

                if (featureList.length > 0) {
                    embed.addFields({
                        name: typeTitle,
                        value: featureList.length > 1024 
                            ? featureList.substring(0, 1020) + '...' 
                            : featureList,
                        inline: false
                    });
                }
            });

            // Ajouter un résumé
            embed.setDescription(
                `${currentRelease.title || `Release ${currentVersion}`}\n\n` +
                `${currentRelease.features.length} nouvelle(s) fonctionnalité(s) incluse(s).`
            );
        }

        // Envoyer le message
        await channel.send({ embeds: [embed] });
        
        // Sauvegarder la version annoncée
        saveLastAnnouncedVersion(currentVersion);
        
        console.log(`✅ Changelog v${currentVersion} annoncé dans Discord`);

    } catch (error) {
        console.error('❌ Erreur lors de l\'annonce du changelog:', error.message);
    }
}

/**
 * Force l'annonce d'une version spécifique (pour les tests)
 */
export async function forceAnnounceVersion(bot, version) {
    try {
        // Réinitialiser le fichier pour forcer l'annonce
        if (fs.existsSync(LAST_ANNOUNCED_FILE)) {
            fs.unlinkSync(LAST_ANNOUNCED_FILE);
        }
        
        await checkAndAnnounceNewRelease(bot);
        console.log(`✅ Annonce forcée pour la version ${version}`);
    } catch (error) {
        console.error('❌ Erreur lors de l\'annonce forcée:', error.message);
    }
}
