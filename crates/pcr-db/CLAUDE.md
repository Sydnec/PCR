# pcr-db — stockage SQLite

- `build.rs` applique `migrations/{game,stats}/*.sql` à un `schema.db` jetable et exporte `DATABASE_URL` :
  chaque `sqlx::query!` est vérifié à la compilation. Rien à préparer, pas de dossier `.sqlx/`.
- `pcr.db` (persistante, migrations `game/`) : une connexion d'écriture unique + un pool de lecture.
  `stats-<année>.db` (migrations `stats/`, P2) : bascule au 1er janvier (Paris), jamais supprimée par le bot.
- Les noms de tables des deux bases ne doivent jamais se recouper (même base de vérification).
- Jusqu'à la bascule v2 : un seul `0001_init.sql` par base, modifié sur place. Après : migrations
  additives uniquement (un retour arrière doit rester possible). Modifier `0001_init.sql` change sa somme
  de contrôle : les bases existantes refusent alors de démarrer (« previously applied but has been
  modified ») et doivent être recréées (`migrate-v1` en dev).
- Un module par fonctionnalité, fonctions `async fn x(db: &Db | &mut SqliteConnection, …)`. Les cas
  d'usage multi-étapes reçoivent la transaction ouverte par `pcr-app`.
- Invariants en SQL (index uniques partiels, `CHECK`, `STRICT`), montants `INTEGER`, horodatages en ms.
