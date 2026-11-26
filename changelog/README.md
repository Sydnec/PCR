# Changelog

Chaque changement visible ajoute un fichier `unreleased/<slug>.toml` :

```toml
type = "feature"        # feature | enhancement | fix | chore
name = "Purge des messages d'un membre"
description = "Une ou deux phrases pour les joueurs, sans détail technique."
announce = true         # false pour ce qui ne concerne que le site ou l'administration
```

- Le bot de dev poste un aperçu des entrées en attente à chaque déploiement.
- `cargo xtask release <patch|minor|major>` replie les entrées dans `releases.toml` et monte la version.
  Ensuite seulement, la PR `dev` → `main` peut partir : la CI la refuse s'il reste des entrées en attente.
