[← README](../README.md)

# 🌐 API web

L'API prépare l'interface web du jeu Pokémon. Elle tourne dans le même processus que le bot, sur
la même base, et appelle **les mêmes fonctions que les commandes Discord** : le site et Discord ne
peuvent pas se contredire, et tout ce que fait l'un reste faisable par l'autre.

Elle est **éteinte par défaut** : rien ne démarre sans `WEB_PORT`.

## Mise en service

1. **Application Discord** (portail développeur → OAuth2) : noter le *Client Secret* et ajouter
   la redirection `https://<site>/api/auth/callback`.
2. **`.env`** (voir `.env.example`) :
   - `WEB_PORT` — port d'écoute, sur `127.0.0.1` (`WEB_HOST` pour changer) ;
   - `WEB_BASE_URL` — adresse publique du site, sans barre finale ;
   - `DISCORD_CLIENT_SECRET` — avec `CLIENT_ID` et `GUILD_ID`, déjà présents ;
   - `WEB_SESSION_SECRET` — au moins 32 caractères aléatoires. Le changer déconnecte tout le monde.
3. **Reverse proxy** : servir le site et `/api/` sur la même origine, en HTTPS, et transmettre
   `/api/` à `127.0.0.1:WEB_PORT`.

Réglages à chaud (`/admin config`) : `web.sessionHours` (168), `web.writesPerMinute` (30).

## Connexion

Le compte web **est** le compte Discord (portée `identify` seulement), et seuls les membres du
serveur obtiennent une session.

| Route | Effet |
|---|---|
| `GET /api/auth/login?back=/page` | Redirige vers Discord ; revient ensuite sur `/page` (chemin du site uniquement). |
| `GET /api/auth/callback` | Retour de Discord : pose le cookie de session (`pcr_session`, HttpOnly, SameSite=Lax). |
| `POST /api/auth/logout` | Efface la session. |

## Lecture

Toutes les réponses sont en JSON. `:userId` vaut `me` ou un identifiant Discord ; les routes marquées
🔒 exigent une session.

| Route | Réponse |
|---|---|
| `GET /api/health` | `{ ok, generation }` |
| `GET /api/me` 🔒 | `{ user, balance, balls, egg }` |
| `GET /api/species` | `{ generation, species: [...] }` — espèces des générations ouvertes |
| `GET /api/species/:id` | fiche + `chain` (lignée) |
| `GET /api/species/:id/evolution?targetId&helper` | coût d'une fusion : `{ targets, duplicates, required, points, helper }` |
| `GET /api/users/:userId/pokedex` 🔒 | `{ dexSize, entries: [{ speciesId, shiny, count, firstCaughtAt }] }` |
| `GET /api/users/:userId/box` 🔒 | `{ total, page, pages, pageSize, items }` |
| `GET /api/users/:userId/inventory` 🔒 | `{ items: [{ key, label, emoji, description, count }] }` |
| `GET /api/me/egg` 🔒 | `{ egg }` ou `{ egg: null }` |

`/box` accepte `page` (à partir de 0), `pageSize` (1 à 200, 50 par défaut), `species`, `sex`
(`M`, `F` ou `none`), `fertile` et `shiny` (`true`/`false`). Un individu :

```json
{ "id": 123, "speciesId": 25, "shiny": false, "sex": "F", "ball": "hyper",
  "origin": "capture", "fertile": true, "last": false, "obtainedAt": 1758600000000 }
```

`last` : dernier de son entrée, il ne peut pas partir. Une espèce porte `obtention` (`wild`,
`evolution` ou `egg`), `femaleShare` (`null` si asexuée), ses évolutions et ses sprites.

## Actions 🔒

Corps en JSON (`Content-Type: application/json`). Un Pokémon se désigne par `{ "pokemonId": 123 }`
ou par un groupe `{ "speciesId": 25, "isShiny": false, "sex": "F" }` — les deux formes des commandes.

| Route | Corps | Réponse |
|---|---|---|
| `POST /api/me/sell` | Pokémon, `quantity` pour un groupe | `{ sold, unit, points }` |
| `POST /api/me/evolve` | Pokémon, `targetId?`, `helper?` | `{ pokemon, duplicatesSpent, pointsSpent, helper }` |
| `POST /api/me/eggs` | `{ parent1, parent2 }` | `{ egg }` |

## Erreurs

`{ "error": "message lisible" }`, avec le statut qui va : `400` requête invalide, `401` connexion
requise, `403` origine refusée ou non-membre, `404` introuvable, `409` **le jeu refuse** (dernier
exemplaire, solde insuffisant…), `413` corps trop gros, `415` corps non JSON, `429` trop d'actions,
`502` Discord injoignable, `500` erreur interne (détail dans les logs, jamais dans la réponse).

## Sécurité

- Sessions : jetons signés HMAC-SHA256, rien en mémoire ni en base ; comparaison à temps constant.
- `state` OAuth2 signé, lié au navigateur, valable 10 minutes.
- Écritures : corps JSON obligatoire, `Origin` vérifié quand il est présent, 16 Ko maximum, limite
  par minute et par dresseur.
- Le serveur n'écoute que `127.0.0.1` par défaut : il est fait pour vivre derrière le proxy.
