# 🤖 PCR - Bot Discord Communautaire

PCR est un bot Discord modulaire conçu pour animer et gérer la communauté. Il intègre des fonctionnalités de modération, d'animation (sondages, calendrier de l'avent), et des utilitaires pratiques.

## ✨ Fonctionnalités Principales

### 📅 Événements & Animation

- **COTD (Celebration of the Day)** : Annonce quotidienne des fêtes et saints du jour.
- **Calendrier de l'Avent** : Système automatique de threads quotidiens en décembre.
- **Récapitulatifs Annuels** : Génération de statistiques et souvenirs de l'année (`/recap`).
- **Sondages** :
  - `/poll` : Création de sondages simples.
  - `/weekPoll` : Sondages hebdomadaires automatisés.
- **Jeux & Aléatoire** :
  - `/ecaflip` : Pile ou face (ou choix multiple aléatoire).
  - `/randomizabaise` : Commande fun aléatoire (Easter egg communautaire).

### 🔴 Pokémon

Un jeu de capture de Pokémon — 1ʳᵉ génération, la 2ᵉ prête à s'ouvrir d'une commande — qui sert de
**puits à points** : chaque lancer de ball débite des points, que la capture réussisse ou non.
Toutes ses commandes vivent sous `/pk`. → **[Documentation du jeu](docs/pokemon/README.md)**

- [Capture & Pokédex](docs/pokemon/capture.md) — apparitions, balls, shiny, fiche d'espèce.
- [Individus](docs/pokemon/individus.md) — sexe, ball de capture, fertilité, `/pk boite`.
- [Œufs](docs/pokemon/oeufs.md) — la seule façon d'obtenir les bébés.
- [Objets](docs/pokemon/objets.md) — ce que tiennent les Pokémon, balls offertes, pierres.
- [Loterie](docs/pokemon/loterie.md) — un tirage par jour et par dresseur.
- [Revente](docs/pokemon/revente.md) — doublons et objets contre des points.
- [Parc Safari](docs/pokemon/safari.md) — l'événement où les actions ne coûtent rien.
- [Site web](docs/site.md) — capture en direct, boîte, Pokédex, sac et œuf dans le navigateur, et son [API](docs/api.md).

### 💰 Économie & Pot commun

Les points se gagnent au fil des messages et se dépensent dans les paris, les Pokémon et le parc
safari. Chaque semaine, un pot commun prélève un pourcentage des soldes et le redistribue à parts
égales. → [Détails](docs/economie.md)

### 🛠️ Utilitaires & Communauté

- **Rappels** :
  - `/rappel` : Créer un rappel personnel.
  - `/mes-rappels` : Gérer ses rappels existants.
- **Safe Place** : `/safe-place` - Espace d'expression anonyme.
- **Personnalisation** : `/color` - Changement de la couleur du pseudo.
- **Threads** : `/join` - Rejoindre rapidement un fil de discussion.
- **Aide** : `/help` - Liste des commandes disponibles.

### 🛡️ Modération & Administration

- `/autodel`, `/edit`, et `/admin` pour tout le reste : points et objets, configuration à chaud,
  apparitions et parcs à la demande, pot commun, purge, redémarrage. → [Détails](docs/administration.md)
- Les réglages s'empilent en trois couches (`DEFAULTS`, `config.json`, `config.local.json`) et se
  modifient sans redémarrage. → [Configuration](docs/configuration.md)

## 🚀 Installation & Gestion

Le projet inclut un script CLI puissant, **`pcr`**, pour gérer tout le cycle de vie de l'application.

### Prérequis

- Node.js 24 (voir `.nvmrc`)
- PM2 (`npm install -g pm2`)
- Git

### Installation Rapide

```bash
# 1. Cloner le projet
git clone https://github.com/Sydnec/PCR.git
cd PCR

# 2. Installer le script CLI globalement (optionnel)
./pcr install

# 3. Configurer l'environnement
cp .env.example .env
# Éditez .env avec vos tokens Discord
```

### Commandes de Gestion (`pcr`)

| Commande      | Description                                                       |
| ------------- | ----------------------------------------------------------------- |
| `pcr start`   | Démarre le bot via PM2                                            |
| `pcr stop`    | Arrête le bot                                                     |
| `pcr restart` | Redémarre le bot                                                  |
| `pcr status`  | Affiche l'état du processus PM2                                   |
| `pcr logs`    | Affiche les logs en temps réel                                    |
| `pcr monitor` | Ouvre le tableau de bord de monitoring PM2                        |
| `pcr deploy`  | Installe les dépendances et lance/recharge le bot (Zero Downtime) |
| `pcr backup`  | Crée une archive de sauvegarde du projet                          |

## 💻 Développement

Le script `pcr` facilite le workflow de développement en standardisant la création de fonctionnalités.

### Créer une nouvelle fonctionnalité

```bash
# Crée une branche feature/ma-commande et un fichier depuis le template
pcr feature command ma-commande

# Autres types disponibles :
pcr feature event mon-event
pcr feature handler mon-handler
```

### Finaliser une fonctionnalité

Une fois le développement terminé sur votre branche :

```bash
# Merge la branche courante dans main, supprime la branche locale et pull
pcr finish
```

Les livraisons de Claude arrivent, elles, par une PR déjà mergée dans `main`, entrée du changelog
comprise : il ne reste que `git pull && pcr release <fix|minor|major>` (voir [CLAUDE.md](./CLAUDE.md)).

## 📦 Déploiement & CI/CD

Le projet utilise **GitHub Actions** pour le déploiement continu.

### Workflow de Release

Pour déployer une nouvelle version en production :

1.  Assurez-vous d'être sur `main` et que tout est propre.
2.  Lancez la commande de release :

    ```bash
    pcr release patch  # ou minor, major
    ```

    - Cela met à jour `package.json` et `changelog.json`.
    - Crée un commit et un tag git (ex: `v1.7.4`).
    - Pousse le tout sur GitHub.

3.  **Automatiquement**, GitHub Actions :
    - Détecte le nouveau tag.
    - Déclenche le déploiement sur le serveur de production (via Self-hosted runner).
    - Exécute `./pcr deploy` sur le serveur.

Pour plus de détails sur la configuration CI/CD, voir [CICD.md](./CICD.md).

## 📂 Structure du Projet

```
.
├── commands/       # Commandes Slash Discord (ecaflip, poll, safe-place...)
│   ├── admin/      # Sous-commandes de /admin
│   └── pk/         # Sous-commandes de /pk (le jeu Pokémon)
├── docs/           # Documentation détaillée (Pokémon, économie, configuration, administration)
├── events/         # Événements Discord (client, guild, interactions...)
├── functions/      # Handlers (timers, events, commands...)
├── modules/        # Modules partagés (DB, Utils, Regex, Economy...)
│   ├── pokemon/    # Système de capture (données, spawns, capture, collection)
│   └── web/        # Serveur du site et API (connexion Discord, routes)
├── scripts/        # Scripts ponctuels (génération du dataset Pokémon)
├── web/            # Le site (fichiers statiques, sans compilation)
├── pcr             # Script CLI de gestion
├── CICD.md         # Documentation du déploiement
├── CLAUDE.md       # Consignes de livraison pour Claude
└── index.js        # Point d'entrée
```