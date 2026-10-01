[← README](../README.md)

# 🧪 Tests automatiques

Une suite de **plus de 1 050 tests** couvre le jeu Pokémon, l'économie, le site (API et serveur HTTP), les
commandes `/pk` et `/admin`, les boutons Discord du jeu et les minuteurs. Elle utilise le lanceur
natif de Node (`node:test`) : aucune dépendance de plus, et la CI la lance à chaque pull request.

```bash
npm test                                   # toute la suite (≈ 45 s)
node --test test/capture.test.js           # un seul fichier
node --test --experimental-test-coverage "test/**/*.test.js"   # avec la couverture
PCR_TEST_LOGS=1 npm test                   # rétablit le journal du bot, pour comprendre un échec
```

## Rien ne touche aux vraies données

`PCR_DATA_DIR` déplace `points.db`, `botdata-<année>.db` et `config.json` dans un dossier. Chaque
fichier de test en crée un jetable (`createSandbox`) **avant** d'importer le moindre module du bot,
qui lit ce chemin à son chargement — d'où les `await import(...)` en tête de chaque fichier. Un
processus par fichier : aucun état ne passe d'un fichier à l'autre, et la CI n'a rien à nettoyer.
En production, la variable n'existe pas et les chemins sont ceux d'avant.

Les réglages à chaud s'écrivent dans le `config.json` du bac à sable (`sandbox.writeConfig`) et se
relisent à chaque usage, comme en vrai : un test peut donc changer un prix, une chance ou la
génération ouverte en cours de route.

## Les outils

- `test/helpers.js` — `createSandbox`, `openDatabases` (attend la fin de la création des tables, lue
  dans le code qui les crée, et ferme les bases à la fin), `withRandom` (fige `Math.random`, une
  valeur ou une suite, y compris pendant une opération asynchrone), `dbRun` / `dbGet` / `dbAll`,
  `speciesByName`, et `eventually` / `eventuallyStable` pour attendre un travail détaché (voir plus bas).
- `test/fake-discord.js` — de fausses interactions « slash » (options, sous-commande, membre,
  salon), un faux serveur et un faux salon, qui notent ce qu'on leur répond.
- Génération : un test qui n'a pas besoin de la 2ᵉ génération la **ferme** (`generationOpenings` à
  une date lointaine), et `generation2.test.js` la rouvre (`pokemon.generation: 2`) : les nombres
  attendus ne changent donc pas le jour où elle s'ouvre pour de bon.

## Ce que couvrent les fichiers

| Fichier                           | Ce qu'il vérifie                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `config`, `config-migration`      | valeurs de base, ajustements à chaud, bornes, `config.local.json` repris en `config.json`                          |
| `capture`                         | formule de capture, plancher des légendaires, balls, apparitions pondérées, difficulté, prix de la Master Ball      |
| `spawn`, `spawn-lifecycle`        | revendication gardée d'une apparition, durée de vie, fuite, remplacement, objets au sol, réparation au démarrage   |
| `throws`                          | lancers : paiement, remboursement, courses entre dresseurs, ball offerte, shiny du Charme                          |
| `safari`, `safari-entry`          | tirage des rencontres, appâts et fuite, actions, entrée payante ou offerte, reprise d'une visite                   |
| `economy`, `redistribution`       | points, objets, revente, compensation en cascade, pot commun (plan, bail, rattrapage, simultanéité)                |
| `evolution`, `collection`         | coût d'une évolution, sacrifices, objets, Métamorph, compensation ; individus, verrous, doublons, échanges         |
| `eggs`, `lottery-charms`          | ponte, éclosion, compteur de messages ; loterie quotidienne, Charme Chroma et ses rôles                            |
| `pc-showcase`                     | boîtes PC, surnoms, vitrine, envoi de la vitrine                                                                   |
| `embeds`                          | embeds Discord, lignée, formats                                                                                    |
| `web-api`, `web-routes`           | toutes les routes de l'API du site : validation (400), droits (401/403/404), refus du jeu (409)                    |
| `web-server`, `web-session`       | serveur HTTP réel : session, appartenance au serveur, administrateur, origine, taille, cadence, OAuth, fichiers    |
| `interactions`                    | boutons et menus du jeu sur Discord : lancer, Master Ball, évolution, échange, parc safari, partages               |
| `commands-pk`, `commands-admin`   | déclaration de toutes les commandes (limites de Discord), sous-commandes `/pk` et `/admin`                         |
| `messages`                        | points gagnés par message, statistiques, compteur du jeu, réécriture des liens X/Instagram et traduction           |
| `timers`                          | chaque minuteur est planifié dans `index.js`, et fait son travail (ouverture de génération, éclosion, parc)        |
| `generation2`                     | les 251 espèces, bébés, évolutions à objet, légendaires, charme, œufs, parc, annonce unique à l'ouverture          |
| `utils`, `points-history`, `pseudo` | garde d'administration, rôles en libre-service, journal sur une ligne, courbe des soldes, pseudos                 |

## Ce que les tests n'essaient pas de couvrir

- Les commandes et minuteurs d'avant le jeu — paris (`/bet`), sondages, rappels, `/ecaflip`, `/color`,
  calendrier de l'avent, saints du jour, message des rôles — et les événements Discord autres que
  `messageCreate` et le routage `poke_*` d'`interactionCreate`.
- `version-manager.js` et `changelog-notifier.js` (outillage de livraison).
- Le JavaScript du navigateur (`web/`) : les routes qu'il appelle sont testées, pas son rendu.
- Le vrai Discord : tout passe par de faux objets. Ce qu'ils ne disent pas (une limite de débit, un
  champ trop long côté serveur) ne se voit qu'en production.

## Écrire un test

1. **Un test par règle**, nommé comme la règle : « le dernier de l'espèce ne part pas », pas
   « test de reserveDuplicates ».
2. **Le refus ET l'état** : un refus se vérifie par son message (avec ses chiffres) *et* par ce qui
   n'a pas bougé en base.
3. **Le hasard est figé** avec `withRandom`, jamais « répété jusqu'à ce que ça passe ».
4. **La compensation se teste par une panne provoquée** : un déclencheur SQLite
   `BEFORE INSERT … RAISE(ABORT, 'panne')` fait échouer une étape, et le test regarde que tout ce
   qui précédait est revenu à l'identique.
5. **La concurrence se teste** : `Promise.all` de dix appels, un seul doit gagner.
6. **Vérifier qu'un test voit bien une régression** : casser volontairement la garde qu'il protège
   (retirer un `WHERE`, une vérification) doit le faire échouer. Un test qui passe quand on casse le
   code ne protège rien.
7. Une règle de jeu nouvelle, un nouveau chemin d'écriture ou un bug corrigé arrivent avec leur
   test — le test du bug est celui qui l'aurait vu.
8. **Jamais d'attente fixe avant une assertion positive.** Le bot lance beaucoup de travail détaché
   (récompense d'un message, objet lâché, fuite d'une apparition) dont la fin dépend de SQLite : un
   `sleep(100)` passe sur un poste rapide et échoue sur le lanceur de la CI, plus lent. On
   attend l'effet avec `eventually(() => assert…)` (il réessaie jusqu'à 10 s), et `eventuallyStable`
   quand le compte exact compte (« un seul gagne » : l'effet, puis 100 ms pour voir qu'il ne
   se répète pas). Seule une assertion **négative** (« rien ne s'est passé ») garde une attente fixe,
   assez longue pour que l'effet fautif aurait eu le temps d'arriver.
