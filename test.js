#!/usr/bin/env node

// 🧪 Tests basiques pour PCR Bot
// Ce fichier contient des tests simples pour valider le fonctionnement du bot

import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Couleurs pour les logs
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

function log(color, symbol, message) {
    console.log(`${colors[color]}${symbol} ${message}${colors.reset}`);
}

function success(message) {
    log('green', '✅', message);
}

function error(message) {
    log('red', '❌', message);
}

function warning(message) {
    log('yellow', '⚠️', message);
}

function info(message) {
    log('blue', 'ℹ️', message);
}

// Tests
async function runTests() {
    let passed = 0;
    let failed = 0;
    let warnings = 0;

    info('🧪 Début des tests PCR Bot');
    console.log('================================');

    // Test 1: Vérifier que les fichiers essentiels existent
    try {
        const essentialFiles = ['index.js', 'package.json', 'pcr'];
        
        for (const file of essentialFiles) {
            const filePath = join(__dirname, file);
            await fs.access(filePath);
            success(`Fichier ${file} existe`);
            passed++;
        }
    } catch (err) {
        error(`Fichier essentiel manquant: ${err.message}`);
        failed++;
    }

    // Test 2: Vérifier la structure des dossiers
    try {
        const essentialDirs = ['commands', 'events', 'modules'];
        
        for (const dir of essentialDirs) {
            const dirPath = join(__dirname, dir);
            const stat = await fs.stat(dirPath);
            if (stat.isDirectory()) {
                success(`Dossier ${dir} existe`);
                passed++;
            } else {
                error(`${dir} n'est pas un dossier`);
                failed++;
            }
        }
    } catch (err) {
        error(`Erreur de structure: ${err.message}`);
        failed++;
    }

    // Test 3: Vérifier package.json
    try {
        const packageJson = await fs.readFile(join(__dirname, 'package.json'), 'utf8');
        const pkg = JSON.parse(packageJson);
        
        if (pkg.name === 'pcr') {
            success('package.json - nom correct');
            passed++;
        } else {
            error('package.json - nom incorrect');
            failed++;
        }

        if (pkg.main === './index.js') {
            success('package.json - point d\'entrée correct');
            passed++;
        } else {
            error('package.json - point d\'entrée incorrect');
            failed++;
        }

        if (pkg.type === 'module') {
            success('package.json - type module configuré');
            passed++;
        } else {
            warning('package.json - type module non configuré');
            warnings++;
        }
    } catch (err) {
        error(`Erreur package.json: ${err.message}`);
        failed++;
    }

    // Test 4: Vérifier la syntaxe d'index.js
    try {
        const indexContent = await fs.readFile(join(__dirname, 'index.js'), 'utf8');
        
        if (indexContent.includes('discord.js')) {
            success('index.js - import Discord.js détecté');
            passed++;
        } else {
            error('index.js - import Discord.js non trouvé');
            failed++;
        }

        if (indexContent.includes('GatewayIntentBits')) {
            success('index.js - intents Discord.js détectés');
            passed++;
        } else {
            warning('index.js - intents Discord.js non détectés');
            warnings++;
        }
    } catch (err) {
        error(`Erreur index.js: ${err.message}`);
        failed++;
    }

    // Test 5: Vérifier les commandes
    try {
        const commandsDir = join(__dirname, 'commands');
        const commandFiles = await fs.readdir(commandsDir);
        const jsFiles = commandFiles.filter(file => file.endsWith('.js'));
        
        if (jsFiles.length > 0) {
            success(`${jsFiles.length} commande(s) trouvée(s)`);
            passed++;
        } else {
            warning('Aucune commande .js trouvée');
            warnings++;
        }

        // Vérifier le fichier example
        if (commandFiles.includes('example')) {
            success('Template de commande (example) trouvé');
            passed++;
        } else {
            warning('Template de commande (example) non trouvé');
            warnings++;
        }
    } catch (err) {
        error(`Erreur commandes: ${err.message}`);
        failed++;
    }

    // Test 6: Vérifier les événements
    try {
        const eventsDir = join(__dirname, 'events', 'client');
        const eventFiles = await fs.readdir(eventsDir);
        const jsFiles = eventFiles.filter(file => file.endsWith('.js'));
        
        if (jsFiles.length > 0) {
            success(`${jsFiles.length} événement(s) trouvé(s)`);
            passed++;
        } else {
            warning('Aucun événement .js trouvé');
            warnings++;
        }

        // Vérifier le fichier example
        if (eventFiles.includes('example')) {
            success('Template d\'événement (example) trouvé');
            passed++;
        } else {
            warning('Template d\'événement (example) non trouvé');
            warnings++;
        }
    } catch (err) {
        error(`Erreur événements: ${err.message}`);
        failed++;
    }

    // Test 7: Vérifier le script pcr
    try {
        const pcrPath = join(__dirname, 'pcr');
        const stat = await fs.stat(pcrPath);
        
        if (stat.mode & 0o111) {
            success('Script pcr est exécutable');
            passed++;
        } else {
            warning('Script pcr n\'est pas exécutable');
            warnings++;
        }

        const pcrContent = await fs.readFile(pcrPath, 'utf8');
        if (pcrContent.includes('#!/bin/bash')) {
            success('Script pcr - shebang bash correct');
            passed++;
        } else {
            error('Script pcr - shebang bash manquant');
            failed++;
        }
    } catch (err) {
        error(`Erreur script pcr: ${err.message}`);
        failed++;
    }

    // Résultats
    console.log('\n================================');
    info('📊 Résultats des tests');
    console.log('================================');
    success(`Tests réussis: ${passed}`);
    
    if (warnings > 0) {
        warning(`Avertissements: ${warnings}`);
    }
    
    if (failed > 0) {
        error(`Tests échoués: ${failed}`);
    }

    const total = passed + failed + warnings;
    const successRate = Math.round((passed / total) * 100);
    
    console.log(`\n📈 Taux de réussite: ${successRate}%`);
    
    if (failed > 0) {
        error('❌ Certains tests ont échoué');
        process.exit(1);
    } else if (warnings > 0) {
        warning('⚠️ Tests passés avec des avertissements');
        process.exit(0);
    } else {
        success('🎉 Tous les tests sont passés!');
        process.exit(0);
    }
}

// Exécuter les tests
runTests().catch(err => {
    error(`Erreur fatale: ${err.message}`);
    process.exit(1);
});
