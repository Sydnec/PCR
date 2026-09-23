# PCR — consignes pour Claude

## Réponses

Toujours en français, et concises : juste de quoi comprendre ce qui a été fait.

## Livraison d'une feature ou d'un correctif

Le mainteneur ne fait que `git pull && pcr release <fix|minor|major>` sur `main`. Une livraison
n'est donc terminée que lorsqu'elle est **mergée dans `main`** :

1. Développer sur la branche de travail, commits en français au format conventionnel
   (`feat(pokemon): …`, `fix(pokemon): …`), avec un corps qui explique le pourquoi.
2. Ajouter l'entrée du changement dans `changelog.json` → `pending` (c'est ce que `pcr finish`
   faisait, et `pcr release` la reprend telle quelle) :
   `type` (`feature` / `fix` / `enhancement` / `chore`), `name`, `description` (texte destiné aux
   joueurs), `announce` (annoncé sur Discord ou non), `author: "Sydnec"`, `commit: "pending"`,
   `timestamp`, `branch`. `name` et `description` restent **concis** : une ou deux phrases qui
   disent ce qui change pour les joueurs, sans justification ni détail technique.
3. Mettre à jour la doc si le comportement visible change : la page concernée dans `docs/`, et le
   résumé du `README.md` s'il ne dit plus vrai. Le README reste un sommaire : le détail va dans
   `docs/`.
4. Ouvrir la PR vers `main`, attendre la CI verte, puis la merger (merge commit).

Ne jamais toucher à la version (`package.json`, `changelog.json` → `version` / `releases`) : c'est
le rôle de `pcr release`.

## Standards de qualité

Chaque livraison respecte les standards déjà appliqués dans le code. Lire le code voisin avant
d'écrire et en reprendre le style : en cas de doute, c'est le code existant qui fait foi.

### Code

- **Commentaires en français qui disent pourquoi** : la décision, le piège évité, la règle de jeu.
  Jamais une paraphrase du code, et la même densité que le code autour.
- **Réutiliser les chemins uniques** au lieu de les recopier — une règle écrite deux fois finit par
  diverger : `creditSpecies` (nouvel individu), `reserveDuplicates` / `restoreDuplicates` (retrait
  d'individus d'un groupe, et remise à l'identique), `getIndividuals` / `groupIndividuals`
  (lecture), `grantItem` / `consumeItem` (inventaire), `spendPoints` / `addPoints` (points),
  `displayName`, `encodeEntry` / `decodeEntry`, `buildBalanceEmbed`, `startThrow` / `resolveThrow` /
  `throwMessage` (un lancer de ball, depuis Discord comme depuis le site).
- **Pas d'état de jeu en mémoire** : tout vit en base, pour que les boutons répondent encore après
  un redémarrage.
- **Jamais « lire puis écrire »** : un retrait, un débit ou une revendication est un `UPDATE` /
  `INSERT` gardé dans son `WHERE`, et `this.changes` tranche. Deux clics simultanés, un seul gagnant.
- **Opérations en plusieurs étapes** : retirer avant de créditer, et compenser en cascade si une
  étape échoue. Rien ne doit se perdre, rien ne doit se créer.
- **Invariants du jeu** : un Pokémon est un individu de `pokemon_owned` (sexe — NULL pour une
  espèce asexuée —, ball, fertilité, date d'arrivée), désigné par son identifiant (`#123`). Il
  reste toujours au moins un individu de chaque entrée du Pokédex (un shiny compte à part), mais
  aucun n'est réservé : n'importe lequel peut partir s'il n'est pas le dernier. Quand on cède par
  groupe, les stériles partent d'abord, puis les plus récents. Côté objets, une ligne tombée à zéro
  reste en base, donc toute lecture filtre `count > 0`.
- **Commandes** : celles du jeu Pokémon vivent sous `/pk` (un fichier par sous-commande dans
  `commands/pk/`), celles d'administration sous `/admin`.
- **API web** (`modules/web/`) : aucune règle de jeu, seulement des appels aux mêmes fonctions que
  les commandes. Tout ce qui se fait sur le site doit rester faisable depuis Discord.
- **Site** (`web/`) : fichiers statiques sans compilation ni dépendance, servis par le bot. Il
  affiche ce que renvoie l'API et lui confie chaque action, sans recalculer de règle. Le DOM se
  construit avec `h()` (`web/lib.js`), jamais avec `innerHTML`. Rien en ligne : la politique de
  sécurité refuse scripts et attributs `style` en ligne (passer par `element.style`). Tester dans
  Chromium sur une copie du dépôt, avec un faux Discord, en clair et en sombre, et à 390 px de large.
- **Aucun nombre en dur** : prix, poids, taux et durées vivent dans `modules/config.js`
  (`DEFAULTS`) et `config.json`, relus à l'exécution. Ce qui s'affiche se calcule avec les mêmes
  fonctions que ce qui se tire, jamais recopié.

### Discord

- Refus et réponses personnelles en **éphémère**. Un refus donne les chiffres (« tu en as 1, il
  en faut 2 »), en français et au tutoiement.
- Une valeur d'autocomplétion se **revalide dans `execute()`** : elle peut être tapée à la main
  ou périmée. Une liste vide s'explique par une proposition inerte, jamais par du vide.
- Emoji du serveur et mentions dans la description ou les champs, **jamais dans un titre** :
  Discord ne les y rend pas.
- Nombres formatés avec `toLocaleString("fr-FR")`.
- Sur une lecture ratée, **omettre** l'information plutôt que d'afficher une valeur fausse (un 0
  qui ment). Erreurs journalisées par `handleException`, réponses Discord terminées par
  `.catch(() => {})`.

### Avant de livrer

- `npm run lint` (c'est ce que lance la CI).
- Pas de tests unitaires : tester le comportement sur une copie du dépôt dans le scratchpad, avec
  une base neuve (`points.db` se crée à la racine au premier import de `modules/points-db.js`),
  jamais sur le dépôt lui-même.
- Pour un bug : le test reproduit d'abord l'échec sur l'ancien code, puis passe sur le nouveau.
- Relire son diff de façon critique avant de pousser.
