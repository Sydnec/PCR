# pcr-db — stockage SQLite

- `build.rs` applique `migrations/{game,stats}/*.sql` à un `schema.db` jetable et exporte `DATABASE_URL` :
  chaque `sqlx::query!` est vérifié à la compilation. Rien à préparer, pas de dossier `.sqlx/`.
- `pcr.db` (`Db`, migrations `game/`) et `stats-<année>.db` (`StatsDb`, migrations `stats/`) : chacune
  une connexion d'écriture unique + un pool de lecture. Deux types distincts : une fonction de stats
  appelée avec la base permanente (ou l'inverse) ne compile pas. La base de stats bascule au 1er janvier (Paris), jamais supprimée par le bot.
- Les noms de tables des deux bases ne doivent jamais se recouper (même base de vérification).
- Jusqu'à la bascule v2 : un seul `0001_init.sql` par base, modifié sur place. Après : migrations
  additives uniquement (un retour arrière doit rester possible). Modifier `0001_init.sql` change sa somme
  de contrôle : les bases existantes refusent alors de démarrer (« previously applied but has been
  modified ») et doivent être recréées (`migrate-v1` en dev).
- Un module par fonctionnalité, fonctions `async fn x(db: &Db | &mut SqliteConnection, …)`. Les cas
  d'usage multi-étapes reçoivent la transaction ouverte par `pcr-app`.
- Invariants en SQL (index uniques partiels, `CHECK`, `STRICT`), montants `INTEGER`, horodatages en ms.
- `points.balance` ne bouge que par la fonction de `points` qui écrit `points_log` dans la même
  transaction (pas de déclencheur : il daterait avec l'horloge de SQLite, pas avec `Clock`).
- `backup` : `vacuum_into` (copie cohérente, bot en marche) et `is_pcr_database`. Toute table qui stocke un
  salon/message Discord ou une action envers des membres doit être neutralisée par `pcr import-prod`.
