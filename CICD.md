# Documentation CI/CD - Projet PCR

Ce document décrit le processus d'intégration et de déploiement continu du bot PCR.

## 🔄 Flux de travail (Workflow)

Le déploiement est **automatisé** et déclenché par la création d'un **Tag Git** (versioning sémantique).

1.  **Développement** :

    - Création d'une feature : `pcr feature <type> <nom>`
    - Développement et tests locaux.
    - Fusion dans la branche principale : `pcr finish`

2.  **Release (Déclencheur)** :

    - Lancer la commande : `pcr release <type>` (ex: `pcr release patch`)
    - **Action du script** :
      - Met à jour `package.json` et `changelog.json`.
      - Commit les changements.
      - Crée un tag git (ex: `v1.7.3`).
      - Push le commit et le tag vers GitHub.

3.  **Déploiement (GitHub Actions)** :
    - Le workflow `.github/workflows/deploy.yml` détecte le nouveau tag `v*`.
    - Il est exécuté directement sur votre serveur via un **Self-hosted Runner**.
    - Il tire `main` dans `/home/sydnec/pcr`, puis exécute `bash ./pcr deploy`.
    - `pcr deploy` installe les dépendances avec `npm ci` : exactement les versions de `package-lock.json`, celles que la CI a testées et auditées. Si `npm ci` échoue, le déploiement s'arrête en erreur **avant** de toucher à PM2 : le bot en cours continue de tourner et le workflow apparaît en échec. `node_modules` peut alors être incomplet : relancer `pcr deploy` une fois la cause corrigée, avant tout redémarrage du bot.

## 🧪 Bot de test

Un second bot, avec sa propre application Discord et son propre serveur Discord, tourne sur la même
machine que la prod :

| | Prod | Test |
| --- | --- | --- |
| Branche | `main` | `development` |
| Dossier | `/home/sydnec/pcr` | `/home/sydnec/pcr-test` |
| Process PM2 | `PCR` | `PCR-TEST` |
| Déclencheur | un tag `v*` | un push sur `development` |
| Workflow | `deploy.yml` | `deploy-test.yml` |

- **Chaque push sur `development`** lance la CI, puis, seulement si elle est verte, met à jour le
  dossier de test (`git pull --ff-only`) et exécute `pcr deploy`. Deux déploiements de test ne se
  chevauchent jamais.
- **Le nom PM2 vient du dossier** : `pcr` lancé dans `/home/sydnec/pcr` pilote `PCR`, lancé dans
  `/home/sydnec/pcr-test` pilote `PCR-TEST`. Hors du dossier d'un bot, `pcr start`, `stop`,
  `restart`, `status`, `logs`, `deploy`, `backup` et `update` refusent de s'exécuter.
- **Les données sont séparées** : chaque dossier a ses bases et son `config.json`.

### Mise en place (une fois)

1. Créer l'application Discord du bot de test, l'inviter sur le serveur de test.
2. Cloner le dépôt sur `development` :
   ```bash
   git clone -b development https://github.com/Sydnec/PCR.git /home/sydnec/pcr-test
   ```
3. Créer `/home/sydnec/pcr-test/.env` avec le jeton du bot de test, les identifiants du serveur de
   test, et un `WEB_PORT` différent de celui de la prod (ou aucun, sans site).
4. Copier la base de prod sans arrêter le bot (`.backup` fait une copie cohérente même pendant les
   écritures) :
   ```bash
   sqlite3 /home/sydnec/pcr/points.db ".backup /home/sydnec/pcr-test/points.db"
   ```
5. Premier lancement : le prochain push sur `development` le fait (`pcr deploy` démarre le process
   s'il n'existe pas encore). Pour le lancer tout de suite, depuis le dossier de test, avec le
   script **du dossier** (`./pcr`) :
   ```bash
   cd /home/sydnec/pcr-test && ./pcr deploy
   ```

Ensuite, chaque push sur `development` met le bot de test à jour tout seul.

> ⚠️ **Jusqu'à ce que ce changement arrive sur `main`**, le `pcr` global (installé par `pcr install`)
> pointe vers le script de la prod, qui vise toujours `PCR`, quel que soit le dossier. Dans le
> dossier de test, utiliser `./pcr …` : un `pcr restart` y redémarrerait la prod.

## 🔑 Configuration

Puisque vous utilisez un **Self-hosted Runner**, vous n'avez **pas besoin** de configurer les secrets SSH (`SERVER_HOST`, `SSH_PRIVATE_KEY`, etc.).

Assurez-vous simplement que :

1.  Le runner est bien installé et "Active" dans les paramètres GitHub du dépôt.
2.  L'utilisateur qui fait tourner le runner a les droits d'écriture dans `/home/sydnec/pcr` et `/home/sydnec/pcr-test`.
3.  L'utilisateur a les droits d'exécuter `pm2` et `git`.

## 📂 Structure des fichiers CI/CD

- `.github/workflows/deploy.yml` : Déploiement de la prod, sur un tag.
- `.github/workflows/deploy-test.yml` : Déploiement du bot de test, sur un push de `development`, après la CI.
- `.github/workflows/ci.yml` : Pipeline d'intégration continue exécuté à chaque push sur main, chaque PR vers main ou development, et avant chaque déploiement de test : ESLint (`npm run lint`), mise en forme du site (`npm run format:check`, Prettier sur `web/`), audit des dépendances (`npm audit --audit-level=high`, qui bloque sur une vulnérabilité haute ou critique) et tests automatiques (`npm test`, voir [docs/tests.md](docs/tests.md)).
- `.github/workflows/codeql.yml` : Analyse de sécurité CodeQL, à chaque PR et chaque semaine (alertes dans l'onglet *Security*).
- `.github/dependabot.yml` : Dependabot propose chaque semaine les mises à jour des dépendances npm et des actions GitHub.
- `pcr` : Script bash local qui gère les commandes `deploy` et `release`.

## ⚠️ Notes importantes

1.  **Fichier .env** : Le fichier `.env` contenant les tokens et clés API **n'est pas versionné**. Vous devez le créer manuellement sur le serveur dans `/home/sydnec/pcr/.env`, et celui du bot de test dans `/home/sydnec/pcr-test/.env`.
2.  **Tests** : Le workflow CI exécute ESLint, Prettier, `npm audit` et la suite de tests (`npm test`). Les tests travaillent dans un dossier jetable (`PCR_DATA_DIR`) : ils n'ont besoin ni de `.env` ni des vraies bases. Voir [docs/tests.md](docs/tests.md).
3.  **Runner auto-hébergé** : le dépôt est public. Seuls `deploy.yml` (sur un tag) et le job de déploiement de `deploy-test.yml` (sur un push de `development`) tournent sur la machine du bot ; seuls les collaborateurs peuvent pousser l'un ou l'autre. Aucun workflow déclenché par une PR ne doit y tourner : une PR venue d'un fork exécuterait son code sur le serveur.

## 📝 Commandes utiles pour le développeur

- **Ne jamais modifier la version manuellement** dans `package.json` si vous comptez utiliser `pcr release`.
- Assurez-vous que le serveur a bien **PM2** installé globalement (`npm install -g pm2`).
