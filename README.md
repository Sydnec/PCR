# PCR — bot Discord communautaire

PCR anime le serveur : un jeu de capture de Pokémon, une économie de points, des paris, des sondages, des
rappels, des anniversaires, et un site compagnon pour jouer depuis le navigateur.

> **PCR 2.0 est en cours de réécriture en Rust** (branche `dev`). La v1 (Node.js) tourne en production
> depuis `main` jusqu'à la bascule. → [Feuille de route](docs/roadmap.md) · [Parité v1](docs/parity.md)

## Fonctionnalités

- **Pokémon** : apparitions dans un salon, lancers de balls payés en points, shiny, œufs, pêche, safari,
  loterie, boutique, échanges, évolutions, vitrine. En 2.0, on joue depuis le **Centre Pokémon** et
  `/pokemon` au lieu de `/pk`. → [Documentation du jeu](docs/pokemon/README.md)
- **Économie** : points gagnés en discutant, pot commun hebdomadaire, paris. → [Détails](docs/economie.md)
- **Communauté** : `/poll`, `/week`, `/rappel`, `/birthday`, `/cotd`, `/ecaflip`, `/randomizabaise`, `/color`,
  `/safe-place`, calendrier de l'Avent, liens X et Instagram avec traduction. → [Détails](docs/communaute.md)
- **Récap annuel** (nouveau en 2.0) : le 1er janvier, un bilan personnel en MP et un bilan du serveur.
- **Site** : capture en direct, parc safari, boîte PC, Pokédex, sac, œuf, administration. → [Site](docs/site.md) · [API](docs/api.md)
- **Administration** : `/admin` (points, objets, configuration à chaud, purges, événements). → [Détails](docs/administration.md)

Les pages joueurs de `docs/` décrivent encore les commandes v1 ; elles sont réécrites au fil du portage.

## Développement

Prérequis : Rust (la version est épinglée par `rust-toolchain.toml`, rustup l'installe seul).

```bash
cargo xtask check                      # fmt, clippy, tests : n'affiche que les échecs
cargo run -p pcr -- --config deploy/instance.example.toml check-config
DISCORD_TOKEN=… cargo run -p pcr -- --config <instance.toml>   # bot + site
```

```
crates/pcr-core     règles pures (aucune I/O)      crates/pcr-discord  adaptateur Discord (twilight)
crates/pcr-db       SQLite (sqlx, migrations)      crates/pcr-web      site et API (axum)
crates/pcr-app      cas d'usage, jobs, événements  crates/pcr          binaire
xtask/  automatisation · deploy/  VM et systemd · data/  données statiques · web/  front
```

→ [Architecture](docs/architecture.md) · [Décisions (ADR)](docs/adr/) · [Consignes de contribution](CLAUDE.md)

## Livraison

- `dev` déploie automatiquement le **bot de dev** (2ᵉ application Discord, serveur de test).
- `main` déploie automatiquement la **production**.
- GitHub Actions construit et signe le binaire ; chaque VM Proxmox le récupère, contrôle sa santé et
  revient en arrière en cas d'échec. → [Guide d'exploitation](docs/ops.md)
