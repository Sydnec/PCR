import { EmbedBuilder } from 'discord.js';
import { readChangelog } from './version-manager.js';
import { log } from './utils.js';
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
            log('⚠️ CHANGELOG_CHANNEL_ID non configuré, notifications ignorées');
            return;
        }

        const changelog = readChangelog();
        const currentVersion = changelog.version;
        const lastAnnouncedVersion = getLastAnnouncedVersion();

        // Si c'est la même version que la dernière annoncée, ne rien faire
        if (currentVersion === lastAnnouncedVersion) {
            log(`📋 Version ${currentVersion} déjà annoncée`);
            return;
        }

        // Trouver la release correspondante
        const currentRelease = changelog.releases.find(r => r.version === currentVersion);
        if (!currentRelease) {
            log(`⚠️ Release ${currentVersion} non trouvée dans changelog.json`);
            return;
        }

        // Filtrer les features qui doivent être annoncées
        // Par défaut (si property manquante), on annonce tout sauf si c'est explicitement false
        // OU si l'ancienne méthode (patch release detection) s'applique
        const announceableFeatures = currentRelease.features.filter(f => f.announce !== false);
        
        const hasAnnounceableContent = announceableFeatures.length > 0;
        const manualPatchDetection = lastAnnouncedVersion && isPatchRelease(currentVersion, lastAnnouncedVersion);

        // Si aucune feature n'est marquée "announce: true" (ou défaut) ET que c'est un patch...
        // MAIS si une feature a "announce: true" explicite, on l'annonce même si c'est un patch.
        const explicitlyRequestsAnnounce = currentRelease.features.some(f => f.announce === true);

        if (!explicitlyRequestsAnnounce && !hasAnnounceableContent && manualPatchDetection) {
             log(`🔧 Version ${currentVersion} est un patch sans fonctionnalité majeure, pas d'annonce Discord`);
             saveLastAnnouncedVersion(currentVersion);
             return;
        }
        
        // Si vraiment rien à dire
        if (announceableFeatures.length === 0 && !explicitlyRequestsAnnounce) {
             log(`Skipping announcement for ${currentVersion} (no announceable features).`);
             saveLastAnnouncedVersion(currentVersion);
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
                // Filtrer pour l'affichage uniquement celles qu'on veut annoncer
                const featuresToDisplay = features.filter(f => f.announce !== false);
                if (featuresToDisplay.length === 0) return;

                const typeTitle = {
                    'command': '⚡ Nouvelles Commandes',
                    'event': '🎯 Nouveaux Événements',
                    'feature': '✨ Nouvelles Fonctionnalités',
                    'fix': '🐛 Corrections',
                    'enhancement': '🔧 Améliorations'
                }[type] || '📋 Autres';

                const featureList = featuresToDisplay
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
            const count = announceableFeatures.length;
            embed.setDescription(
                `${currentRelease.title || `Release ${currentVersion}`}\n\n` +
                `${count} nouvelle(s) fonctionnalité(s) incluse(s).`
            );
        }

        // Envoyer le message
        await channel.send({ embeds: [embed] });
        
        // Sauvegarder la version annoncée
        saveLastAnnouncedVersion(currentVersion);
        
        log(`✅ Changelog v${currentVersion} annoncé dans Discord`);

    } catch (error) {
        console.error('❌ Erreur lors de l\'annonce du changelog:', error.message);
    }
}
