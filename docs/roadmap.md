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
| P3a | Économie : gains de messages (et stats de messages, mots, emoji, commandes), `/solde`, `/classement`, `/admin points`, pot commun (minuteur + `/admin potcommun`) | ✅ |
| P3b | Paris : `/bet`, `/estimate`, `/betstats`, les `custom_id` `bet_*`, messages publics du pari et de son résultat | ✅ |
| P3c | Communauté : rappels (`/rappel`, bouton `rappel`, `/mesrappels`, envoi et purge), anniversaires, `/poll`, `/week`, `/edit`, `/ecaflip`, saints du jour (`/cotd` + minuteur), calendrier de l'Avent, `/randomizabaise`, `/safe-place`, `/join` | ✅ |
| P3d | Administration et salon : `/admin purge`, `/admin purge-membre`, `/admin restart`, liens X/Instagram et traduction, rôles (message des rôles, rôle à l'arrivée, invitations, `/color`), liste des fils, stats de réactions et de vocal, `/help`, `/version` | ✅ |
| P4a | Pokémon, données et règles : espèces et tables de pêche converties par `build.rs`, génération ouverte (et plafond de `pokemon.generation`), rareté, sexe, formes, poids d'apparition (🔒, 🥚), probabilités de capture, difficulté, shiny, lignées, catalogue d'objets et ses tirages, `/admin poids` | ✅ |
| P4b | Apparitions : revendication au fil des messages, tirage (espèce, sexe, forme, shiny, objet tenu), message public et ses `custom_id` `poke_*`, fuite (balayage chaque minute), `/admin pokespawn`, fiche d'espèce (bouton « Infos »), balls en poche dans `/solde` | ✅ |
| P4c | Lancers : paiement en points ou ball en poche, délai entre deux lancers, Master Ball (confirmation, prix personnel), course et remboursement, individus (sexe, ball, verrou d'office), panneau de relance, annonce de capture ou de fuite, journal et stats, Charme Chroma | à faire |
| P4d | Objets : objet tenu remis à la capture, objet au sol (`poke_drop`), limite de détention et surplus (Master Ball, cannes), journal des objets, `/admin item` | à faire |
| P4e | `/pokedex` : Pokédex et ses filtres, fiche d'espèce, classement, lettres de Zarbi, clic droit › Pokédex | à faire |
| P4f | Centre Pokémon (message permanent) et `/pokemon` (Mon aventure) : Boîte et fiche d'individu (verrou, surnom), Sac, lien du site | à faire |
| P5 | Pokémon avancé : boutique, revente, loterie (et son rappel dans `/solde`), évolution, œufs, pêche, safari, échanges (et doublons), vitrine (et `/zarbi`)… | à faire |
| P6 | Site : API aux formes v1, OAuth, sessions, SSE, front repris, diff v1/v2 | à faire |
| P7 | Récap annuel | à faire |
| P8 | Bascule de la prod | à faire |

P3 (tout le non-Pokémon de `parity.md` §1, §3 et §5) est découpée en quatre PR : chacune tient en une
relecture, et les paris sortent de l'économie parce qu'ils apportent à eux seuls sept interactions, deux
types de messages publics et la réponse d'interaction enregistrée comme message public. `/admin item`,
`poids`, `pokespawn`, `safarispawn` et `saison` attendent le jeu Pokémon (P4, P5), la purge des sessions
du site arrive avec le site (P6).

P4 est découpée en six PR, chacune bâtie sur la précédente : les règles pures d'abord (ni base ni
Discord, elles se relisent contre les tests v1), puis le cycle d'une apparition, les lancers qui la
concluent, les objets qu'elle porte, et enfin les panneaux qui lisent tout cela. Les lancers sortent
des apparitions parce qu'ils apportent à eux seuls neuf `custom_id`, le paiement et la naissance des
individus. Les doublons rejoignent les échanges (P5), qui partagent leur calcul des évolutions mises de
côté, et `/zarbi` la vitrine (P5), l'autre image que dessine le bot.

## Démarrer une session

Une session par ligne du tableau (une PR vers `dev` chacune), en repartant d'un contexte vide :

> Lis `docs/roadmap.md` puis attaque **P2b**. Spécification : `docs/parity.md` (§8 tables) et la v1
> via `git show origin/main:modules/points-db.js` et `modules/db.js`. Termine par `cargo xtask check`,
> l'agent `code-reviewer`, un commit par étape, et mets l'état de la phase à jour ici.
