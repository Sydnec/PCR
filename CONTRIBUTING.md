# 🤝 Guide de Contribution - PCR Bot

Merci de votre intérêt pour contribuer au PCR Bot ! Ce guide vous aidera à bien commencer.

## 🚀 Démarrage rapide

### Prérequis
- Node.js 16+ 
- npm ou yarn
- Git
- Un serveur Discord de test

### Installation pour le développement
```bash
# 1. Fork et clone le projet
git clone https://github.com/votre-username/PCR.git
cd PCR

# 2. Installation automatique
./pcr deploy

# 3. Configuration
cp .env.example .env
# Éditer .env avec vos tokens

# 4. Mode développement
./pcr dev
```

## 📋 Types de contributions

### 🐛 Signaler des bugs
- Utilisez les [GitHub Issues](https://github.com/sydnec/PCR/issues)
- Incluez des informations détaillées
- Ajoutez des logs si possible

### ✨ Proposer des fonctionnalités
- Ouvrez une issue avec le label `enhancement`
- Décrivez clairement le besoin
- Proposez une solution si possible

### 🔧 Contribuer au code
- Fork le projet
- Créez une branche pour votre fonctionnalité
- Suivez les conventions de code
- Testez vos modifications
- Ouvrez une Pull Request

## 🏗️ Structure du projet

```
PCR/
├── index.js              # Point d'entrée
├── pcr                   # Script de gestion
├── commands/             # Commandes Discord
│   ├── example          # Template
│   └── *.js            # Commandes
├── events/              # Événements Discord
│   └── client/
│       ├── example     # Template  
│       └── *.js       # Événements
├── modules/            # Modules utilitaires
├── functions/          # Fonctions métier
└── .github/           # CI/CD GitHub Actions
```

## 🛠️ Développement

### Créer une nouvelle commande
```bash
# Génération automatique
./pcr command --name macommande --desc "Description de ma commande"

# Édition
nano commands/macommande.js

# Test
./pcr restart
```

### Créer un nouvel événement
```bash
# Génération automatique
./pcr event --name monevenement

# Édition
nano events/client/monevenement.js

# Test
./pcr restart
```

### Scripts disponibles
```bash
npm run dev      # Mode développement
npm run test     # Tests automatiques
npm run lint     # Vérification de code
npm run start    # Démarrage production
```

## 🧪 Tests

### Tests automatiques
```bash
# Lancer tous les tests
npm test

# Tests spécifiques
./pcr status     # Test du statut
./pcr backup     # Test de sauvegarde
```

### Tests manuels
1. Testez les commandes Discord
2. Vérifiez les logs avec `./pcr logs`
3. Testez le monitoring avec `./pcr monitor`

## 📝 Conventions de code

### JavaScript/Discord.js
- Utilisez ES6+ modules (`import/export`)
- Nommage en camelCase
- Commentaires explicatifs
- Gestion d'erreurs avec try/catch

### Exemple de commande
```javascript
import { SlashCommandBuilder } from 'discord.js';
import { handleException } from '../modules/utils.js';

export default {
    data: new SlashCommandBuilder()
        .setName('macommande')
        .setDescription('Description claire'),

    async execute(interaction) {
        try {
            // Votre logique ici
            await interaction.reply('Réponse');
        } catch (error) {
            handleException(error, interaction);
        }
    },
};
```

### Exemple d'événement
```javascript
import { handleException } from '../../modules/utils.js';

const name = 'monevenement';
const once = false;

async function execute(/* paramètres */) {
    try {
        // Votre logique ici
    } catch (error) {
        handleException(error);
    }
}

export { name, once, execute };
```

## 🔄 Workflow de contribution

### 1. Préparation
```bash
# Fork sur GitHub puis clone
git clone https://github.com/votre-username/PCR.git
cd PCR

# Ajout du remote upstream
git remote add upstream https://github.com/sydnec/PCR.git
```

### 2. Développement
```bash
# Création d'une branche
git checkout -b feature/ma-fonctionnalite

# Développement
./pcr dev

# Tests
npm test
```

### 3. Soumission
```bash
# Commit avec message clair
git add .
git commit -m "feat: ajout de ma fonctionnalité

- Description détaillée
- Impact sur le système
- Tests effectués"

# Push et Pull Request
git push origin feature/ma-fonctionnalite
```

## 📋 Checklist Pull Request

- [ ] Tests passent (`npm test`)
- [ ] Code lint passé (`npm run lint`)  
- [ ] Documentation mise à jour si nécessaire
- [ ] Changements testés manuellement
- [ ] Commit messages clairs
- [ ] Pas de fichiers sensibles (.env, tokens, etc.)

## 🏷️ Conventions de commits

Utilisez des prefixes clairs :
- `feat:` - Nouvelle fonctionnalité
- `fix:` - Correction de bug
- `docs:` - Documentation
- `style:` - Formatage (pas de changement de code)
- `refactor:` - Refactoring
- `test:` - Ajout de tests
- `chore:` - Maintenance

Exemple :
```
feat: ajout commande de modération

- Nouvelle commande /timeout
- Gestion des permissions
- Tests automatiques ajoutés
```

## 🚨 Signalement de sécurité

Pour les vulnérabilités de sécurité :
1. **NE PAS** créer d'issue publique
2. Contactez directement [@sydnec](https://github.com/sydnec)
3. Incluez une description détaillée
4. Proposez une solution si possible

## 💬 Support

- 📋 Issues: [GitHub Issues](https://github.com/sydnec/PCR/issues)
- 📖 Documentation: [README.md](README.md)
- 💬 Discord: Contactez Sydnec

## 🙏 Remerciements

Merci à tous les contributeurs qui rendent ce projet possible !

---

## 📊 CI/CD

Le projet utilise GitHub Actions pour :
- ✅ Tests automatiques
- 🔍 Vérification de qualité de code  
- 🚀 Déploiement automatique
- 📦 Releases automatiques

Les workflows se déclenchent sur :
- Push sur `main` et `develop`
- Pull Requests vers `main`
- Tags `v*.*.*` pour les releases
