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

## 🤖 GitHub Actions Automatique

Quand vous faites `pcr release`, le workflow suivant se déclenche automatiquement :

1. **Tag créé** → GitHub Actions se déclenche
2. **Release GitHub** créée avec changelog
3. **Archive** du projet générée 
4. **Notification Discord** envoyée (si configurée)
5. **CHANGELOG.md** mis à jour

## 📁 Structure des fichiers

```
PCR/
├── changelog.json          # ← Tracking des features et releases
├── CHANGELOG.md           # ← Généré automatiquement
├── package.json           # ← Version synchronisée
├── modules/
│   └── version-manager.js # ← Logique de gestion des versions
└── .github/workflows/
    └── release.yml        # ← Workflow GitHub Actions
```

## 🔧 Configuration

### Discord Notifications (Optionnel)
Pour activer les notifications Discord automatiques lors des releases :

1. Créez un webhook Discord dans votre canal changelog
2. Ajoutez le secret `DISCORD_CHANGELOG_WEBHOOK` dans GitHub

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

*Ce workflow a été conçu pour automatiser complètement le cycle de développement du PCR Bot, de la création de features jusqu'au déploiement.*
