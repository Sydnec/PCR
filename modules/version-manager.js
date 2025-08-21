import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const CHANGELOG_FILE = './changelog.json';
const PACKAGE_FILE = './package.json';

/**
 * Lit le fichier changelog.json
 */
export function readChangelog() {
    try {
        if (!fs.existsSync(CHANGELOG_FILE)) {
            const defaultChangelog = {
                version: "1.0.0",
                lastUpdated: new Date().toISOString(),
                releases: [],
                pending: []
            };
            fs.writeFileSync(CHANGELOG_FILE, JSON.stringify(defaultChangelog, null, 2));
            return defaultChangelog;
        }
        
        const data = fs.readFileSync(CHANGELOG_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        throw new Error(`Erreur lors de la lecture du changelog: ${error.message}`);
    }
}

/**
 * Sauvegarde le fichier changelog.json
 */
export function saveChangelog(changelog) {
    try {
        changelog.lastUpdated = new Date().toISOString();
        fs.writeFileSync(CHANGELOG_FILE, JSON.stringify(changelog, null, 2));
        return true;
    } catch (error) {
        throw new Error(`Erreur lors de la sauvegarde du changelog: ${error.message}`);
    }
}

/**
 * Ajoute une feature au changelog en pending
 */
export function addPendingFeature(featureInfo) {
    try {
        const changelog = readChangelog();
        
        const feature = {
            type: featureInfo.type || 'feature',
            name: featureInfo.name,
            description: featureInfo.description,
            author: featureInfo.author || getCurrentGitUser(),
            commit: getCurrentCommitHash(),
            timestamp: new Date().toISOString(),
            branch: getCurrentBranch()
        };
        
        // Vérifier si la feature n'existe pas déjà
        const exists = changelog.pending.some(f => 
            f.name === feature.name && f.type === feature.type
        );
        
        if (!exists) {
            changelog.pending.push(feature);
            saveChangelog(changelog);
            console.log(`✅ Feature ajoutée au changelog: ${feature.type} "${feature.name}"`);
            return feature;
        } else {
            console.log(`⚠️  Feature déjà présente: ${feature.type} "${feature.name}"`);
            return null;
        }
    } catch (error) {
        throw new Error(`Erreur lors de l'ajout de la feature: ${error.message}`);
    }
}

/**
 * Incrémente la version selon le type (patch, minor, major)
 */
export function incrementVersion(currentVersion, type = 'patch') {
    const [major, minor, patch] = currentVersion.split('.').map(Number);
    
    switch (type) {
        case 'major':
            return `${major + 1}.0.0`;
        case 'minor':
            return `${major}.${minor + 1}.0`;
        case 'patch':
        default:
            return `${major}.${minor}.${patch + 1}`;
    }
}

/**
 * Crée une nouvelle release avec toutes les features pending
 */
export function createRelease(versionType = 'patch', customTitle = null) {
    try {
        const changelog = readChangelog();
        
        if (changelog.pending.length === 0) {
            throw new Error('Aucune feature en attente pour créer une release');
        }
        
        const newVersion = incrementVersion(changelog.version, versionType);
        
        const release = {
            version: newVersion,
            date: new Date().toISOString().split('T')[0],
            title: customTitle || `Release ${newVersion}`,
            features: [...changelog.pending]
        };
        
        // Ajouter la release et vider pending
        changelog.releases.unshift(release); // Ajouter en premier
        changelog.pending = [];
        changelog.version = newVersion;
        
        // Sauvegarder le changelog
        saveChangelog(changelog);
        
        // Mettre à jour package.json
        updatePackageVersion(newVersion);
        
        console.log(`🎉 Release ${newVersion} créée avec ${release.features.length} feature(s)`);
        return release;
        
    } catch (error) {
        throw new Error(`Erreur lors de la création de la release: ${error.message}`);
    }
}

/**
 * Met à jour la version dans package.json
 */
export function updatePackageVersion(version) {
    try {
        const packageData = JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf8'));
        packageData.version = version;
        fs.writeFileSync(PACKAGE_FILE, JSON.stringify(packageData, null, 2));
        console.log(`📦 Package.json mis à jour vers la version ${version}`);
        return true;
    } catch (error) {
        throw new Error(`Erreur lors de la mise à jour de package.json: ${error.message}`);
    }
}

/**
 * Obtient l'utilisateur Git actuel
 */
function getCurrentGitUser() {
    try {
        return execSync('git config user.name', { encoding: 'utf8' }).trim();
    } catch (error) {
        return 'Développeur PCR';
    }
}

/**
 * Obtient le hash du commit actuel
 */
function getCurrentCommitHash() {
    try {
        return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim().substring(0, 8);
    } catch (error) {
        return 'unknown';
    }
}

/**
 * Obtient la branche actuelle
 */
function getCurrentBranch() {
    try {
        return execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    } catch (error) {
        return 'unknown';
    }
}

/**
 * Obtient les statistiques du changelog
 */
export function getChangelogStats() {
    try {
        const changelog = readChangelog();
        return {
            currentVersion: changelog.version,
            totalReleases: changelog.releases.length,
            pendingFeatures: changelog.pending.length,
            lastRelease: changelog.releases[0] || null,
            pendingByType: changelog.pending.reduce((acc, feature) => {
                acc[feature.type] = (acc[feature.type] || 0) + 1;
                return acc;
            }, {})
        };
    } catch (error) {
        return { error: error.message };
    }
}

/**
 * Supprime une feature pending par index
 */
export function removePendingFeature(index) {
    try {
        const changelog = readChangelog();
        
        if (index < 0 || index >= changelog.pending.length) {
            throw new Error('Index de feature invalide');
        }
        
        const removed = changelog.pending.splice(index, 1)[0];
        saveChangelog(changelog);
        
        console.log(`🗑️  Feature supprimée: ${removed.type} "${removed.name}"`);
        return removed;
    } catch (error) {
        throw new Error(`Erreur lors de la suppression: ${error.message}`);
    }
}

/**
 * Génère le markdown du changelog pour GitHub
 */
export function generateChangelogMarkdown() {
    try {
        const changelog = readChangelog();
        let markdown = `# Changelog PCR Bot\n\n`;
        
        changelog.releases.forEach(release => {
            markdown += `## [${release.version}] - ${release.date}\n\n`;
            markdown += `### ${release.title}\n\n`;
            
            const featuresByType = release.features.reduce((acc, feature) => {
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
                
                markdown += `#### ${typeTitle}\n\n`;
                features.forEach(feature => {
                    markdown += `- **${feature.name}**: ${feature.description}`;
                    if (feature.author) markdown += ` (par ${feature.author})`;
                    markdown += `\n`;
                });
                markdown += `\n`;
            });
        });
        
        return markdown;
    } catch (error) {
        throw new Error(`Erreur lors de la génération du markdown: ${error.message}`);
    }
}
