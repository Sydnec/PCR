[← README](../README.md)

# 🌐 API web

L'API du [site web](site.md). Elle tourne dans le même processus que le bot, sur la même base, et
appelle **les mêmes fonctions que les commandes Discord** : le site et Discord ne peuvent pas se
contredire, et tout ce que fait l'un reste faisable par l'autre.

Elle est **éteinte par défaut** : rien ne démarre sans `WEB_PORT`. Le même serveur sert le site
(`web/`) pour tout ce qui n'est pas sous `/api/`.

## Mise en service

La mise en ligne pas à pas est dans [site.md](site.md#mise-en-ligne). Les variables de `.env`
(voir `.env.example`) :

- `WEB_PORT` — port d'écoute, sur `127.0.0.1` (`WEB_HOST` pour changer : l'IP locale si le
  proxy est sur une autre machine) ;
- `WEB_BASE_URL` — adresse publique du site, sans barre finale ;
- `DISCORD_CLIENT_SECRET` — avec `CLIENT_ID`, `GUILD_ID` et `DEFAULT_ROLE_ID`, déjà présents ;
- `WEB_SESSION_SECRET` — au moins 32 caractères aléatoires. Le changer déconnecte tout le monde.

Réglages à chaud (`/admin config`) : `web.sessionHours` (168), `web.writesPerMinute` (60),
`web.spawnRefreshSeconds` (5, de 2 à 60), `web.accessDenialCacheSeconds` (60, de 0 à 3 600).

## Connexion

Le compte web **est** le compte Discord (portée `identify` seulement), et seuls les membres du
serveur qui portent le rôle `DEFAULT_ROLE_ID` obtiennent une session. C'est revérifié à chaque
requête connectée, par le cache du bot : un membre parti ou privé du rôle reçoit un `401` qui
efface sa session. Si Discord ne répond pas, c'est un `502`, et la session reste. Un membre parti
n'étant plus dans le cache, son refus est retenu `web.accessDenialCacheSeconds` pour ne pas
interroger Discord à chaque requête : s'il revient sur le serveur, il entre au plus tard après ce
délai. Rendre le rôle à un membre présent prend effet aussitôt.

| Route | Effet |
|---|---|
| `GET /api/auth/login?back=/page` | Redirige vers Discord ; revient ensuite sur `/page` (chemin du site uniquement). |
| `GET /api/auth/callback` | Retour de Discord : pose le cookie de session (`pcr_session`, HttpOnly, SameSite=Lax). En cas d'échec, renvoie sur `/?connexion=expiree`, `refusee`, `discord` ou `membre`. |
| `POST /api/auth/logout` | Efface la session. |

## Lecture

Toutes les réponses sont en JSON. `:userId` vaut `me` ou un identifiant Discord ; les routes marquées
🔒 exigent une session.

| Route | Réponse |
|---|---|
| `GET /api/health` | `{ ok, generation }` |
| `GET /api/me` 🔒 | `{ user, balance, balls, egg }` — `user.admin` pour `SYDNEC_USER_ID` |
| `GET /api/species` | `{ generation, species: [...] }` — espèces des générations ouvertes |
| `GET /api/species/:id` | fiche + `chain` (lignée) |
| `GET /api/catalogue` | `{ balls, items, types }` — clés, noms et emoji (`<:nom:id>` pour ceux du serveur), couleur de chaque type |
| `GET /api/species/:id/evolution?targetId&helper` | coût d'une évolution : `{ targets, sacrifices, required, points, helper }` — `required` compte celui qui évolue et celui qui reste, shiny ou non |
| `GET /api/users/:userId/pokedex` 🔒 | `{ dexSize, entries: [{ speciesId, shiny, count, firstCaughtAt }] }` |
| `GET /api/users/:userId/box` 🔒 | `{ total, page, pages, pageSize, items }` |
| `GET /api/users/:userId/inventory` 🔒 | `{ items: [{ key, label, emoji, description, count }] }` |
| `GET /api/me/egg` 🔒 | `{ egg }` ou `{ egg: null }` |
| `GET /api/me/lineage/:speciesId` 🔒 | `{ lineage }` — la lignée et ce que le dresseur possède de chaque maillon |
| `GET /api/spawn` 🔒 | `{ refreshSeconds, cooldownSeconds, pausedUntil, wallet, safari, spawn, last, drops }` — l'apparition du salon |
| `GET /api/safari` 🔒 | `{ offer, visit }` — ce que le dresseur peut faire du parc, et sa visite en cours (`null` sinon) |
| `GET /api/me/pc` 🔒 | `{ slotsPerBox, columns, maxBoxes, boxNameLength, nicknameLength, boxes, pokemon }` — la boîte PC |
| `GET /api/admin/config` 🔑 | `{ status, tree }` — la configuration en arbre |

`/box` accepte `page` (à partir de 0), `pageSize` (1 à 200, 50 par défaut), `species`, `sex`
(`M`, `F` ou `none`), `fertile` et `shiny` (`true`/`false`). Un individu :

```json
{ "id": 123, "speciesId": 25, "shiny": false, "sex": "F", "ball": "hyper",
  "origin": "capture", "fertile": true, "last": false, "obtainedAt": 1758600000000,
  "nickname": null }
```

`last` : dernier de son espèce (shiny compris), il ne peut pas partir. Une espèce porte `obtention` (`wild`,
`evolution` ou `egg`), `femaleShare` (`null` si asexuée), `breeder` (parent possible d'un œuf),
`sellValue` / `sellValueShiny` (prix de revente, 0 si invendable), ses évolutions, ses
illustrations (`sprite`, `spriteShiny`) et ses petites images (`icon`, `iconShiny`).

Balls et objets portent leur `emoji` (Discord) et `image` (PokéAPI, ou `null`).

`spawn` vaut `null` sans apparition ; sinon il porte l'espèce, son `sex`, la rareté, la difficulté
(`{ level, label }`, `level` de 0 à 5), ce que le dresseur en a déjà (`owned`, normal et shiny),
sa lignée (`lineage` : chaque maillon avec son stade et ce qu'il en possède, comme la fiche
Discord), les balls (`price`, `probability`, `free` = balls offertes, `usable` = en poche ou
payable avec le solde) et le journal des derniers
lancers (`throws`, avec le pseudo et l'avatar du serveur). L'objet tenu reste
secret. `last` est le dernier Pokémon parti (`CAUGHT` ou `FLED`), `drops` les objets au sol, et
`pausedUntil` la fin d'un parc safari qui suspend les apparitions. `wallet` (`{ balance, balls }`,
comme dans `/api/me`) fait suivre le solde à l'onglet Capture sans relire `/api/me`.

`safari` (et `offer` de `/api/safari`) : `{ enabled, session, freePark, price, actions, tickets,
retryAt, canBuy, blocked }`. `session` est la visite en cours (`{ id, actionsLeft }`), `freePark`
un parc où entrer gratuitement (`{ id, expiresAt, reserved }`). `canBuy` dit si l'achat d'une
entrée passerait ; sinon `blocked` vaut `balance` (solde insuffisant) ou `cooldown` (délai entre
deux achats, jusqu'à `retryAt`). Un Ticket Safari lève les deux.

Une visite : `{ id, token, actionsLeft, actionsTotal, expiresAt, finished, catches, ball,
encounter }`. `encounter` (`null` une fois la visite finie) porte l'espèce, `shiny`, `sex`, la
rareté, `probability`, `bait` (appâts avalés), `baitFactor`, `baitCapped` (un appât de plus ne
servirait à rien), `fleeRisk` et `owned`. `token` se renvoie avec chaque action.

Dans la boîte PC, `boxes` liste `{ box, name, custom, defaultName }` et chaque Pokémon est un
individu avec sa case, `pos` (boîte = `pos / slotsPerBox`). Un Pokémon sans place reçoit la
première libre à la lecture.

🔑 : réservé à `SYDNEC_USER_ID` (`403` pour tout autre), vérifié à chaque requête. L'arbre liste
chaque branche (`{ key, path, children }`) et chaque réglage (`{ key, path, type, current, fallback,
modified }`, plus `min` / `max` pour un nombre) ; `status` signale une surcharge illisible, comme
`/admin config-voir`. `value` est la saisie brute : un nombre, `true` / `false`, du texte, une liste
séparée par des virgules.

## Actions 🔒

Corps en JSON (`Content-Type: application/json`). Un Pokémon se désigne par `{ "pokemonId": 123 }`
ou par un groupe `{ "speciesId": 25, "isShiny": false, "sex": "F" }` — les deux formes des commandes.

| Route | Corps | Réponse |
|---|---|---|
| `POST /api/me/sell` | Pokémon, `quantity` pour un groupe | `{ sold, unit, points }` |
| `POST /api/me/evolve` | Pokémon (celui qui évolue), `targetId?`, `helper?` (clé d'un objet, ou `metamorph`) | `{ pokemon, sacrificesSpent, dittosSpent, pointsSpent, helper }` — `pokemon` est le même individu, sous sa nouvelle forme |
| `POST /api/me/eggs` | `{ parent1, parent2 }` | `{ egg }` |
| `POST /api/spawn/throw` | `{ spawnId, ball, requireItem? }` | `{ status, message, final, remaining, pokemon }` |
| `POST /api/drops/:id/claim` | `{}` | `{ item }` — `409` si quelqu'un a été plus rapide |
| `POST /api/safari/enter` | `{ parkId }` | `{ resumed, visit }` — entrée gratuite dans un parc ouvert |
| `POST /api/safari/buy` | `{}` | `{ resumed, ticket, visit }` — entrée payante, au ticket d'abord |
| `POST /api/safari/action` | `{ sessionId, token, action }` | `{ outcome, message, visit }` — `action` : `BALL`, `BAIT` ou `FLEE` |
| `POST /api/me/pc/move` | `{ pokemonId, pos }` | la boîte PC relue — l'occupant de la case prend l'ancienne place |
| `POST /api/me/pc/boxes/:box/name` | `{ name }` | `{ name, custom }` — vide : nom par défaut |
| `POST /api/me/pokemon/:id/nickname` | `{ nickname }` | `{ nickname }` — vide : plus de surnom |
| `POST /api/admin/config` 🔑 | `{ path, value }` | `{ path, before, after }` — comme `/admin config` |

Un lancer répond toujours `200` : un raté ou un « trop tard » sont des issues du jeu, pas des
erreurs. `status` vaut `miss`, `catch`, `void` (battu, remboursé), `gone`, `cooldown`,
`insufficient`, `no-item`, `unknown-ball` ou `error`. `message` est la phrase du panneau Discord,
et `final` dit qu'il n'y a plus rien à relancer. `requireItem` interdit de payer en points : c'est
la promesse d'une Master Ball annoncée offerte.

Une action du parc avec un jeton périmé (déjà jouée, ici ou sur Discord) répond `409` sans rien
consommer. `outcome` vaut `CATCH`, `MISS`, `MISS_FLED`, `BAIT`, `BAIT_FLED`, `FLED` ou
`FLEE_FAILED`, et `message` est la phrase de l'éphémère Discord.

## Erreurs

`{ "error": "message lisible" }`, avec le statut qui va : `400` requête invalide, `401` connexion
requise, `403` origine refusée ou non-membre, `404` introuvable, `409` **le jeu refuse** (dernier
exemplaire, solde insuffisant…), `413` corps trop gros, `415` corps non JSON, `429` trop d'actions,
`502` Discord injoignable, `500` erreur interne (détail dans les logs, jamais dans la réponse).

## Sécurité

- Sessions : jetons signés HMAC-SHA256, rien en mémoire ni en base ; comparaison à temps constant.
  Chaque jeton porte son usage (session ou état OAuth) : l'un ne passe pas pour l'autre.
- `state` OAuth2 signé, lié au navigateur, valable 10 minutes.
- Écritures : corps JSON obligatoire, `Origin` vérifié quand il est présent, 16 Ko maximum, limite
  par minute et par dresseur.
- Le serveur n'écoute que `127.0.0.1` par défaut : il est fait pour vivre derrière le proxy.
- Le site est servi avec une politique de sécurité stricte (voir [site.md](site.md#fonctionnement)).
