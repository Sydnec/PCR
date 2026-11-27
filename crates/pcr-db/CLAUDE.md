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
  d'usage multi-étapes reçoivent la transaction ouverte par `pcr-app` (`pcr_db::Conn` et
  `pcr_db::Transaction` nomment ces types sans que `pcr-app` dépende de `sqlx`).
- Invariants en SQL (index uniques partiels, `CHECK`, `STRICT`), montants `INTEGER`, horodatages en ms.
- Communauté : `reminders`, `birthdays` (garde `claim`/`release` : une fête par an) ; `stats::record_ship`
  écrit une ligne de `randomizabaise_stats` (pas un compteur).
- `points.balance` ne bouge que par `points::move_balance`, qui écrit `points_log` (avec sa `Source`)
  dans la même transaction (pas de déclencheur : il daterait avec l'horloge de SQLite, pas avec `Clock`).
  Une liste d'identifiants passe en JSON (`json_each(?)`) : `query!` ne sait pas lier un `IN` variable.
- Pokémon : `pokemon::spawn` (apparitions, état du salon, dépenses et journal des lancers ; la fuite est
  un `UPDATE` gardé sur le statut), `pokemon::collection` (exemplaires, sexes et formes d'un dresseur),
  `pokemon::items` (sac). Stats du jeu : `stats::Counter::Pokemon*` (colonnes dans `stats/pokemon.rs`,
  records par `combine`) et `stats::record_highlight` (une ligne par moment notable).
- `backup` : `vacuum_into` (copie cohérente, bot en marche) et `is_pcr_database`. Toute table qui stocke un
  salon/message Discord ou une action envers des membres doit être neutralisée dans
  `import_prod::neutralize` (appelé par `pcr import-prod`).
- `migrate_v1` (`pcr migrate-v1`) : conversion des bases v1 sur des copies attachées, une transaction par
  base, rapport d'invariants. `v1_*.sql` est le schéma v1 gelé, produit par le code v1 : ne jamais le
  retoucher à la main. Toute colonne v2 ajoutée avant la bascule doit y trouver sa source (ou son défaut).
