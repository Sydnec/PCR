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

### 🔴 Pokémon — Capture & Pokédex

Système de capture qui sert de **puits à points** : chaque lancer de ball débite des points,
que la capture réussisse ou non.

- **Spawns automatiques** : un Pokémon de 1ʳᵉ génération apparaît dans un salon dédié au rythme de
  l'activité du serveur (~40 messages, 1 h minimum entre deux). Le spawn précédent s'enfuit quand le
  suivant arrive, donc un seul Pokémon est disponible à la fois.
- **Course à un vainqueur** : tout le monde peut lancer autant de balls qu'il veut, le premier jet
  réussi remporte le Pokémon. Les balls ratées sont définitivement perdues.
- **4 balls** : Poké Ball (×1), Super Ball (×2), Hyper Ball (×4) et Master Ball (capture garantie,
  avec confirmation obligatoire). Les probabilités suivent la formule officielle de la génération 3,
  à partir du taux de capture réel de chaque espèce.
- **Shiny** (~1/500) comptant comme une entrée de Pokédex distincte.
- **Commandes** :
  - `/pokedex [membre]` : collection, doublons, shinies et progression.
  - `/pokeclassement` : classement des dresseurs par espèces distinctes.
  - `/pokeinfo <pokemon>` : fiche, rareté et chances de capture par ball.
  - `/evolution <pokemon>` : fait évoluer un Pokémon en sacrifiant des doublons. Les lignées à
    embranchement (Évoli) peuvent évoluer au hasard, ou vers une cible choisie pour plus cher.
  - `/echange <membre> <je_donne> <je_recois>` : échange entre dresseurs.
  - `/pokespawn` *(Admin)* : déclenche une apparition pour organiser un événement. Donne accès aux
    espèces hors pool naturel (légendaires et évolutions par échange), avec forçage du shiny, texte
    d'annonce et mention de rôle.

**Réglages** : tous les nombres (prix, multiplicateurs, taux de shiny, cadence, poids de rareté,
coûts de fusion) vivent dans le bloc `pokemon` de `config.json`, relu à l'exécution — ils sont donc
modifiables **sans redémarrer le bot**. Le curseur `capture.globalMultiplier` rend l'ensemble du jeu
plus ou moins difficile tout en préservant la hiérarchie entre espèces.

**Données** : `modules/pokemon-gen1.json` est généré une fois par `npm run gen:pokemon` depuis le
dataset PokéAPI et commité — la production ne fait aucun appel réseau.

### 🛠️ Utilitaires & Communauté

- **Rappels** :
  - `/rappel` : Créer un rappel personnel.
  - `/mes-rappels` : Gérer ses rappels existants.
- **Safe Place** : `/safe-place` - Espace d'expression anonyme.
- **Personnalisation** : `/color` - Changement de la couleur du pseudo.
- **Threads** : `/join` - Rejoindre rapidement un fil de discussion.
- **Aide** : `/help` - Liste des commandes disponibles.

### 🛡️ Modération & Administration

- **Nettoyage** :
  - `/purge` : Suppression de messages en masse. (Admin uniquement).
  - `/autodel` : Configuration de la suppression automatique des messages dans un salon.
- **Gestion** :
  - `/edit` : Permet au bot d'éditer un de ses propres messages.
  - `/restart` : Redémarre le bot (Admin uniquement).

## 🚀 Installation & Gestion

Le projet inclut un script CLI puissant, **`pcr`**, pour gérer tout le cycle de vie de l'application.

### Prérequis

- Node.js 18+
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
├── events/         # Événements Discord (client, guild, interactions...)
├── functions/      # Handlers (timers, events, commands...)
├── modules/        # Modules partagés (DB, Utils, Regex, Economy...)
│   └── pokemon/    # Système de capture (données, spawns, capture, collection)
├── scripts/        # Scripts ponctuels (génération du dataset Pokémon)
├── pcr             # Script CLI de gestion
├── CICD.md         # Documentation du déploiement
└── index.js        # Point d'entrée
```
