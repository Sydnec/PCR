#!/bin/bash

# Script de mise à jour du bot Discord PCR
# Ce script met à jour le bot depuis GitHub et le redémarre avec PM2

set -e  # Arrêter le script en cas d'erreur

# Couleurs pour les messages
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Nom du processus PM2 (à ajuster selon votre configuration)
PM2_PROCESS_NAME="pcr"

echo -e "${BLUE}🚀 Début de la mise à jour du bot PCR...${NC}"

# Vérifier si PM2 est installé
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}❌ PM2 n'est pas installé. Veuillez l'installer avec: npm install -g pm2${NC}"
    exit 1
fi

# Vérifier si Git est installé
if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ Git n'est pas installé. Veuillez l'installer.${NC}"
    exit 1
fi

# Vérifier si Node.js est installé
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js n'est pas installé. Veuillez l'installer.${NC}"
    exit 1
fi

# Vérifier si npm est installé
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm n'est pas installé. Veuillez l'installer.${NC}"
    exit 1
fi

echo -e "${YELLOW}📋 Vérification du statut PM2...${NC}"
# Vérifier si le processus PM2 existe et obtenir son statut
if pm2 describe $PM2_PROCESS_NAME &> /dev/null; then
    echo -e "${GREEN}✅ Processus PM2 '$PM2_PROCESS_NAME' trouvé${NC}"
    
    echo -e "${YELLOW}⏹️ Arrêt du bot...${NC}"
    pm2 stop $PM2_PROCESS_NAME
else
    echo -e "${YELLOW}⚠️ Processus PM2 '$PM2_PROCESS_NAME' non trouvé. Le bot sera démarré après la mise à jour.${NC}"
fi

# Sauvegarder la branche actuelle
current_branch=$(git branch --show-current)
echo -e "${BLUE}📝 Branche actuelle: $current_branch${NC}"

# Stash des changements locaux non commités (si il y en a)
if ! git diff-index --quiet HEAD --; then
    echo -e "${YELLOW}💾 Sauvegarde des changements locaux...${NC}"
    git stash push -m "Auto-stash avant mise à jour $(date)"
    stashed=true
else
    stashed=false
fi

echo -e "${BLUE}🔄 Récupération des dernières modifications...${NC}"
# Récupérer les dernières modifications
git fetch origin

echo -e "${BLUE}⬇️ Mise à jour du code...${NC}"
# Merger les changements
git pull origin $current_branch

# Vérifier si package.json a été modifié
if git diff HEAD@{1} HEAD --name-only | grep -q "package.json"; then
    echo -e "${YELLOW}📦 package.json a été modifié, mise à jour des dépendances...${NC}"
    npm install
else
    echo -e "${GREEN}✅ Aucune modification de dépendances détectée${NC}"
fi

# Vérifier si package-lock.json existe et le mettre à jour si nécessaire
if [ -f "package-lock.json" ]; then
    echo -e "${BLUE}🔒 Mise à jour du package-lock.json...${NC}"
    npm ci
fi

echo -e "${GREEN}🚀 Redémarrage du bot...${NC}"
# Redémarrer ou démarrer le bot avec PM2
if pm2 describe $PM2_PROCESS_NAME &> /dev/null; then
    pm2 restart $PM2_PROCESS_NAME
else
    echo -e "${BLUE}🆕 Démarrage initial du bot avec PM2...${NC}"
    pm2 start index.js --name $PM2_PROCESS_NAME
fi

# Attendre quelques secondes pour vérifier que le bot démarre correctement
sleep 3

# Vérifier le statut du bot
echo -e "${BLUE}📊 Statut du bot:${NC}"
pm2 status $PM2_PROCESS_NAME

# Afficher les logs récents
echo -e "${BLUE}📜 Logs récents:${NC}"
pm2 logs $PM2_PROCESS_NAME --lines 10

# Restaurer les changements stashés si nécessaire
if [ "$stashed" = true ]; then
    echo -e "${YELLOW}🔄 Restauration des changements locaux sauvegardés...${NC}"
    git stash pop
fi

echo -e "${GREEN}✅ Mise à jour terminée avec succès !${NC}"
echo -e "${BLUE}💡 Commandes utiles:${NC}"
echo -e "  - Voir les logs: ${YELLOW}pm2 logs $PM2_PROCESS_NAME${NC}"
echo -e "  - Redémarrer: ${YELLOW}pm2 restart $PM2_PROCESS_NAME${NC}"
echo -e "  - Arrêter: ${YELLOW}pm2 stop $PM2_PROCESS_NAME${NC}"
echo -e "  - Statut: ${YELLOW}pm2 status${NC}"
