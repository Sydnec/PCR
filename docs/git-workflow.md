# Workflow Git automatique pour PCR Bot

## 🌿 Génération automatique de branches

Le script PCR génère automatiquement des branches Git pour faciliter le développement en équipe et le suivi des fonctionnalités.

### 🔧 Création de commandes

```bash
# Crée une commande avec branche Git automatique
pcr command --name ma-commande --desc "Description de ma commande"

# Crée une commande sans branche Git (dev local uniquement)
pcr command --name ma-commande --desc "Description" --no-git
```

**Résultat :**
- ✅ Nouvelle branche : `feature/command-ma-commande`
- ✅ Fichier créé : `commands/ma-commande.js`
- ✅ Commit automatique avec message formaté
- ✅ Option de push vers le dépôt distant

### ⚡ Création d'événements

```bash
# Crée un événement avec branche Git automatique
pcr event --name messageUpdate

# Crée un événement sans branche Git
pcr event --name messageUpdate --no-git
```

**Résultat :**
- ✅ Nouvelle branche : `feature/event-messageUpdate`
- ✅ Fichier créé : `events/client/messageUpdate.js`
- ✅ Commit automatique avec message formaté
- ✅ Option de push vers le dépôt distant

## 📋 Gestion des branches

### Lister les branches de fonctionnalités

```bash
pcr branches
```

Affiche toutes les branches `feature/command-*` et `feature/event-*` avec leurs statuts.

### Workflow de développement recommandé

1. **Créer une fonctionnalité**
   ```bash
   pcr command --name nouvelle-feature
   # ou
   pcr event --name nouveauEvent
   ```

2. **Développer sur la branche**
   ```bash
   # La branche est automatiquement créée et activée
   git branch --show-current
   # → feature/command-nouvelle-feature
   ```

3. **Commits pendant le développement**
   ```bash
   git add .
   git commit -m "Amélioration de la logique"
   ```

4. **Push des modifications**
   ```bash
   git push origin feature/command-nouvelle-feature
   ```

5. **Créer une Pull Request**
   - Via GitHub/GitLab interface
   - Lien automatiquement fourni lors du push

6. **Merger et nettoyer**
   ```bash
   git checkout main
   git pull origin main
   git branch -d feature/command-nouvelle-feature
   ```

## 🔄 Convention de nommage des branches

- **Commandes :** `feature/command-<nom-commande>`
- **Événements :** `feature/event-<nom-evenement>`

## 📝 Format des messages de commit

### Pour les commandes
```
feat: add new Discord command 'nom-commande'

- Generated using 'pcr command --name nom-commande'
- File: nom-commande.js
- Ready for implementation
```

### Pour les événements
```
feat: add new Discord event 'nom-evenement'

- Generated using 'pcr event --name nom-evenement'
- File: nom-evenement.js
- Ready for implementation
```

## 🚨 Gestion des conflits

Si vous avez des modifications non committées lors de la création d'une branche :

1. Le script détecte automatiquement les changements
2. Propose de créer un commit de sauvegarde
3. Crée ensuite la nouvelle branche

```bash
⚠️  Changements non committés détectés
Voulez-vous créer un commit avant de créer la nouvelle branche? (O/n):
```

## ⚙️ Options avancées

### Désactiver Git
Pour un développement local sans gestion Git :

```bash
pcr command --name test --no-git
pcr event --name test --no-git
```

### Branches existantes
Si une branche existe déjà, le script :
- ✅ Détecte le conflit
- ✅ Propose de basculer sur la branche existante
- ✅ Évite la perte de données

## 🔍 Vérification d'état

```bash
# Voir toutes les branches de fonctionnalités
pcr branches

# Statut Git classique
git status
git branch -a

# Voir l'historique
git log --oneline --graph
```

## 📚 Exemples complets

### Développement d'une nouvelle commande

```bash
# 1. Créer la commande
pcr command --name ping --desc "Commande de test de latence"

# 2. Développer (vous êtes sur feature/command-ping)
nano commands/ping.js

# 3. Tester
pcr dev

# 4. Commits supplémentaires
git add commands/ping.js
git commit -m "Ajout de la logique de ping"

# 5. Push et PR
git push origin feature/command-ping
# Créer PR sur GitHub

# 6. Après merge, nettoyer
git checkout main
git pull origin main
git branch -d feature/command-ping
```

### Développement d'un événement

```bash
# 1. Créer l'événement
pcr event --name guildMemberJoin

# 2. Développer (vous êtes sur feature/event-guildMemberJoin)
nano events/client/guildMemberJoin.js

# 3. Le reste suit le même workflow...
```

## 🎯 Bonnes pratiques

1. **Une fonctionnalité = Une branche** : Ne mélangez pas plusieurs fonctionnalités
2. **Messages de commit clairs** : Décrivez précisément vos changements
3. **Tests avant merge** : Testez votre fonctionnalité avec `pcr dev`
4. **Nettoyage régulier** : Supprimez les branches mergées
5. **Pull réguliers** : Maintenez votre branche `main` à jour

## 🆘 Dépannage

### Erreur de branche existante
```bash
⚠️  La branche 'feature/command-test' existe déjà
```
**Solution :** Choisissez un nom différent ou basculez sur la branche existante.

### Pas dans un dépôt Git
```bash
❌ Pas dans un dépôt Git - ignorer la création de branche
```
**Solution :** Le script continue sans Git. Initialisez un dépôt si nécessaire.

### Erreur de push
```bash
⚠️ Erreur lors du push - vous pouvez le faire manuellement plus tard
```
**Solution :** Vérifiez votre connexion et les permissions du dépôt distant.
