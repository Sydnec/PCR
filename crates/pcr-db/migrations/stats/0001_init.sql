-- Yearly statistics database (stats-<YEAR>.db). A new file starts every 1 January (Paris);
-- old files are kept until a human deletes them.

CREATE TABLE stats_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) STRICT;
