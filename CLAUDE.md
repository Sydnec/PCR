# PCR — consignes pour Claude

## Livraison d'une feature ou d'un correctif

Le mainteneur ne fait que `git pull && pcr release <fix|minor|major>` sur `main`. Une livraison
n'est donc terminée que lorsqu'elle est **mergée dans `main`** :

1. Développer sur la branche de travail, commits en français au format conventionnel
   (`feat(pokemon): …`, `fix(pokemon): …`).
2. Ajouter l'entrée du changement dans `changelog.json` → `pending` (c'est ce que `pcr finish`
   faisait, et `pcr release` la reprend telle quelle) :
   `type` (`feature` / `fix` / `enhancement` / `chore`), `name`, `description` (texte destiné aux
   joueurs), `announce` (annoncé sur Discord ou non), `author: "Sydnec"`, `commit: "pending"`,
   `timestamp`, `branch`.
3. Mettre à jour le `README.md` si le comportement visible change.
4. Ouvrir la PR vers `main`, attendre la CI verte, puis la merger (merge commit).

Ne jamais toucher à la version (`package.json`, `changelog.json` → `version` / `releases`) : c'est
le rôle de `pcr release`.

## Vérifications

- `npm run lint` (c'est ce que lance la CI).
- Pas de tests unitaires : tester le comportement sur une copie du dépôt (base SQLite `points.db`
  créée à la racine au premier import de `modules/points-db.js`), jamais sur le dépôt lui-même.
