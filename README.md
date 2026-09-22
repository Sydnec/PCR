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
- **Panneau de relance** : la réponse privée à un lancer porte elle-même les quatre balls et se
  **réécrit** à chaque jet, au lieu d'empiler un message par lancer. Plus besoin de remonter à
  l'annonce pour relancer — et si on y remonte quand même, le nouveau panneau remplace l'ancien :
  un dresseur n'en a jamais qu'un seul ouvert. Dès que le Pokémon n'est plus là, le panneau te le dit et retire ses
  boutons — au clic suivant : Discord ne permet pas de modifier un message privé sans que son
  destinataire n'agisse.
- **4 balls** : Poké Ball (×1), Super Ball (×2), Hyper Ball (×4) et Master Ball (capture garantie,
  avec confirmation obligatoire). Les probabilités suivent la formule officielle de la génération 3,
  à partir du taux de capture réel de chaque espèce.
- **Shiny** (~1/500) comptant comme une entrée de Pokédex distincte.
- **Bouton « ℹ️ Infos du Pokémon »** sur chaque apparition : un message Discord étant identique
  pour tous ses lecteurs, ce bouton ouvre à chacun en privé la fiche de l'espèce — type, rareté,
  chances à la Poké Ball, et toute la lignée évolutive avec ce qu'il en possède déjà — suivie de
  **son solde de points**, l'autre question qu'on se pose devant une apparition.
- À la capture comme à la fuite, l'embed affiche le **classement des points perdus** par dresseur,
  et le total part en pied de page.
- **Commandes** :
  - `/pokedex [membre]` : collection, doublons, shinies et progression. Réponse privée.
  - `/pokeclassement` : classement des dresseurs par espèces distinctes.
  - `/pokeinfo <pokemon>` : la même fiche que le bouton des apparitions — type, rareté,
    difficulté, et la lignée évolutive stade par stade avec ce que le dresseur en a déjà.
  - `/evolution <pokemon>` : fait évoluer un Pokémon en sacrifiant des doublons. Les lignées à
    embranchement (Évoli) peuvent évoluer au hasard, ou vers une cible choisie pour plus cher.
  - `/echange <membre> <je_donne> <je_recois>` : échange entre dresseurs.
  - `/safari` : paie l'entrée du parc safari (voir ci-dessous). Réponse privée.
  - `/sac [membre]` : les objets qu'un dresseur a en poche (voir *Objets* ci-dessous).
  - `/admin pokespawn` *(Admin)* : déclenche une apparition pour organiser un événement. Donne accès aux
    espèces hors pool naturel (légendaires et évolutions par échange), avec forçage du shiny, texte
    d'annonce et mention de rôle.
  - `/admin safarispawn` *(Admin)* : ouvre un parc safari à la demande, pour un événement ou pour offrir
    une visite à un dresseur en particulier.

### 🎒 Objets

Le sac d'un dresseur, et rien de plus pour l'instant : la plomberie est posée, aucun objet ne tombe
encore tout seul. Le jour où des trésors apparaîtront, ils n'auront qu'à appeler `grantItem`.

- **Un objet est une clé et un compteur.** Ce qui lui donne un nom, une icône et une description vit
  dans `pokemon.items` de la configuration — donc réglable à chaud, comme les balls. Ce qui lui donne
  un *effet* vit dans le code de la fonctionnalité qui le consomme, et une clé sans effet reste un
  objet de collection parfaitement valide.
- **Une seule écriture retire un objet**, et elle est gardée (`count >= ?`, puis `this.changes`) :
  deux clics simultanés sur le même ticket, un seul l'emporte. Le perdant reçoit « tu ne l'as plus »,
  pas une erreur — ce n'est pas une panne.
- **Tout mouvement est journalisé** dans `pokemon_item_log` avec sa provenance. Le compteur dit ce
  qu'on a, le journal dit d'où ça vient : un objet consommé disparaît du sac et ne laisserait sinon
  aucune trace, alors que c'est précisément ce qu'on voudra relire.
- **La ligne survit à zéro**, comme dans le Pokédex et pour la même raison : `first_obtained_at`
  raconte depuis quand le dresseur connaît l'objet, et ça ne se retrouve pas après coup. Toute
  lecture filtre donc sur `count > 0`.
- **Catalogue de départ** : 🎟️ Ticket Safari, 🍬 Super Bonbon, 💎 Pépite. Aucun n'a encore d'effet,
  et seul `/admin item` peut en distribuer.

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
- **Une visite dure autant que le parc** : elle expire à la fermeture des grilles, avec un
  plancher d'une heure pour qui entre juste avant — 25 actions ne se jouent pas en dix minutes.
- **La visite se reprend** : l'éphémère se ferme d'un geste et personne ne peut le rouvrir à la
  place de son destinataire. Le bouton *« Entrer dans le parc »* le refait donc, avec la partie là
  où elle en était, et `/safari` fait de même — y compris une fois le parc fermé, quand son message
  n'a plus de bouton mais que la session court encore. Aucune action perdue, aucun point débité.
- **Entrée payante** : `/safari` ouvre une visite hors événement pour **5 000 points**, avec un
  cooldown de 24 h. Si un parc gratuit attend le dresseur, la commande le lui dit au lieu de
  débiter. Sans parc derrière elle, cette visite-là dure le plancher : une heure.
- **Partage du bilan** : la visite est privée de bout en bout, donc son bilan aussi. Un bouton
  **« 📤 Partager mon bilan »** le publie dans le salon courant, signé du dresseur et de son avatar.
  Une fois par visite — le verrou est en base, pas dans la disparition du bouton — et à la seule
  condition que **le bot** puisse y publier un embed : c'est lui qui poste, et exiger la même chose
  du dresseur revenait à lui refuser un bouton qu'on lui avait mis sous les yeux. Un envoi qui
  échoue rend le droit de réessayer.
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

### 💰 Économie & Pot commun

Les points se gagnent au fil des messages (`messagePointsDistribution` : les premiers de la journée
rapportent plus) et se dépensent dans les paris, les Pokémon et le parc safari.

**Le pot commun** corrige ce que cette économie a de cumulatif. Une fois par semaine, chacun cotise
un pourcentage de sa fortune et la cagnotte repart en **parts égales** entre tous les porteurs de
`DEFAULT_ROLE_ID` — un impôt sur le capital : les gros soldes financent, tout le monde reçoit la
même chose.

- **Obligatoire, automatique et silencieux.** Aucune annonce, aucune notification, aucune commande
  pour s'y soustraire. Les soldes évoluent, c'est tout. Seuls les administrateurs en voient le
  détail, en éphémère.
- **La masse monétaire est conservée au point près.** Chaque membre reçoit un unique mouvement net
  (part reçue moins cotisation) : aucun solde ne plonge le temps du calcul, et le reste de la
  division entière est distribué au hasard plutôt que brûlé.
- **Les soldes négatifs ou nuls ne cotisent pas** mais touchent leur part : le pot est aussi une
  bouée.
- **L'échéance vit en base**, pas dans un cron. Le tick horaire ne fait rien tant qu'elle n'est pas
  atteinte, la revendique par un `UPDATE` gardé (deux ticks simultanés ne peuvent pas déclencher
  deux pots), et calcule la suivante **à partir de l'ancienne** : aucune dérive, et une panne de
  trois semaines donne un seul pot de rattrapage, pas trois.
- **Réglages** (modifiables à chaud via `/admin config`) : `redistribution.enabled`,
  `redistribution.intervalHours` (168 par défaut), `redistribution.contributionPercent` (5, borné
  entre 0 et 100 — une faute de frappe y serait irréversible).

### 🛠️ Utilitaires & Communauté

- **Rappels** :
  - `/rappel` : Créer un rappel personnel.
  - `/mes-rappels` : Gérer ses rappels existants.
- **Safe Place** : `/safe-place` - Espace d'expression anonyme.
- **Personnalisation** : `/color` - Changement de la couleur du pseudo.
- **Threads** : `/join` - Rejoindre rapidement un fil de discussion.
- **Aide** : `/help` - Liste des commandes disponibles.

### ⚙️ Configuration en trois couches

Les réglages se lisent en empilant trois sources, chacune écrasant la précédente :

1. **`DEFAULTS`** (`modules/config.js`) — le schéma. Une clé qui n'y figure pas n'existe pas, et le
   type de sa valeur par défaut impose celui qu'on peut écrire. Il sert aussi de repli : un fichier
   illisible ne fait jamais tomber le bot.
2. **`config.json`** — le réglage versionné, celui qu'on décide en revue de code.
3. **`config.local.json`** — ce qu'écrit `/admin config` depuis Discord, **ignoré par git**.

La troisième couche n'est pas un détail d'implémentation. `config.json` est suivi par git, et le
déploiement enchaîne `git checkout main && git pull` sous `set -e` : une commande qui écrirait
dedans laisserait le serveur avec un fichier suivi modifié, ferait échouer le déploiement suivant et
bloquerait `pcr release`, qui refuse de partir d'un arbre sale. La surcharge locale règle le
problème sans rien perdre : la propriété « clé absente = valeur de la couche du dessous » tient à
chaque étage, donc supprimer `config.local.json` revient exactement à revenir au réglage versionné.

Tout est relu à chaque accès : une modification prend effet immédiatement, sans redémarrage.

### 🛡️ Modération & Administration

- `/autodel` : configuration de la suppression automatique des messages dans un salon.
- `/edit` : permet au bot d'éditer un de ses propres messages. Ouverte à l'auteur du sondage comme
  aux administrateurs, elle reste donc hors de `/admin`.
- **`/admin`** : toutes les commandes d'administration sont regroupées sous une commande unique, que
  Discord masque aux non-administrateurs (`setDefaultMemberPermissions`). Le masquage n'est que du
  confort — un serveur peut rouvrir la permission — et la vérification faite à l'exécution, écrite
  une seule fois dans le routeur, fait foi. Toutes les réponses sont privées.
  - `/admin points <membre> <montant>` : crédite un dresseur, ou le débite avec un montant négatif.
    La réponse rappelle l'ancien et le nouveau solde. Un solde négatif est autorisé — il bloque les
    achats jusqu'à ce qu'il remonte — et signalé comme tel.
  - `/admin points-tous <montant>` : la même chose pour tous les porteurs de `DEFAULT_ROLE_ID`, avec
    le nombre de bénéficiaires et le total distribué.
  - `/admin item <membre> <objet> [quantite]` : donne un objet à un dresseur, ou le lui retire avec
    une quantité négative. Contrairement aux points, le retrait a un plancher : un sac ne descend
    pas sous zéro, la commande refuse plutôt que de creuser.
  - `/admin config <cle> <valeur>` : modifie un réglage **à chaud**, sans redémarrage (voir
    *Configuration en trois couches* ci-dessus). L'autocomplétion propose les chemins avec leur
    valeur courante et leur type ; le type attendu vient de la valeur par défaut, une clé hors
    schéma est refusée, les réglages dangereux sont bornés, et l'écriture est atomique (fichier
    temporaire relu puis renommé) pour que le bot n'en voie jamais une version tronquée.
  - `/admin config-voir [cle]` : valeur courante face à la valeur par défaut. Sans clé, le fichier
    entier.
  - `/admin potcommun [simulation]` : déclenche un pot commun hors calendrier, ou simule le
    prochain sans toucher aux soldes. L'échéance hebdomadaire n'en est pas décalée.
  - `/admin purge [lien] [nombre]` : suppression de messages en masse.
  - `/admin pokespawn [espece] [shiny] [annonce] [ping]` : déclenche une apparition (voir plus haut).
  - `/admin safarispawn [joueur] [pause]` : ouvre un parc safari (voir plus haut).
  - `/admin restart` : redémarre le bot.

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
