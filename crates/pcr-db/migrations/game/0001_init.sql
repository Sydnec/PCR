-- Persistent database (pcr.db): everything that carries over from one year to the next.
-- Until the v2 cut-over this single file is edited in place; afterwards, additive migrations only.

CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) STRICT;
