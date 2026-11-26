[← README](../README.md)

# Feuille de route PCR 2.0

Réécriture en Rust, même résultat pour les joueurs. Le détail des choix est dans
[architecture.md](architecture.md) et [adr/](adr/), la liste de ce qui reste à porter dans
[parity.md](parity.md).

## Décisions prises

| Sujet | Décision |
|---|---|
| Hébergement | 2 VM Proxmox Debian 13 : prod (suit `main`) et dev (suit `dev`, 2ᵉ application Discord, serveur de test) |
| HTTPS | reverse proxy existant |
| Déploiement | pull signé, sans runner ([ADR 0004](adr/0004-deploiement-pull.md), [ops](ops.md)) |
| Jours | minuit heure de Paris partout (changement à annoncer à la bascule) |
| Données | `pcr.db` permanente + `stats-<année>.db` ; récap annuel le 1er janvier ; fichier annuel supprimé à la main |
| Dev | copie de prod à la demande (`copy-prod-to-dev.sh`), MP limités à `dm_allowlist` |
| Jeu Pokémon | Centre Pokémon + `/pokemon`, `/pokedex`, `/zarbi`, clic droit ; plus de `/pk` ([ADR 0007](adr/0007-panneaux-pokemon.md)) |
| Front | site v1 repris, typé contre l'API, SSE ([ADR 0005](adr/0005-front-v1-repris.md)) |
| Abandons | `/autodel` ; historique du changelog v1 (repart de 2.0.0) |
| Tests | seulement les nécessaires (voir `CLAUDE.md`) |

## Phases

| Phase | Contenu | État |
|---|---|---|
| P0 | Workspace, CI, squelette du bot et du site, docs | ✅ |
| P1 | Build signé, mise à jour des VM avec retour arrière, sauvegardes, copie prod → dev | ✅ |
| P2a | Changelog (fragments, `xtask release`, annonce Discord, garde CI) | ✅ |
| P2b | Schéma v2 des deux bases (toutes les tables v1 utiles, `public_messages`, `job_runs`, `config_overrides`, `web_sessions`) | ✅ |
| P2c | `pcr migrate-v1` : empreinte du schéma v1, conversion, rapport d'invariants, fixture synthétique. **Gel de la v1.** | ✅ (v1 gelée à v1.22.1, `97c987a`) |
| P2d | GameConfig (macro, défauts v1, bornes, surcharges en base, `ArcSwap`), `/admin config` et `config-voir` | ✅ |
| P2e | Scheduler Paris + `job_runs`, stats tamponnées et bascule annuelle, worker `public_messages` | ✅ |
| P3a | Économie : gains de messages (et stats de messages, mots, emoji, commandes), `/solde`, `/classement`, `/admin points`, pot commun (minuteur + `/admin potcommun`) | en cours |
| P3b | Paris : `/bet`, `/estimate`, `/betstats`, les `custom_id` `bet_*`, messages publics du pari et de son résultat | à faire |
| P3c | Communauté : rappels (`/rappel`, bouton `rappel`, `/mesrappels`, envoi et purge), anniversaires, `/poll`, `/week`, `/edit`, `/ecaflip`, saints du jour (`/cotd` + minuteur), calendrier de l'Avent, `/randomizabaise`, `/safe-place`, `/join` | à faire |
| P3d | Administration et salon : `/admin purge`, `/admin purge-membre`, `/admin restart`, liens X/Instagram et traduction, rôles (message des rôles, rôle à l'arrivée, invitations, `/color`), liste des fils, stats de réactions et de vocal, `/help`, `/version` | à faire |
| P4 | Pokémon socle : spawn, lancers, shiny, objets, Centre Pokémon, Mon aventure, Boîte, `/pokedex` | à faire |
| P5 | Pokémon avancé : boutique, revente, loterie, évolution, œufs, pêche, safari, échanges, vitrine… | à faire |
| P6 | Site : API aux formes v1, OAuth, sessions, SSE, front repris, diff v1/v2 | à faire |
| P7 | Récap annuel | à faire |
| P8 | Bascule de la prod | à faire |

P3 (tout le non-Pokémon de `parity.md` §1, §3 et §5) est découpée en quatre PR : chacune tient en une
relecture, et les paris sortent de l'économie parce qu'ils apportent à eux seuls sept interactions, deux
types de messages publics et la réponse d'interaction enregistrée comme message public. `/admin item`,
`poids`, `pokespawn`, `safarispawn` et `saison` attendent le jeu Pokémon (P4, P5), la purge des sessions
du site arrive avec le site (P6).

## Démarrer une session

Une session par ligne du tableau (une PR vers `dev` chacune), en repartant d'un contexte vide :

> Lis `docs/roadmap.md` puis attaque **P2b**. Spécification : `docs/parity.md` (§8 tables) et la v1
> via `git show origin/main:modules/points-db.js` et `modules/db.js`. Termine par `cargo xtask check`,
> l'agent `code-reviewer`, un commit par étape, et mets l'état de la phase à jour ici.
