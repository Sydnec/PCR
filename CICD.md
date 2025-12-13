# Documentation CI/CD - Projet PCR

Ce document décrit le processus d'intégration et de déploiement continu du bot PCR.

## 🔄 Flux de travail (Workflow)

Le déploiement est **automatisé** et déclenché par la création d'un **Tag Git** (versioning sémantique).

1.  **Développement** :
    *   Création d'une feature : `pcr feature <type> <nom>`
    *   Développement et tests locaux.
    *   Fusion dans la branche principale : `pcr finish`

2.  **Release (Déclencheur)** :
    *   Lancer la commande : `pcr release <type>` (ex: `pcr release patch`)
    *   **Action du script** :
        *   Met à jour `package.json` et `changelog.json`.
        *   Commit les changements.
        *   Crée un tag git (ex: `v1.7.3`).
        *   Push le commit et le tag vers GitHub.

3.  **Déploiement (GitHub Actions)** :
    *   Le workflow `.github/workflows/deploy.yml` détecte le nouveau tag `v*`.
    *   Il est exécuté directement sur votre serveur via un **Self-hosted Runner**.
    *   Il exécute la commande : `cd /home/sydnec/pcr && ./pcr update` (ou `deploy`).

## 🔑 Configuration

Puisque vous utilisez un **Self-hosted Runner**, vous n'avez **pas besoin** de configurer les secrets SSH (`SERVER_HOST`, `SSH_PRIVATE_KEY`, etc.).

Assurez-vous simplement que :
1.  Le runner est bien installé et "Active" dans les paramètres GitHub du dépôt.
2.  L'utilisateur qui fait tourner le runner a les droits d'écriture dans `/home/sydnec/pcr`.
3.  L'utilisateur a les droits d'exécuter `pm2` et `git`.

## 📂 Structure des fichiers CI/CD

*   `.github/workflows/deploy.yml` : Définition du pipeline GitHub Actions.
*   `.github/workflows/ci.yml` : Pipeline d'intégration continue (Linting) exécuté à chaque Push/PR sur main.
*   `pcr` : Script bash local qui gère les commandes `deploy` et `release`.

## ⚠️ Notes importantes

1.  **Fichier .env** : Le fichier `.env` contenant les tokens et clés API **n'est pas versionné**. Vous devez le créer manuellement sur le serveur dans `/home/sydnec/pcr/.env`.
2.  **Tests** : Le workflow CI exécute `npm run lint`. Si vous ajoutez des tests unitaires, décommentez la partie `npm test` dans `.github/workflows/ci.yml`.

## 📝 Commandes utiles pour le développeur

*   **Ne jamais modifier la version manuellement** dans `package.json` si vous comptez utiliser `pcr release`.
*   Assurez-vous que le serveur a bien **PM2** installé globalement (`npm install -g pm2`).
