-- Base permanente (pcr.db) : tout ce qui traverse les années.
-- Jusqu'à la bascule v2, ce fichier unique est modifié sur place ; ensuite, migrations additives seulement.
--
-- Règles communes :
-- - identifiants Discord (membres, salons, messages) en INTEGER : un snowflake tient dans un i64 ;
-- - horodatages en millisecondes, jours en TEXT « AAAA-MM-JJ » (jour de Paris) ;
-- - booléens en INTEGER 0/1 vérifiés par CHECK, statuts fermés par CHECK : une valeur inattendue est
--   refusée à l'écriture plutôt que découverte à la lecture ;
-- - aucun nom de table ne recoupe ceux de stats-<ANNÉE>.db (build.rs vérifie les deux bases ensemble).

CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) STRICT;

-- ================== ÉCONOMIE ==================

-- Le solde et le compteur des gains de messages. Le solde peut passer sous zéro : `/admin points` retire
-- sans plancher, et les achats restent bloqués jusqu'à ce qu'il remonte. `messages_today` compte les
-- messages qui ont rapporté pendant `messages_day` ; un autre jour, il repart de zéro.
CREATE TABLE points (
    user_id         INTEGER PRIMARY KEY,
    balance         INTEGER NOT NULL DEFAULT 0,
    last_message_at INTEGER NOT NULL DEFAULT 0,
    messages_today  INTEGER NOT NULL DEFAULT 0 CHECK (messages_today >= 0),
    messages_day    TEXT
) STRICT;

-- Une ligne par mouvement de solde : la courbe des points de la page d'administration, et la piste
-- d'audit. `balance` est le solde après le mouvement, pour que la courbe se lise sans refaire les sommes.
-- En v1 des déclencheurs l'écrivaient ; ils datent avec l'horloge de SQLite, que les tests ne figent pas.
-- Le journal s'écrit donc dans la fonction de pcr-db qui bouge le solde, seule à le faire, dans la même
-- transaction. `source` dit d'où vient le mouvement (« v1 » pour l'historique importé, qui ne le disait
-- pas).
CREATE TABLE points_log (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    delta      INTEGER NOT NULL,
    balance    INTEGER NOT NULL,
    source     TEXT    NOT NULL,
    created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX points_log_user ON points_log (user_id, created_at);
CREATE INDEX points_log_time ON points_log (created_at);

-- État du pot commun : une seule ligne. L'échéance sert de verrou : l'UPDATE gardé qui la repousse ne
-- réussit qu'une fois par échéance. 0 = jamais planifiée : le premier passage la pose sans prélever,
-- sinon une installation neuve prélèverait tout le monde dès sa première heure. `redistribution_since`
-- est un bail : `/admin potcommun` contourne l'échéance, et deux pots ne doivent jamais tourner ensemble ;
-- il expire pour qu'un arrêt en plein pot ne bloque pas les suivants.
CREATE TABLE economy_state (
    id                     INTEGER PRIMARY KEY CHECK (id = 1),
    next_redistribution_at INTEGER NOT NULL DEFAULT 0,
    redistribution_since   INTEGER NOT NULL DEFAULT 0
) STRICT;
INSERT INTO economy_state (id) VALUES (1);

-- Journal des pots communs : un mouvement qui touche tous les soldes d'un coup mérite sa trace, et le
-- dernier pot donne le « depuis le dernier pot ». `triggered_by` : l'administrateur, NULL pour
-- l'échéance (« auto » en v1). `percent` : la cotisation appliquée (`rate` en v1). La colonne v1
-- `failures` disparaît : le pot tient dans une transaction, tout ou rien.
CREATE TABLE points_redistributions (
    id           INTEGER PRIMARY KEY,
    ran_at       INTEGER NOT NULL,
    triggered_by INTEGER,
    percent      REAL    NOT NULL CHECK (percent BETWEEN 0 AND 100),
    participants INTEGER NOT NULL CHECK (participants >= 0),
    contributors INTEGER NOT NULL CHECK (contributors >= 0),
    pot          INTEGER NOT NULL CHECK (pot >= 0),
    share        INTEGER NOT NULL CHECK (share >= 0)
) STRICT;

-- ================== PARIS ==================

-- OPEN : on peut miser ; LOCKED : mises fermées, résultat attendu ; CLOSED : payé ; CANCELLED : remboursé.
-- `winning_option` : l'option gagnante d'un pari classique fermé. `estimate_result` : la vraie valeur
-- d'un pari d'estimation fermé (le plus proche gagne). La v1 rangeait les deux dans
-- `winning_option_index`.
CREATE TABLE bets (
    id              INTEGER PRIMARY KEY,
    creator_id      INTEGER NOT NULL,
    title           TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'LOCKED', 'CLOSED', 'CANCELLED')),
    is_estimation   INTEGER NOT NULL DEFAULT 0 CHECK (is_estimation IN (0, 1)),
    winning_option  INTEGER,
    estimate_result INTEGER,
    CHECK (is_estimation = 0 OR winning_option IS NULL),
    CHECK (is_estimation = 1 OR estimate_result IS NULL)
) STRICT;

-- Les options d'un pari classique, numérotées à partir de 1 comme leurs boutons (`bet_join|<pari>|<n>`).
CREATE TABLE bet_options (
    bet_id       INTEGER NOT NULL REFERENCES bets (id),
    option_index INTEGER NOT NULL CHECK (option_index >= 1),
    label        TEXT    NOT NULL,
    PRIMARY KEY (bet_id, option_index)
) STRICT, WITHOUT ROWID;

-- Une mise par membre et par pari, modifiable tant que le pari est ouvert. Un pari classique désigne une
-- option, une estimation donne une valeur : exactement l'un des deux. La clé étrangère composite refuse
-- une option qui n'existe pas (une estimation, sans option, y échappe).
CREATE TABLE bet_participations (
    bet_id       INTEGER NOT NULL REFERENCES bets (id),
    user_id      INTEGER NOT NULL,
    option_index INTEGER,
    amount       INTEGER NOT NULL CHECK (amount > 0),
    prediction   INTEGER,
    PRIMARY KEY (bet_id, user_id),
    FOREIGN KEY (bet_id, option_index) REFERENCES bet_options (bet_id, option_index),
    CHECK ((option_index IS NULL) <> (prediction IS NULL))
) STRICT, WITHOUT ROWID;

-- ================== COMMUNAUTÉ ==================

-- Une ligne par membre. `year` est NULL quand le membre ne donne pas son âge. `last_wished_year` garde
-- contre le doublon : la fête part une fois par année, même après un redémarrage.
CREATE TABLE birthdays (
    user_id          INTEGER PRIMARY KEY,
    day              INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
    month            INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    year             INTEGER,
    last_wished_year INTEGER
) STRICT;

-- Rappels envoyés en MP. Ils vivaient dans la base annuelle de la v1 et disparaissaient au 1er janvier.
-- `channel_id` : le salon où le rappel a été créé, cité dans le MP. `sent_at` : NULL tant qu'il n'est
-- pas parti ; un envoi impossible (membre parti, MP fermés) le marque aussi, sans quoi il se
-- retenterait chaque minute pour toujours.
CREATE TABLE reminders (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    channel_id INTEGER NOT NULL,
    message    TEXT    NOT NULL,
    trigger_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    sent_at    INTEGER
) STRICT;
CREATE INDEX reminders_due ON reminders (trigger_at) WHERE sent_at IS NULL;
CREATE INDEX reminders_user ON reminders (user_id) WHERE sent_at IS NULL;
