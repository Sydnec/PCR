# 0002 — SQLite + sqlx vérifié à la compilation

**Décision.** SQLite (WAL, `foreign_keys`, tables `STRICT`) via sqlx 0.9. `pcr-db/build.rs` applique les
migrations à une base jetable et exporte `DATABASE_URL` : chaque `sqlx::query!` est vérifié à la compilation.
Une connexion d'écriture unique, un pool de lecture.

**Pourquoi.**
- Une requête fausse (colonne, type) ne compile pas : l'erreur arrive avant les tests, sans base à préparer
  ni dossier `.sqlx/` à régénérer (validé en P0 : `no such column` à la compilation).
- SQLite n'accepte qu'un écrivain : plusieurs connexions d'écriture produiraient des `SQLITE_BUSY` sur les
  transactions lecture→écriture qu'un délai d'attente ne résout pas. L'écrivain unique les rend impossibles,
  et rend inutiles les tests de course.
- Volume d'un serveur Discord : un serveur de base de données serait du poids sans bénéfice.

**Conséquence.** rusqlite (build uniquement) doit partager la version de `libsqlite3-sys` de sqlx (0.40).
