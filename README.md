# 🤖 PCR Bot Discord

Bot Discord communautaire avec script de gestion unifié pour simplifier le développement et le déploiement.

## ✨ Fonctionnalités

### 🎮 Commandes Discord
- **`/safe-place`** - Permet de se libérer anonymement dans un channel dédié
- **`/poll`** - Crée des sondages interactifs
- **`/color`** - Change la couleur du pseudo utilisateur
- **`/cotd`** - Color of the Day (couleur du jour)
- **`/pin`** - Épingle des messages
- **`/purge`** - Supprime des messages en masse
- **`/edit`** - Édite des messages
- **`/autodel`** - Suppression automatique de messages
- **`/weekPoll`** - Sondages hebdomadaires

### 🛠️ Script de gestion `pcr`
Le bot inclut un script de gestion unifié `pcr` qui simplifie toutes les opérations :

#### 🚀 Gestion du bot
```bash
pcr start         # Démarre le bot
pcr stop          # Arrête le bot  
pcr restart       # Redémarre le bot
pcr status        # Affiche le statut
```

#### 📊 Monitoring et logs
```bash
pcr logs          # Logs en temps réel
pcr monitor       # Monitoring complet
```

#### 🔧 Développement
```bash
pcr dev           # Mode développement avec nodemon
pcr command --name <nom> [--desc <description>] [--no-git]  # Crée une nouvelle commande avec branche Git automatique
pcr event --name <nom> [--no-git]                           # Crée un nouvel événement avec branche Git automatique
pcr branches      # Liste les branches de fonctionnalités PCR
```

**🌿 Workflow Git automatique :**
- Génération automatique de branches `feature/command-<nom>` et `feature/event-<nom>`
- Commits automatiques avec messages formatés
- Option de push vers le dépôt distant
- Gestion des conflits et branches existantes

#### 🚀 Déploiement
```bash
pcr deploy        # Déploiement complet
pcr update        # Mise à jour depuis Git
```

#### 💾 Sauvegarde
```bash
pcr backup        # Sauvegarde la base de données
pcr restore <fichier>  # Restaure une sauvegarde
```

#### ⚙️ Configuration
```bash
pcr install       # Installe le script globalement
pcr reset         # Réinitialisation complète
```

## 🚀 Installation

### Prérequis
- Node.js (v16+)
- npm ou yarn
- PM2 (pour la production)
- Git

### Installation rapide
```bash
# 1. Cloner le projet
git clone https://github.com/sydnec/PCR.git
cd PCR

# 2. Déployer automatiquement
./pcr deploy
```

### Installation manuelle
```bash
# 1. Cloner le projet
git clone https://github.com/sydnec/PCR.git
cd PCR

# 2. Installer les dépendances
npm install

# 3. Configuration
cp .env.example .env
# Éditer .env avec vos tokens

# 4. Démarrer
./pcr start
```

### Installation globale du script
```bash
# Installer le script pcr globalement
./pcr install

# Utiliser depuis n'importe où
pcr status
```

## ⚙️ Configuration

### Variables d'environnement (.env)
```env
DISCORD_TOKEN=votre_token_discord
CLIENT_ID=votre_client_id
GUILD_ID=votre_guild_id
# ... autres variables
```

### Structure du projet
```
PCR/
├── index.js              # Point d'entrée principal
├── pcr                   # Script de gestion unifié
├── package.json          # Dépendances et scripts
├── commands/             # Commandes Discord
│   ├── example          # Template pour nouvelles commandes
│   └── *.js            # Commandes existantes
├── events/              # Gestionnaires d'événements
│   └── client/
│       ├── example     # Template pour nouveaux événements
│       └── *.js       # Événements existants
├── functions/           # Fonctions utilitaires
├── modules/            # Modules partagés
└── backups/           # Sauvegardes automatiques
```

## 🔧 Développement

### Créer une nouvelle commande
```bash
# Commande simple
pcr command --name hello

# Commande avec description
pcr command --name welcome --desc "Accueille les nouveaux membres"
```

### Créer un nouvel événement
```bash
# Événement simple
pcr event --name messageUpdate
```

### Mode développement
```bash
# Démarrage avec rechargement automatique
pcr dev
```

## 📊 Monitoring

### Surveillance en temps réel
```bash
# Monitoring complet
pcr monitor

# Logs en temps réel
pcr logs

# Statut rapide
pcr status
```

### Sauvegardes automatiques
Le bot effectue des sauvegardes automatiques :
- Avant chaque mise à jour
- Avant chaque déploiement
- Manuellement avec `pcr backup`

## 🐳 Déploiement

### Production avec PM2
```bash
# Déploiement automatique
pcr deploy

# Mise à jour
pcr update

# Redémarrage
pcr restart
```

### CI/CD avec GitHub Actions
Le projet inclut des workflows GitHub Actions pour :
- Tests automatiques
- Déploiement automatique
- Vérification de code

## 📝 Commandes Discord détaillées

### `/safe-place`
Permet aux utilisateurs de s'exprimer anonymement dans un channel sécurisé.
```
/safe-place message: "Votre message anonyme"
```

### `/poll`
Crée des sondages avec émojis de réaction automatiques.
```
/poll question: "Votre question ?" option1 option2 option3
```

### `/color`
Change la couleur du rôle utilisateur.
```
/color couleur: "#FF0000"
```

## 🤝 Contribution

1. Fork le projet
2. Créez une branche (`git checkout -b feature/nouvelle-fonctionnalite`)
3. Committez vos changes (`git commit -am 'Ajoute nouvelle fonctionnalité'`)
4. Push vers la branche (`git push origin feature/nouvelle-fonctionnalite`)
5. Ouvrez une Pull Request

### Développement local
```bash
# Fork et clone
git clone https://github.com/votre-username/PCR.git
cd PCR

# Installation
pcr deploy

# Développement
pcr dev
```

## 📜 Licence

Ce projet est sous licence ISC. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

## 👤 Auteur

**Sydnec**
- GitHub: [@sydnec](https://github.com/sydnec)
- Projet: [PCR Bot](https://github.com/sydnec/PCR)

## 🆘 Support

- 📋 Issues: [GitHub Issues](https://github.com/sydnec/PCR/issues)
- 📖 Documentation: [README.md](README.md)
- 💬 Discord: Contactez Sydnec

---

## 🔄 Changelog

### v1.0.0
- ✅ Script de gestion unifié `pcr`
- ✅ Système de sauvegarde automatique
- ✅ Génération automatique de commandes/événements
- ✅ Monitoring avancé avec PM2
- ✅ Déploiement automatisé
