[← README](../README.md)

# Architecture de PCR 2.0

## Vue d'ensemble

```
            Discord (gateway + REST)                 Navigateur (reverse proxy HTTPS)
                     │                                          │
              ┌──────▼──────┐                            ┌──────▼──────┐
              │ pcr-discord │  commandes, panneaux,      │   pcr-web   │  API JSON, OAuth2,
              │  (twilight) │  messages publics          │   (axum)    │  sessions, SSE, front
              └──────┬──────┘                            └──────┬──────┘
                     └──────────────┐          ┌────────────────┘
                              ┌─────▼──────────▼─────┐
                              │       pcr-app        │  cas d'usage, jobs, bus d'événements
                              └─────┬──────────┬─────┘
                       ┌────────────▼─┐      ┌─▼────────────┐
                       │   pcr-core   │      │    pcr-db    │  sqlx, migrations, dépôts
                       │ règles pures │      │   SQLite     │
                       └──────────────┘      └──────────────┘
```

`pcr` (binaire) assemble le tout : `pcr serve` lance le bot et le site dans le même processus.

## Parcours d'une action

1. Un clic Discord (ou une requête du site) arrive dans l'adaptateur, qui décode l'entrée.
2. L'adaptateur appelle **un** cas d'usage de `pcr-app` : une transaction, les règles de `pcr-core`,
   un résultat `(Outcome, Vec<Event>)`.
3. Après le commit, les événements partent sur le bus : le worker des messages publics met à jour les
   messages Discord concernés, et le site pousse un signal SSE (« relis »).
4. L'adaptateur rend le résultat : panneau éphémère côté Discord, JSON côté site.

Discord et le site appellent les mêmes cas d'usage : une règle n'existe qu'à un endroit.

## Données

| Base | Contenu | Cycle de vie |
|---|---|---|
| `pcr.db` | économie, jeu, paris, rappels, sessions, surcharges de config, `job_runs`, `public_messages`, `meta` | permanente, sauvegardée chaque jour |
| `stats-<année>.db` | toutes les statistiques (messages, mots, réactions, vocal, commandes, stats Pokémon…) | une par année, bascule au 1er janvier (Paris), récap annuel, suppression **manuelle** |

- Une seule connexion d'écriture par base (SQLite n'a qu'un écrivain) et un pool de lecture (WAL).
- Les stats sont mises en tampon et écrites par lots : un message Discord ne coûte pas une écriture par mot.
- Schéma vérifié à la compilation (voir [ADR 0002](adr/0002-sqlite-sqlx.md)).

## Configuration en trois couches

1. **Instance** (`/etc/pcr/instance.toml`) : IDs Discord, URL, écoute. Différente en prod et en dev.
2. **Secrets** (`/etc/pcr/pcr.env`, lu par systemd) : `DISCORD_TOKEN`, `DISCORD_CLIENT_SECRET`.
3. **Jeu** (GameConfig) : valeurs par défaut dans le code, surcharges à chaud en base (`/admin config`),
   gardées en mémoire. Aucun ID Discord dans cette couche, pour qu'une copie prod → dev reste inerte.

## Temps et hasard

- Un « jour » est un jour de Paris : minuit pour tout le monde (gains, loterie, boutique, anniversaires).
- `Clock` est la seule source de temps et le RNG est injecté : les tests figent l'un et l'autre.

## Environnements et livraison

- Deux VM Proxmox : prod (suit `main`) et dev (suit `dev`, 2ᵉ application Discord, serveur de test).
- GitHub Actions construit et signe le binaire ; chaque VM le récupère elle-même (pas de runner sur les
  VM) et revient en arrière si `/healthz` échoue. Voir [ADR 0004](adr/0004-deploiement-pull.md) et [ops](ops.md).

## Décisions

| ADR | Sujet |
|---|---|
| [0001](adr/0001-discord-twilight.md) | twilight plutôt que serenity/poise |
| [0002](adr/0002-sqlite-sqlx.md) | SQLite + sqlx vérifié à la compilation, écrivain unique |
| [0003](adr/0003-deux-bases.md) | une base permanente, une base de stats par année |
| [0004](adr/0004-deploiement-pull.md) | déploiement « pull » signé, sans runner sur les VM |
| [0005](adr/0005-front-v1-repris.md) | reprise du front v1, typé contre l'API |
| [0006](adr/0006-jiff-heure-de-paris.md) | jiff et l'heure de Paris |
| [0007](adr/0007-panneaux-pokemon.md) | panneaux Pokémon à la place de `/pk` |
