p# 🚀 Workflow de Développement PCR Bot

Ce document décrit le nouveau workflow de développement automatisé pour le PCR Bot, incluant la gestion automatique des changelogs et des releases.

## 📋 Vue d'ensemble

Le workflow PCR utilise un système de gestion des versions et changelogs automatisé qui :
- ✅ Suit les features en développement dans `changelog.json`
- ✅ Incrémente automatiquement les versions
- ✅ Génère des releases GitHub avec changelogs
- ✅ Publie automatiquement les notifications Discord
- ✅ Gère le cycle complet git (branches, commits, merges)

## 🛠️ Commandes Principales

### 1. Créer une nouvelle feature
```bash
# Pour une nouvelle commande Discord
pcr command --name ma-commande

# Pour un nouvel événement Discord  
pcr event --name mon-event
```
- Crée automatiquement une branche `feature/command-nom` ou `feature/event-nom`
- Génère le fichier de base
- Configure l'environnement de développement

### 2. Développer la feature
- Modifiez le fichier généré selon vos besoins
- Testez avec `pcr restart && pcr logs`
- Commitez vos changements progressivement

### 3. Finaliser la feature
```bash
pcr finish
```
- ✅ Commit final automatique
- ✅ Push vers origin  
- ✅ Merge automatique vers main
- ✅ Ajout de la feature au changelog pending
- ✅ Nettoyage des branches (optionnel)

### 4. Créer une release
```bash
# Release patch (x.x.X+1)
pcr release --type patch

# Release minor (x.X+1.0)  
pcr release --type minor

# Release major (X+1.0.0)
pcr release --type major

# Avec titre personnalisé
pcr release --type patch --title "Correctifs de sécurité"
```
- ✅ Groupe toutes les features pending
- ✅ Incrémente la version automatiquement
- ✅ Met à jour `package.json` et `changelog.json`
- ✅ Génère `CHANGELOG.md`
- ✅ Crée un tag Git
- ✅ Push → déclenche GitHub Actions

## 📊 Commandes de suivi

### Voir le statut du changelog
```bash
pcr changelog-status
```
Affiche :
- Version actuelle
- Nombre de features pending
- Dernière release
- Répartition par type

### Voir les branches actives
```bash
pcr branches
```

### Guide du workflow
```bash
pcr workflow
```

## 🤖 Notifications Discord Automatiques

Quand vous faites `pcr release`, le workflow suivant se déclenche automatiquement :

1. **Tag créé** → GitHub Actions se déclenche
2. **Release GitHub** créée avec changelog
3. **Archive** du projet générée 
4. **CHANGELOG.md** mis à jour
5. **Bot redémarre** → Détecte automatiquement la nouvelle version
6. **Notification Discord** envoyée par le bot (uniquement pour minor/major)

### 🎯 Règles de notification Discord

- **🔧 Releases PATCH** (x.x.X+1) : **PAS de notification Discord**
  - Corrections de bugs, petites améliorations
  - Crée toujours la release GitHub
  - Mais le bot ignore l'annonce Discord

- **✨ Releases MINOR** (x.X+1.0) : **Notification Discord envoyée**
  - Nouvelles fonctionnalités, nouvelles commandes
  - Annonce publique dans le canal changelog

- **🚀 Releases MAJOR** (X+1.0.0) : **Notification Discord envoyée**
  - Changements majeurs, breaking changes
  - Annonce publique importante

## 📁 Structure des fichiers

```
PCR/
├── changelog.json              # ← Tracking des features et releases
├── CHANGELOG.md               # ← Généré automatiquement
├── package.json               # ← Version synchronisée
├── last-announced-version.txt # ← Tracking des notifications Discord
├── modules/
│   ├── version-manager.js     # ← Logique de gestion des versions
│   └── changelog-notifier.js  # ← Notifications Discord automatiques
├── events/client/
│   └── ready.js               # ← Vérification auto des releases
└── .github/workflows/
    └── release.yml            # ← Workflow GitHub Actions
```

## 🔧 Configuration

### Discord Notifications Automatiques
Pour activer les notifications Discord automatiques lors des releases :

1. **Configurez le canal dans votre bot** :
   ```bash
   # Dans votre fichier .env
   CHANGELOG_CHANNEL_ID="votre_channel_id_ici"
   ```

2. **Le bot s'occupe du reste** :
   - Détection automatique des nouvelles versions au démarrage
   - Publication d'un embed Discord avec les détails de la release
   - Uniquement pour les versions minor/major (pas les patches)

### Configuration obsolète (GitHub Webhook)
⚠️ **Plus nécessaire** : Le système de webhook GitHub a été remplacé par les notifications directes du bot.

**Ancien système (ne plus utiliser)** :
```bash
# Settings → Secrets and variables → Actions → New repository secret
Name: DISCORD_CHANGELOG_WEBHOOK  
Value: https://discord.com/api/webhooks/...
```

## 📋 Exemple complet

```bash
# 1. Créer une nouvelle commande
pcr command --name hello --desc "Commande de salutation"

# 2. Développer (éditer le fichier généré)
# ... développement ...

# 3. Finaliser
pcr finish

# 4. Créer une release quand prêt
pcr release --type patch
```

## 🎯 Types de features supportés

Le système reconnaît automatiquement :
- **command** : Nouvelles commandes Discord (`/command`)
- **event** : Nouveaux événements Discord (messageCreate, etc.)
- **feature** : Nouvelles fonctionnalités générales
- **fix** : Corrections de bugs
- **enhancement** : Améliorations

## 💡 Bonnes pratiques

1. **Une feature = une branche** - Ne mélangez pas plusieurs features
2. **Testez avant finish** - Utilisez `pcr restart && pcr logs`
3. **Groupez les releases** - Attendez d'avoir plusieurs features avant release
4. **Messages clairs** - Utilisez des descriptions précises pour vos features
5. **Vérifiez le statut** - `pcr changelog-status` avant release
6. **Patch vs Minor** - Utilisez `patch` pour les corrections, `minor` pour les nouvelles features
7. **Canal configuré** - Assurez-vous que `CHANGELOG_CHANNEL_ID` est défini pour les notifications Discord

## 🚨 Résolution de problèmes

### Problème de merge
```bash
# Si un conflit survient lors de pcr finish
git status
# Résolvez les conflits manuellement
git add .
git commit -m "resolve conflicts"
git push origin main
```

### Réinitialiser les features pending
```bash
# Éditer changelog.json manuellement pour supprimer
# les features de la section "pending" si nécessaire
```

### Erreur de version
```bash
# Vérifier la cohérence entre package.json et changelog.json
pcr changelog-status
```

## 📚 Ressources

- [Documentation Discord.js](https://discord.js.org/)
- [GitHub Actions](https://docs.github.com/en/actions)
- [Semantic Versioning](https://semver.org/)

---

*Ce workflow a été conçu pour automatiser complètement le cycle de développement du PCR Bot, de la création de features jusqu'au déploiement et aux notifications Discord automatiques.*

**Nouveautés v1.0.0 :**
- 🤖 Notifications Discord intégrées au bot (plus besoin de webhooks)
- 🎯 Notifications intelligentes (minor/major uniquement)
- 📦 Système de tracking des annonces pour éviter les doublons
- ✨ Workflow entièrement automatisé du développement au déploiement
