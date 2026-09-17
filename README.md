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

- **Spawns automatiques** : un Pokémon de 1ʳᵉ génération apparaît dans un salon dédié, un seul à la
  fois. Dès que le salon est vide — le précédent ayant été capturé ou s'étant enfui — le **message
  suivant** en fait apparaître un nouveau. Tant qu'un Pokémon est là, ce sont le seuil de messages et
  le délai minimum (~40 messages et 1 h) qui décident du moment où il s'enfuit, remplacé par le
  suivant. Un délai plancher après capture est disponible (`minDelayAfterEndMinutes`, à 0 par défaut)
  si l'enchaînement devient trop rapide.
- **Fuite autonome** : chaque apparition reçoit une durée de vie tirée au hasard entre 3 et 6 heures
  (`fleeAfterMinutes`). Passé ce délai, un Pokémon que personne n'a capturé s'enfuit de lui-même,
  sans dépendre de l'activité du serveur — un salon silencieux ne reste donc jamais figé sur le même
  Pokémon. La durée de vie n'est jamais affichée.
- **Course à un vainqueur** : tout le monde peut lancer autant de balls qu'il veut, le premier jet
  réussi remporte le Pokémon. Les balls ratées sont définitivement perdues.
- **4 balls** : Poké Ball (×1), Super Ball (×2), Hyper Ball (×4) et Master Ball (capture garantie,
  avec confirmation obligatoire). Les probabilités suivent la formule officielle de la génération 3,
  à partir du taux de capture réel de chaque espèce.
- **Shiny** (~1/500) comptant comme une entrée de Pokédex distincte.
- **Bouton « ❓ Je l'ai déjà ? »** sur chaque apparition : un message Discord étant identique pour
  tous ses lecteurs, ce bouton répond à chacun en privé selon sa propre collection.
- À la capture comme à la fuite, l'embed affiche le **classement des points perdus** par dresseur,
  et le total part en pied de page.
- **Commandes** :
  - `/pokedex [membre]` : collection, doublons, shinies et progression. Réponse privée.
  - `/pokeclassement` : classement des dresseurs par espèces distinctes.
  - `/pokeinfo <pokemon>` : fiche, rareté et chances de capture par ball.
  - `/evolution <pokemon>` : fait évoluer un Pokémon en sacrifiant des doublons. Les lignées à
    embranchement (Évoli) peuvent évoluer au hasard, ou vers une cible choisie pour plus cher.
  - `/echange <membre> <je_donne> <je_recois>` : échange entre dresseurs.
  - `/safari` : paie l'entrée du parc safari (voir ci-dessous). Réponse privée.
  - `/pokespawn` *(Admin)* : déclenche une apparition pour organiser un événement. Donne accès aux
    espèces hors pool naturel (légendaires et évolutions par échange), avec forçage du shiny, texte
    d'annonce et mention de rôle.
  - `/safarispawn` *(Admin)* : ouvre un parc safari à la demande, pour un événement ou pour offrir
    une visite à un dresseur en particulier.

### 🏕️ Parc Safari

Contrepoids du puits à points : le pool naturel étrangle volontairement les évolutions et les
légendaires (poids 100/35/10 par stade, 8 pour un légendaire), et le parc **compense ce malus** le
temps d'une visite. C'est le seul contenu Pokémon où les actions ne coûtent rien.

- **Ouverture aléatoire** : un tirage horaire (1 % par heure, soit environ un parc tous les quatre
  jours) annonce le parc dans le salon des apparitions, rôle Dresseur mentionné. Un délai minimum
  de 48 h sépare deux parcs. Le bouton reste cliquable **24 h**, mais les **apparitions ne sont
  suspendues que 6 h** — le temps que l'événement respire sans figer le salon pour la journée.
- **Une visite par dresseur**, et tout se passe en message privé : le bouton est public, la partie
  ne l'est pas.
- **25 actions**, gratuites, à répartir entre trois gestes :
  - 🟢 **Safari Ball** (×1,5) — tenter la capture. Un raté peut faire détaler le Pokémon.
  - 🍎 **Appâter** — ×2 sur les chances de capture, cumulable jusqu'à ×4 : deux appâts atteignent le
    plafond, le bouton se ferme ensuite plutôt que de laisser gaspiller une action. **Mais la baie
    le met sur ses gardes** : sa chance de détaler passe de 5 % à 8 % puis 11 %, et elle est tirée
    aussi bien après un lancer raté qu'au moment où il avale la baie. Appâter reste nettement
    rentable — deux appâts font passer un stade 3 de 2,2 à 3,9 captures pour 25 actions — mais ce
    n'est plus gratuit.
  - 🏃 **Essayer de fuir** — passer au Pokémon suivant, avec 10 % de chances d'échouer.
- **« Il te manque ? »** : chaque rencontre affiche si le dresseur possède déjà l'espèce — et la
  variante shiny compte à part. Le message étant privé, l'information tient dans l'embed, là où les
  apparitions publiques ont besoin d'un bouton pour répondre à chacun séparément.
- **Raretés compensées** : stade 2 ×2, stade 3 (les *rares*) ×4, légendaires ×3, shiny 1/250 au lieu
  de 1/500. Les rares passent de 1,3 % à 4 % du pool et les légendaires de 0,4 % à 1 %. Les
  évolutions par échange restent hors pool, comme à l'état sauvage.
- **Entrée payante** : `/safari` ouvre une visite hors événement pour **5 000 points**, avec un
  cooldown de 24 h. Si un parc gratuit attend le dresseur, la commande le lui dit au lieu de
  débiter. Une visite entamée expire au bout d'une heure.
- Tout l'état vit en base : les boutons répondent encore après un redémarrage du bot, et un
  double-clic ne peut pas jouer deux fois la même action.

**Réglages** : tous les nombres (prix, multiplicateurs, taux de shiny, cadence, poids de rareté,
coûts de fusion, et l'intégralité du parc safari dans `pokemon.safari`) vivent dans le bloc
`pokemon` de `config.json`, relu à l'exécution — ils sont donc modifiables **sans redémarrer le
bot**. Le curseur `capture.globalMultiplier` rend l'ensemble du jeu
plus ou moins difficile tout en préservant la hiérarchie entre espèces.

**Données** : `modules/pokemon-gen1.json` est généré une fois par `npm run gen:pokemon` depuis le
dataset PokéAPI et commité — la production ne fait aucun appel réseau.

**Statistiques annuelles** : le jeu alimente en continu `botdata-<ANNÉE>.db` (tables `pokemon_stats`,
`pokemon_ball_stats`, `pokemon_species_stats`, `pokemon_highlights`, `pokemon_daily_stats`). Comme ce
fichier change au 1ᵉʳ janvier, la base **est** le périmètre de l'année : un récap de fin d'année n'a
qu'à lire ces tables, sans aucun filtre de date. La ligne `__global__` porte les totaux du serveur,
comme pour `message_stats`. Points brûlés, captures attendues contre captures réelles (donc la chance
de chacun), records personnels, shinies et légendaires capturés : tout y est.

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
