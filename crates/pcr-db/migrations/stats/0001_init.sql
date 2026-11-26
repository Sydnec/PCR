-- Base des statistiques de l'année (stats-<ANNÉE>.db). Un nouveau fichier démarre chaque 1er janvier
-- (Paris) ; les anciens restent jusqu'à ce qu'un humain les supprime. Jusqu'à la bascule v2, ce fichier
-- unique est modifié sur place ; ensuite, migrations additives seulement.
--
-- Règles communes :
-- - identifiants Discord en INTEGER : un snowflake tient dans un i64, et un INTEGER STRICT refuse
--   l'ancienne ligne « __global__ » au lieu de la garder silencieusement ;
-- - pas de ligne « __global__ » comme en v1 : les totaux du serveur sont des SUM, MAX ou MIN sur les
--   lignes des membres, et un classement n'a plus de ligne serveur à exclure. Seul le nombre d'échanges
--   du serveur ne s'en déduit pas (un échange compte pour ses deux dresseurs) : c'est le nombre de
--   lignes ACCEPTED de `pokemon_trades` (pcr.db) dont `resolved_at` tombe dans l'année à Paris, comme
--   le comptait la v1 (un échange avec soi-même une fois, SETTLED jamais) ;
-- - jours en TEXT « AAAA-MM-JJ », jour de Paris ; horodatages en millisecondes ;
-- - compteurs jamais négatifs : un retrait de trop est un bug, pas une donnée.
--
-- Aucun nom de table ne doit recouper ceux de pcr.db : build.rs vérifie les requêtes des deux bases
-- contre une seule base de schéma.

CREATE TABLE stats_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) STRICT;

-- ============ COMMUNAUTÉ ============

CREATE TABLE message_stats (
    user_id    INTEGER NOT NULL,
    channel_id INTEGER NOT NULL,
    day        TEXT    NOT NULL,
    count      INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
    PRIMARY KEY (user_id, channel_id, day)
) STRICT, WITHOUT ROWID;

-- Mots de plus de deux lettres, en minuscules : de quoi dire le mot préféré de chacun.
CREATE TABLE word_stats (
    user_id INTEGER NOT NULL,
    word    TEXT    NOT NULL,
    count   INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
    PRIMARY KEY (user_id, word)
) STRICT, WITHOUT ROWID;

-- Emoji écrits dans les messages et posés en réaction, réunis sous leur nom (sans l'ID d'un emoji
-- serveur, qui en ferait deux entrées pour le même dessin).
CREATE TABLE emoji_stats (
    user_id INTEGER NOT NULL,
    emoji   TEXT    NOT NULL,
    count   INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
    PRIMARY KEY (user_id, emoji)
) STRICT, WITHOUT ROWID;

-- Réactions posées par membre (un retrait décrémente).
CREATE TABLE reaction_stats (
    user_id INTEGER PRIMARY KEY,
    count   INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0)
) STRICT;

-- Réactions reçues par message : le message le plus réagi de l'année.
CREATE TABLE message_reactions (
    message_id INTEGER PRIMARY KEY,
    count      INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0)
) STRICT;

-- Commandes par nom ; une commande à sous-commandes compte chaque sous-commande à part (« admin
-- points »), sans quoi le récap confondrait toute l'administration.
CREATE TABLE command_stats (
    command TEXT PRIMARY KEY,
    count   INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0)
) STRICT;

-- /betstats : ce que chacun a misé dans l'année et son plus gros gain.
CREATE TABLE bet_stats (
    user_id       INTEGER PRIMARY KEY,
    total_wagered INTEGER NOT NULL DEFAULT 0 CHECK (total_wagered >= 0),
    max_win       INTEGER NOT NULL DEFAULT 0 CHECK (max_win >= 0)
) STRICT;

-- Temps passé en vocal. `joined_at` : en vocal depuis cet instant, NULL hors vocal ; remis à NULL au
-- démarrage, une session coupée par un arrêt du bot ne se mesure plus.
CREATE TABLE voice_time (
    user_id            INTEGER PRIMARY KEY,
    total_time_ms      INTEGER NOT NULL DEFAULT 0 CHECK (total_time_ms >= 0),
    longest_session_ms INTEGER NOT NULL DEFAULT 0 CHECK (longest_session_ms >= 0),
    joined_at          INTEGER
) STRICT;

-- Un /randomizabaise par ligne : les deux (ou trois, en shiny) membres tirés et les réactions que le
-- message a reçues.
CREATE TABLE randomizabaise_stats (
    message_id     INTEGER PRIMARY KEY,
    user_a         INTEGER NOT NULL,
    user_b         INTEGER NOT NULL,
    user_c         INTEGER,
    reaction_count INTEGER NOT NULL DEFAULT 0 CHECK (reaction_count >= 0),
    is_shiny       INTEGER NOT NULL DEFAULT 0 CHECK (is_shiny IN (0, 1))
) STRICT;

-- ============ POKÉMON ============
-- Le jeu vit dans pcr.db ; ces tables-ci ne gardent que l'année, exactement le périmètre du récap.

-- Agrégats par dresseur. `expected_catches` est la somme des probabilités de ses lancers : comparée à
-- `catches`, elle dit qui a eu de la chance. Les `best_*` et `fastest_*` restent NULL sans capture.
CREATE TABLE pokemon_stats (
    user_id                  INTEGER PRIMARY KEY,
    throws                   INTEGER NOT NULL DEFAULT 0 CHECK (throws >= 0),
    catches                  INTEGER NOT NULL DEFAULT 0 CHECK (catches >= 0),
    points_spent             INTEGER NOT NULL DEFAULT 0 CHECK (points_spent >= 0),
    points_burned            INTEGER NOT NULL DEFAULT 0 CHECK (points_burned >= 0),
    expected_catches         REAL    NOT NULL DEFAULT 0 CHECK (expected_catches >= 0),
    shiny_catches            INTEGER NOT NULL DEFAULT 0 CHECK (shiny_catches >= 0),
    legendary_catches        INTEGER NOT NULL DEFAULT 0 CHECK (legendary_catches >= 0),
    best_catch_probability   REAL,
    best_catch_species       INTEGER,
    fastest_catch_ms         INTEGER,
    most_throws_on_one_spawn INTEGER NOT NULL DEFAULT 0 CHECK (most_throws_on_one_spawn >= 0),
    -- v1 : `fusions` et `fusion_points`, du temps où l'évolution s'appelait fusion.
    evolutions               INTEGER NOT NULL DEFAULT 0 CHECK (evolutions >= 0),
    duplicates_spent         INTEGER NOT NULL DEFAULT 0 CHECK (duplicates_spent >= 0),
    evolution_points         INTEGER NOT NULL DEFAULT 0 CHECK (evolution_points >= 0),
    trades                   INTEGER NOT NULL DEFAULT 0 CHECK (trades >= 0),
    safari_sessions          INTEGER NOT NULL DEFAULT 0 CHECK (safari_sessions >= 0),
    safari_catches           INTEGER NOT NULL DEFAULT 0 CHECK (safari_catches >= 0),
    safari_points_spent      INTEGER NOT NULL DEFAULT 0 CHECK (safari_points_spent >= 0)
) STRICT;

-- Usage des balls par dresseur : combien lancées, pour combien de points.
CREATE TABLE pokemon_ball_stats (
    user_id INTEGER NOT NULL,
    ball    TEXT    NOT NULL,
    count   INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
    cost    INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0),
    PRIMARY KEY (user_id, ball)
) STRICT, WITHOUT ROWID;

-- Agrégats par espèce : la plus vue, la plus capturée, la plus coriace.
CREATE TABLE pokemon_species_stats (
    species_id              INTEGER PRIMARY KEY,
    spawns                  INTEGER NOT NULL DEFAULT 0 CHECK (spawns >= 0),
    catches                 INTEGER NOT NULL DEFAULT 0 CHECK (catches >= 0),
    escapes                 INTEGER NOT NULL DEFAULT 0 CHECK (escapes >= 0),
    shiny_spawns            INTEGER NOT NULL DEFAULT 0 CHECK (shiny_spawns >= 0),
    shiny_catches           INTEGER NOT NULL DEFAULT 0 CHECK (shiny_catches >= 0),
    throws_received         INTEGER NOT NULL DEFAULT 0 CHECK (throws_received >= 0),
    points_burned           INTEGER NOT NULL DEFAULT 0 CHECK (points_burned >= 0),
    max_throws_single_spawn INTEGER NOT NULL DEFAULT 0 CHECK (max_throws_single_spawn >= 0)
) STRICT;

-- Moments notables, un par ligne, pour raconter l'année plutôt que la résumer.
CREATE TABLE pokemon_highlights (
    id         INTEGER PRIMARY KEY,
    type       TEXT    NOT NULL
               CHECK (type IN ('SHINY', 'LEGENDAIRE', 'SPAWN_DISPUTE', 'FUITE_COUTEUSE')),
    user_id    INTEGER,
    species_id INTEGER,
    is_shiny   INTEGER NOT NULL DEFAULT 0 CHECK (is_shiny IN (0, 1)),
    value      INTEGER,
    detail     TEXT,
    created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX pokemon_highlights_type ON pokemon_highlights (type, created_at);

-- Activité par jour : la courbe de l'année.
CREATE TABLE pokemon_daily_stats (
    day           TEXT PRIMARY KEY,
    spawns        INTEGER NOT NULL DEFAULT 0 CHECK (spawns >= 0),
    throws        INTEGER NOT NULL DEFAULT 0 CHECK (throws >= 0),
    catches       INTEGER NOT NULL DEFAULT 0 CHECK (catches >= 0),
    points_burned INTEGER NOT NULL DEFAULT 0 CHECK (points_burned >= 0)
) STRICT;
