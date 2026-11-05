[← README](../../README.md)

# v2.0.0 — Cadrage

Document de travail de la refonte, à jour au 05/11/2026. Il sert de référence d'une session à
l'autre jusqu'à la release, puis part en archive (ou disparaît).

## Décisions prises

| Sujet           | Décision                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------- |
| Génération 3    | ouverte le **01/01/2027 à 00:00, heure de Paris** (`2027-01-01T00:00:00+01:00`)           |
| Données joueurs | **conservées** : `points.db` est migrée, rien n'est remis à zéro                          |
| Driver SQLite   | **`node:sqlite`** (prod en Node 24.21.0, statut « release candidate » depuis 24.15.0) ; `sqlite3` est retiré |
| Discord         | **panneau en composants** (option A) ; les commandes restent, regroupées                  |
| Site            | refondu aussi, d'abord pour le téléphone                                                  |
| Loterie         | 100 % de lots : **voulu**                                                                 |
| Textes          | libellés, descriptions, emoji et sprites **sortent de la config** : plus modifiables à chaud |
| Release         | le **31/12 après-midi**, pour que tout soit en place avant minuit                         |
| Panneau Discord | une commande à part, **`/pokemon`** ; `/pk` garde les commandes                           |
| Branche         | `dev/jolly-archimedes-to3uu1` porte toute la v2 ; `main` y est repris chaque semaine       |
| Apparitions     | chaque génération pèse **deux fois la précédente** (×1, ×2, ×4) : `generationBoost: 2` reste |
| Boutique (3G)   | **Filet Ball, Bis Ball, Chrono Ball** ; pas de Faiblo Ball                                |
| Clés d'objets   | restent **en français** (`super_bonbon`, `pierre_soleil`…)                                |
| Bouton « Mon jeu » | **non** : `/pokemon` suffit                                                            |

## Calendrier

La génération 3 s'ouvre à minuit : le code et ses données doivent être en place **avant**. La
release part donc le **31/12 après-midi**. La v2 tourne quelques heures en
génération 2, ce qui sert de rodage, puis trois choses arrivent seules à 00:00 :

1. l'ouverture de la génération 3 (une date relue à chaque usage, sans minuteur) ;
2. le bilan de la saison 2, publié à l'ouverture de la suivante ;
3. le passage à `botdata-2027.db` — qui, aujourd'hui, ne se fait qu'au redémarrage (l'année est
   lue au chargement, `modules/db.js:11`) : à corriger dans le lot 1.

Les trois se testent ensemble, horloge figée sur le 31/12 à 23:59.

| Lot | Contenu                                                                  | Période        |
| --- | ------------------------------------------------------------------------ | -------------- |
| 0   | cadrage validé                                                           | → 08/11        |
| 1   | base : `node:sqlite`, module unique d'accès, schéma v2, script de migration et répétition sur le serveur | 09/11 → 22/11 |
| 2   | config v2 et catalogue des textes                                        | 16/11 → 22/11  |
| 3   | refonte du jeu par fonctionnalité, tests réécrits au fur et à mesure     | 23/11 → 06/12  |
| 4   | Discord : panneau, commandes regroupées, messages publics en composants  | 07/12 → 13/12  |
| 5   | site, d'abord pour le téléphone                                          | 07/12 → 20/12  |
| 6   | génération 3 : données, nouvelles règles, balls, objets                  | 14/12 → 20/12  |
| 7   | gel le 21/12 ; répétition générale de la migration, docs, changelog      | 21/12 → 31/12  |

Décembre : le calendrier de l'Avent tourne, et `main` continue de recevoir les 1.21.x. Toucher aux
minuteurs avec prudence, et reprendre `main` dans la branche de la v2 chaque semaine.

## 1. Base de données

### Driver

- `node:sqlite`, synchrone : une transaction est un bloc de code que rien n'interrompt. La règle
  « retirer avant de créditer, compenser en cascade » devient **« une opération = une
  transaction »**. Le travail détaché vers Discord (réécrire un message public) part après le
  `COMMIT`.
- Un seul module l'importe (`modules/store.js`) : `get`, `all`, `run`, et `tx(fn)` —
  `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`, `SAVEPOINT` pour l'imbrication (le module n'en
  fournit pas). Passer un jour à `better-sqlite3` ne toucherait que ce fichier.
- `.nvmrc` et `engines.node` passent à `>=24.15`.
- À vérifier sur le serveur : un `ExperimentalWarning` au chargement en 24.21.
- Une requête bloque le bot pendant qu'elle tourne : mesurer les plus lourdes (bilan de saison,
  classements) sur une copie de la base.
- Le format des fichiers ne change pas : changer de driver ne touche pas aux données.

### Schéma v2

- Écrit d'un bloc, versionné par `PRAGMA user_version` ; les évolutions suivantes deviennent des
  migrations numérotées.
- Disparaissent : la trentaine d'`addColumn`, `addMessageClosedAt`, `LEGACY_TABLES`, la reprise de
  `config.local.json`, et les tests de migration qui vont avec.
- `pokemon_trades` (28 colonnes `offer_*` / `request_*`) devient `trades` + `trade_lines`
  (`trade_id`, `side`, `kind`, `pokemon_id`, `item_key`, `points`, `qty`) ; le brouillon suit.
- Chaque table repasse en revue : colonnes mortes, index utiles, contraintes `CHECK` / `NOT NULL`.
- Les clés d'objets (`super_bonbon`, `pierre_soleil`…) restent telles quelles, en français.

### Migration

- `scripts/migrate-v2.js`, lancé au déploiement :
  1. copie `points.db` en `points.v1.db` ;
  2. construit la base v2 ;
  3. compare avant et après : nombre de dresseurs, d'individus par dresseur, somme des points,
     des objets, échanges et œufs en cours. Un écart, et le bot ne démarre pas.
- Un mode `--dry-run` que le mainteneur lance sur le serveur dès le lot 1, puis la veille : il
  rend un rapport (comptes, anomalies) sans que les données quittent le serveur.
- Retour arrière : la v1 ne lit pas le schéma v2. On restaure `points.v1.db` et on redéploie le
  tag v1.21.x. À répéter une fois avant le 31/12.

### Statistiques annuelles

`botdata-<année>.db` se choisit à la date de l'écriture, plus au chargement. Les tables de
statistiques Pokémon y restent.

## 2. Config v2

### Principes

- **Des nombres et des interrupteurs, rien d'autre** : les textes partent au catalogue (§ 3).
- **Durées** : une seule forme, du texte lu par une seule fonction — `"90s"`, `"45m"`, `"24h"`,
  `"7d"` (type `duration` dans le schéma).
- **Probabilités et parts** : entre 0 et 1 (`…Chance`, `…Share`), ou `…OneIn` (1 sur N). Plus de
  pourcentage.
- **Ce qui dépend d'une génération** vit dans `generations` : ouvrir la suivante, c'est remplir
  un bloc.
- **Équilibrage et technique séparés** : l'un se règle depuis `/admin`, l'autre (réessais,
  cadences d'édition) n'a rien à y faire.
- **Un seul schéma** : chaque réglage déclare sa valeur, son type et ses bornes. `BOUNDS` et les
  getters qui revalident chacun de leur côté (`getSeasonRecapConfig`, `getUnownTextConfig`)
  disparaissent.
- **Les repères se calculent** (gain moyen par jour, une Master Ball tous les N jours) et
  s'affichent dans `/admin poids` ou la page Infos. Plus jamais en commentaire : ceux de la v1 sont
  calculés sur les valeurs du code, pas sur celles de prod.

### Arbre (brouillon)

```js
{
  economy: {
    messagePoints: { byRank: { 1: 750, 2: 600, 3: 500, 4: 400, 5: 350, 6: 300 }, default: 300 },
    redistribution: { enabled: true, interval: "7d", contributionShare: 0.07 },
  },
  pokemon: {
    enabled: true,
    generations: {
      2: { opensAt: "2026-10-26T00:00:00+00:00", starters: [152, 155, 158] },
      3: { opensAt: "2027-01-01T00:00:00+01:00", starters: [252, 255, 258] },
    },
    spawn: {
      messagesPerSpawn: 20, minDelay: "1m", minDelayAfterEnd: "0m", generationBoost: 2,
      fleeAfter: { min: "45m", max: "90m" }, legendaryFleeMultiplier: 2,
      shinyOneIn: 500, heldItemChance: 0.2, itemDropChance: 0.2,
      weights: { stage: { 1: 70, 2: 60, 3: 25 }, veryRare: 18, legendary: 8, species: { 201: 2 } },
    },
    capture: { globalMultiplier: 1, minCatchRate: 10, throwCooldown: "3s",
               balls: { poke: { price: 100, multiplier: 1 }, /* … */ master: { price: 10000, priceGrowth: 1.2 } } },
    shop: { maxHeld: 10, dailyLimit: 10, balls: { appat: { price: 230, /* … */ }, catalyseur: { price: 250 } } },
    fishing: { flee: "120s", wildRarityFactor: 0.7, rods: { old: { castPrice: 100 }, good: { castPrice: 100 }, super: { castPrice: 100 } } },
    lottery: { enabled: true, nothingWeight: 0, lotDecay: 0.5 },
    items: { evolyte: { dropWeight: 30, sellValue: 1000 }, /* … nombres seulement */ },
    safari: { /* … */ weights: { stage: { 1: 70, 2: 90, 3: 60 }, veryRare: 30, legendary: 24, species: { 201: 2 } } },
    // evolution, trade, eggs, sell, starters.rewards, shinyCharm, lockByDefault, seasonRecap…
  },
  display: { pokedexPageSize: 30, boxPageSize: 15, pc: { /* … */ }, showcase: { /* … */ }, unownText: { /* … */ } },
  system: { web: { /* … */ }, publicMessages: { /* … */ }, links: { /* … */ }, refresh: { spawnMessage: "2s", safariLive: "1s", safariSettle: "3s" } },
}
```

### Les réglages de prod deviennent les valeurs du code

Le `config.json` de prod (relevé le 05/11) porte 29 réglages : 7 identiques au code, 1 périmé
(`generationOpenings.2`, passé — sa vraie valeur reste la date d'ouverture de la saison 2), et 21
vrais changements, repris tels quels :

| Réglage                                    | Code v1         | Prod → v2       |
| ------------------------------------------ | --------------- | --------------- |
| `items.evolyte.dropWeight` / `sellValue`   | 20 / 500        | 30 / 1 000      |
| `items.ball_hyper.dropWeight`              | 80              | 100             |
| `items.pierre_soleil.dropWeight` / `sellValue` | 20 / 500    | 40 / 700        |
| `items.roche_royale.dropWeight` / `sellValue`  | 20 / 500    | 50 / 600        |
| `items.catalyseur.dropWeight`              | 20              | 70              |
| descriptions de la Pierre Soleil, de la Roche Royale et du Catalyseur | « … Elle tient lieu d'un sacrifice. » | sans cette phrase (au catalogue) |
| `lottery.winChance`                        | 0,75            | 0,99 → `nothingWeight: 0` |
| `spawn.heldItemChance`                     | 0,15            | 0,2             |
| `safari.weightsByStage`                    | 50 / 60 / 40    | 70 / 90 / 60    |
| `safari.spawnPauseHours`                   | 4               | 3               |
| `safari.minHoursBetweenParks`              | 24              | 48              |
| `safari.entryCooldownHours`                | 12              | 6               |
| `capture.specialBalls.catalyseur.price`    | 300             | 250             |
| `redistribution.contributionPercent`       | 5               | 7               |

La v2 démarre avec un `config.json` vide (l'ancien gardé en `config.v1.json`). Une clé inconnue
au démarrage est signalée dans le journal et dans `/admin config-voir`. La veille de la release,
le mainteneur renvoie le fichier pour rattraper ce qui aura changé d'ici là.

### Loterie

Aujourd'hui, avec `winChance: 0.99` et les objets de la génération 2, `openedChance` dépasse 1 et
se plafonne (`modules/pokemon/items.js:260`) : chaque tirage gagne — c'est voulu — et chaque lot
vaut son poids sur le total. La v2 l'écrit tel quel : une table de tirage où « Rien » a son poids
(`nothingWeight`, 0 en prod). Ce qu'on règle est ce qui se tire, sans formule cachée. Ouvrir la
génération 3 ajoute des lots : ceux d'avant deviennent un peu plus rares, et c'est affiché.

## 3. Catalogue

Les libellés, emoji, sprites et descriptions des balls, balls spéciales, objets et de la Safari
Ball quittent la config pour un catalogue dans le code (`modules/pokemon/catalog.js`). Les
descriptions retouchées en prod y passent.

Conséquence : un emoji de ball supprimé du serveur se répare par une release, plus depuis
`/admin config`.

## 4. Code

- **Un dossier par fonctionnalité** (capture, collection, échange, œufs, safari, pêche, loterie,
  boutique, saison) :
  - un service — les règles et les transactions, seul chemin d'écriture ;
  - un adaptateur Discord — commande, boutons, onglet du panneau ;
  - un adaptateur site — routes ;
  - un rendu.

  Commandes, panneau et site appellent le même service.
- **Un registre des interactions** : chaque fonctionnalité déclare ses préfixes (`poke_trade_*`…)
  et ses handlers. `interactionCreate.js` (1 007 lignes) n'est plus qu'un aiguillage ; les paris
  partent dans leur module.
- **Chemins uniques** : la liste de `CLAUDE.md` est reprise service par service, et remise à jour.
- **Commentaires** : on garde les « pourquoi », on retire l'historique (« Avant, … »).

## 5. Discord

### Entrées dans le panneau

- **`/pokemon [onglet]`**, une commande à part : Discord n'accepte pas `/pk` seul tant que la
  commande a des sous-commandes.

### Le panneau

Un message éphémère en composants (Components V2), qui se réécrit à chaque clic :

```
┌───────────────────────────────────────────────┐
│ ## 🎮 Sydnec — 12 430 points                   │
│ 🔴 ×12  🔵 ×4  🟡 ×1   ·   🥚 éclot dans 31 h   │
├───────────────────────────────────────────────┤
│ [Accueil] [Pokédex] [Boîte] [Sac] [Œuf] [Échanges] │
├───────────────────────────────────────────────┤
│ (contenu de l'onglet : liste, fiche, menus)     │
│ [ Choisir un Pokémon ▾ ]                        │
│ [Évoluer] [Revendre] [Verrouiller] [Renommer]   │
├───────────────────────────────────────────────┤
│ [🎣 Pêcher] [🌿 Parc safari] [🎟️ Loterie] [🌐 Site] │
└───────────────────────────────────────────────┘
```

- L'accueil résume ce qui attend une action : apparition en cours, œuf, loterie du jour, starter
  à choisir, offres d'échange reçues.
- Un échange commence par un menu de membres.
- Renommer, une quantité ou un montant passent par une modale.
- Limites de Discord : 40 composants et 4 000 caractères par message, 25 choix par menu, 5
  boutons par rangée. Une boîte de 300 Pokémon se parcourt par espèce, puis par individu.
- Le rangement du PC reste sur le site (la règle actuelle le permet déjà).

### Commandes regroupées (brouillon)

Les commandes restent, pour qui préfère taper : chacune appelle le même service que l'onglet
correspondant.

| v1                                                                  | v2                                                         |
| ------------------------------------------------------------------- | ---------------------------------------------------------- |
| —                                                                   | `/pokemon [onglet]` (le panneau)                           |
| `pokedex`, `info`, `zarbis`, `comparer`, `classement`               | `/pk pokedex voir · espece · zarbi · comparer · classement` |
| `boite`, `doublons`, `verrou`, `renommer`, `revendre pokemon`, `evolution` | `/pk boite voir · doublons · verrou · renommer · revendre · evoluer` |
| `inventaire`, `loterie`, `boutique`, `revendre objet`               | `/pk sac voir · loterie · boutique · revendre`             |
| `vitrine …`, `oeuf …`                                               | inchangés                                                  |
| `echange`, `pecher`, `safari`, `starter`                            | inchangés                                                  |
| `web`                                                               | `/pk site`                                                 |

`/pk` passe de 21 entrées à 10, sous la limite de 25 de Discord, avec de la marge. `/zarbi` et
`/admin` ne bougent pas.

### Messages publics

Apparitions, offres d'échange, parc en direct, objets au sol, annonce de génération et bilan de
saison passent en composants. Un titre y rend le Markdown et les emoji du serveur : la règle
« jamais d'emoji dans un titre » de `CLAUDE.md` ne vaut plus que pour un embed restant.

À vérifier : un message publié en embed par la v1 (une apparition en cours au déploiement) peut-il
être réécrit en composants ? Sinon, la v2 sait encore fermer un message v1.

## 6. Site

- Refondu d'abord pour le téléphone : mêmes onglets et même vocabulaire que le panneau.
- Toujours sans compilation (la convention actuelle).
- Rien qui empêche de le lancer plus tard comme Activity Discord : une session qui accepte un jeton
  en en-tête (aujourd'hui, seulement un cookie `SameSite=Lax`), des sprites servis par nos routes
  plutôt que par des adresses externes, des URL relatives.

## 7. Génération 3

- **Données** : `pokemon-data.json` et `pokemon-fishing.json` régénérés jusqu'au n° 386, soit 135
  nouvelles espèces.
- **Piège du stade** : le stade est figé dans le JSON (`rarityOf` lit `species.stage`). Avec les
  bébés de la génération 3, Marill passe au stade 2, Azumarill au stade 3 et Qulbutoké au stade 2 :
  leur rareté, leur poids, leur prix de revente et le coût de leurs évolutions changent. C'est ce
  qui est arrivé à Pikachu avec Pichu. Proposition : calculer le stade selon la génération
  ouverte, pour que ce changement tombe à 00:00 et pas au déploiement.
- **Bébés** : Azurill (Marill) et Okéoké (Qulbutoké), seulement par œuf, comme Pichu.
- **Starters** : Arcko, Poussifeu, Gobou (252, 255, 258), avec les mêmes récompenses par paliers du
  Pokédex.
- **Légendaires** : Regirock, Regice, Registeel, Latias, Latios, Kyogre, Groudon, Rayquaza.
  **Fabuleux** : Jirachi, Deoxys.
- **Charme Chroma** de la génération 3.
- **Balls de boutique** :

  | Ball         | Bonus                                        |
  | ------------ | -------------------------------------------- |
  | Filet Ball   | types Eau ou Insecte                         |
  | Bis Ball     | espèce déjà au Pokédex                       |
  | Chrono Ball  | grandit avec le nombre de lancers sur l'apparition |

  Écartées : la Faiblo Ball, sans intérêt ici ; la Scuba Ball, qui double l'Appât Ball ; la Luxe
  Ball et l'Honor Ball, sans effet. Le bonus apprend trois conditions de plus (`types`, `owned`,
  `throws`), en plus de `fished` et `item`.
- **Objets** : Dent Océan (Coquiperl → Serpang) et Écaille Océan (Coquiperl → Rosabyss), par le
  mécanisme `targets`.
- **Cas particuliers** (évolutions, bébés, légendaires, obtentions) : en discussion, la liste
  complète est passée en revue cas par cas ; les choix seront reportés ici.
- **Zarbi** gagne `!` et `?` (28 formes), et `/zarbi` les écrit.
- **Pas en v2.0** : formes de Morphéo, de Deoxys et de Spinda ; natures et talents. Beaucoup de
  travail, aucun effet en jeu.
- **Équilibrage** : `generationBoost: 2` reste, soit ×4 par espèce de la génération 3. Elle fera
  environ 60 % des apparitions (estimation grossière, hors poids de stade).

## 8. Tests

Aujourd'hui : 52 fichiers, environ 1 670 cas, 21 940 lignes, environ 45 à 50 s.

- **Une règle, un test**, dans le service.
- **Adaptateurs** : un tableau par commande et par route, pour le branchement, la validation (400),
  les droits (401/403/404) et le refus du jeu (409).
- **Rendu** : seulement les limites de Discord (longueurs, nombre de composants), pas le texte.
- **Générations** : des invariants vérifiés sur toutes les générations (chaque évolution mène à une
  espèce existante, starters, charmes, tables de pêche), à la place d'un fichier par génération.
- **Transactions** : un test par opération qui prouve qu'une étape en panne annule tout, à la place
  des compensations en cascade.
- **Concurrence** : un test par ressource disputée (revendication d'une apparition, acceptation
  d'un échange).
- **Migration** : un test, d'une base v1 de référence vers la v2, comptes conservés.
- **Cible** : 500 à 700 cas, moins de 20 s. On réécrit les tests d'un module en même temps que le
  module ; les anciens partent quand les nouveaux existent.
- `CLAUDE.md` et `docs/tests.md` se mettent à jour avec ces règles.

## 9. Docs et changelog

- Une entrée `pending` par changement visible : panneau, commandes regroupées, génération 3,
  nouvelles balls… `announce: true` pour le jeu, `false` pour ce qui ne touche que le site.
- Pages de `docs/` réécrites pour les nouvelles commandes, sommaire du README mis à jour.
- `CLAUDE.md` : transactions, composants, chemins uniques, règles de test.

## 10. Risques

| Risque                                           | Parade                                                     |
| ------------------------------------------------ | ---------------------------------------------------------- |
| La migration échoue ou perd des données          | comptes avant/après bloquants, `--dry-run` sur le serveur, sauvegarde, retour arrière répété |
| Trois événements à minuit                        | testés ensemble, horloge figée                             |
| Rafale de messages à minuit (annonce, bilan, apparition) | réécritures déjà espacées et réessayées par `message-sync` |
| Branche longue face aux 1.21.x de `main`         | `main` repris chaque semaine dans la branche de la v2      |
| Gel trop tard, fêtes de fin d'année              | gel le 21/12                                               |
| Un réglage de prod modifié d'ici là              | `config.json` renvoyé la veille                            |

## À trancher

1. Conventions de config : durées en texte (`"45m"`), `…Chance` / `…Share` / `…OneIn` ?
2. Génération 3 : chaque cas particulier (évolutions, bébés, légendaires, obtentions, formes,
   pêche).
