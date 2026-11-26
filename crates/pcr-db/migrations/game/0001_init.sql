-- Base permanente (pcr.db) : tout ce qui traverse les années.
-- Jusqu'à la bascule v2, ce fichier unique est modifié sur place ; ensuite, migrations additives seulement.

CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) STRICT;
