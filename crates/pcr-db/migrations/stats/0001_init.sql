-- Base des statistiques de l'année (stats-<ANNÉE>.db). Un nouveau fichier démarre chaque 1er janvier
-- (Paris) ; les anciens restent jusqu'à ce qu'un humain les supprime.

CREATE TABLE stats_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) STRICT;
