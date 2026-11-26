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

-- ================== FONCTIONNEMENT ==================

-- Les réglages de jeu modifiés à chaud (`/admin config`, page d'administration) : seulement ce qui
-- diffère des valeurs par défaut du code, en JSON, sous le chemin pointé du réglage
-- (« pokemon.spawn.shinyOdds »). Un défaut qui change dans le code s'applique donc partout où personne
-- ne l'a surchargé, et supprimer une ligne revient au défaut. Aucun identifiant Discord ici : une copie
-- prod → dev reste inerte. `updated_by` : l'administrateur, NULL pour une surcharge reprise de la v1.
CREATE TABLE config_overrides (
    key        TEXT    PRIMARY KEY,
    value      TEXT    NOT NULL CHECK (json_valid(value)),
    updated_at INTEGER NOT NULL,
    updated_by INTEGER
) STRICT;

-- Les passages des tâches planifiées : une ligne par tâche et par période (« 2026-11-26 » pour une tâche
-- quotidienne, « 2026-W48 » pour une hebdomadaire…). La ligne est la revendication : la clé primaire
-- interdit deux passages pour la même période, même après un redémarrage, et une période échue sans
-- ligne est une échéance manquée, à rattraper. `done_at` NULL : passage commencé mais pas terminé ;
-- `claimed_at` sert alors de bail, pour qu'un arrêt en plein passage n'empêche pas de le reprendre, et
-- `attempts` espace les reprises.
CREATE TABLE job_runs (
    job        TEXT    NOT NULL,
    period_key TEXT    NOT NULL,
    claimed_at INTEGER NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1),
    done_at    INTEGER,
    PRIMARY KEY (job, period_key)
) STRICT, WITHOUT ROWID;

-- Les messages publics que le bot poste puis réécrit au fil de la partie : annonce d'apparition, offre
-- d'échange, objet au sol, parc safari, direct d'une visite, bilan de saison. Une ligne par message,
-- désignée par la ligne de jeu qu'il montre (`kind`, `entity_id`) ; les tables de jeu ne portent ni
-- salon ni message.
--
-- Le cas d'usage qui change l'état de jeu monte `version` dans sa transaction. Après le commit, le
-- worker relit la base, construit le contenu, l'écrit sur Discord puis pose `synced_version`. Un message
-- en retard (`synced_version < version`) se voit donc en SQL : une panne de Discord ou un arrêt au
-- mauvais moment se rattrapent sans rien perdre, et une réécriture lente ne repose jamais un état
-- périmé par-dessus un plus récent (elle n'avance `synced_version` que jusqu'à la version qu'elle a lue).
--
-- `message_id` : NULL tant que le message n'est pas posté. `gone_at` : Discord a répondu que ce message
-- ne se réécrira plus (supprimé, salon perdu, droits retirés) ; il sort du rattrapage. `pcr import-prod`
-- le pose aussi sur tout ce qui vient de la prod.
CREATE TABLE public_messages (
    id             INTEGER PRIMARY KEY,
    kind           TEXT    NOT NULL CHECK (kind IN (
                       'spawn', 'trade', 'drop', 'safari_park', 'safari_live', 'season_recap')),
    entity_id      INTEGER NOT NULL,
    channel_id     INTEGER NOT NULL,
    message_id     INTEGER,
    version        INTEGER NOT NULL DEFAULT 1,
    synced_version INTEGER NOT NULL DEFAULT 0,
    changed_at     INTEGER NOT NULL,
    gone_at        INTEGER,
    UNIQUE (kind, entity_id),
    CHECK (synced_version BETWEEN 0 AND version)
) STRICT;
CREATE INDEX public_messages_pending ON public_messages (changed_at)
    WHERE synced_version < version AND gone_at IS NULL;

-- Sessions du site. Le cookie porte un jeton aléatoire ; seule son empreinte SHA-256 est gardée, si bien
-- qu'une copie de la base ne donne aucune session. L'identité Discord (pseudo, avatar) est figée à la
-- connexion, comme dans le jeton signé de la v1. Une ligne par connexion : se déconnecter, ou expirer,
-- n'en supprime qu'une.
CREATE TABLE web_sessions (
    token_hash BLOB    PRIMARY KEY CHECK (length(token_hash) = 32),
    user_id    INTEGER NOT NULL,
    username   TEXT    NOT NULL,
    avatar     TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
) STRICT;
CREATE INDEX web_sessions_user ON web_sessions (user_id);
CREATE INDEX web_sessions_expiry ON web_sessions (expires_at);

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

-- ================== POKÉMON : APPARITIONS ET CAPTURES ==================
-- Toutes ces tables vivent ici, jamais dans la base annuelle : les collections traversent les années.
-- Leurs messages publics (annonce, offre, objet au sol, parc, direct, bilan) sont dans `public_messages`.

-- État global : une seule ligne, point de sérialisation du déclenchement des apparitions.
-- `spawn_paused_until` : la pause pendant un parc safari, ici pour tenir dans l'UPDATE gardé qui
-- revendique une apparition. (Le drapeau v1 `spawning` disparaît : il couvrait l'envoi du message entre
-- la revendication et l'insertion ; la v2 fait les deux dans une transaction et poste après le commit.)
CREATE TABLE pokemon_state (
    id                 INTEGER PRIMARY KEY CHECK (id = 1),
    message_count      INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
    last_spawn_at      INTEGER NOT NULL DEFAULT 0,
    total_spawns       INTEGER NOT NULL DEFAULT 0 CHECK (total_spawns >= 0),
    spawn_paused_until INTEGER NOT NULL DEFAULT 0
) STRICT;
INSERT INTO pokemon_state (id) VALUES (1);

-- Apparitions du salon (ACTIVE) et touches de pêche (FISHING, réservées à `reserved_for`, hors du
-- salon). Tout ce qui fait la rencontre est figé à l'apparition : taux de capture, rareté, shiny, objet
-- tenu, sexe, forme. Retoucher les données ou la config ne change jamais une partie en cours, et
-- l'individu capturé est celui que l'annonce a montré. `cast_cost` : ce que la canne a coûté (bilan de
-- saison), NULL pour une apparition. `flees_at` : l'échéance de fuite, tirée à l'apparition.
CREATE TABLE pokemon_spawns (
    id           INTEGER PRIMARY KEY,
    species_id   INTEGER NOT NULL,
    is_shiny     INTEGER NOT NULL DEFAULT 0 CHECK (is_shiny IN (0, 1)),
    charm_shiny  INTEGER NOT NULL DEFAULT 0 CHECK (charm_shiny IN (0, 1)),
    catch_rate   INTEGER NOT NULL,
    rarity       TEXT    NOT NULL
                 CHECK (rarity IN ('COMMUN', 'PEU_COMMUN', 'RARE', 'TRES_RARE', 'LEGENDAIRE')),
    held_item    TEXT,
    sex          TEXT    CHECK (sex IN ('M', 'F')),
    form         TEXT,
    status       TEXT    NOT NULL DEFAULT 'ACTIVE'
                 CHECK (status IN ('ACTIVE', 'FISHING', 'CAUGHT', 'FLED')),
    fished       INTEGER NOT NULL DEFAULT 0 CHECK (fished IN (0, 1)),
    reserved_for INTEGER,
    cast_cost    INTEGER CHECK (cast_cost >= 0),
    spawned_at   INTEGER NOT NULL,
    flees_at     INTEGER,
    throw_count  INTEGER NOT NULL DEFAULT 0 CHECK (throw_count >= 0),
    caught_by    INTEGER,
    caught_at    INTEGER,
    caught_ball  TEXT,
    ended_at     INTEGER,
    CHECK (status <> 'FISHING' OR reserved_for IS NOT NULL),
    CHECK (status <> 'CAUGHT' OR caught_by IS NOT NULL)
) STRICT;
-- Jamais deux apparitions dans le salon à la fois, et une seule touche de pêche par dresseur.
CREATE UNIQUE INDEX pokemon_spawns_active ON pokemon_spawns (status) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX pokemon_spawns_fishing ON pokemon_spawns (reserved_for) WHERE status = 'FISHING';
CREATE INDEX pokemon_spawns_flees ON pokemon_spawns (status, flees_at);

-- Journal des lancers : le direct de l'annonce, les statistiques, et la piste d'audit des
-- remboursements (VOID, jamais compté comme un lancer). Le prix de la Master Ball se lit ici : combien
-- ce dresseur en a déjà payé.
CREATE TABLE pokemon_throws (
    id          INTEGER PRIMARY KEY,
    spawn_id    INTEGER NOT NULL REFERENCES pokemon_spawns (id),
    user_id     INTEGER NOT NULL,
    ball        TEXT    NOT NULL,
    cost        INTEGER NOT NULL CHECK (cost >= 0),
    probability REAL    CHECK (probability BETWEEN 0 AND 1),
    result      TEXT    NOT NULL CHECK (result IN ('CATCH', 'MISS', 'VOID')),
    thrown_at   INTEGER NOT NULL
) STRICT;
CREATE INDEX pokemon_throws_spawn ON pokemon_throws (spawn_id, id);
CREATE INDEX pokemon_throws_user_ball ON pokemon_throws (user_id, ball);

-- Objets lâchés par un Pokémon qui s'en va : le premier qui clique le ramasse (UPDATE gardé sur le
-- statut). LOST : personne ne l'a ramassé à temps.
CREATE TABLE pokemon_drops (
    id         INTEGER PRIMARY KEY,
    spawn_id   INTEGER REFERENCES pokemon_spawns (id),
    item_key   TEXT    NOT NULL,
    species_id INTEGER,
    status     TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLAIMED', 'LOST')),
    dropped_at INTEGER NOT NULL,
    claimed_by INTEGER,
    claimed_at INTEGER,
    CHECK (status <> 'CLAIMED' OR claimed_by IS NOT NULL)
) STRICT;
CREATE INDEX pokemon_drops_open ON pokemon_drops (status, id);

-- ================== POKÉMON : COLLECTION ==================

-- Un Pokémon par ligne : tout ce qui distingue deux individus vit ici.
-- - `sex` : NULL pour une espèce asexuée ; `form` : la lettre d'un Zarbi, NULL sans forme.
-- - `ball` : la ball de capture (clé de config, ou « safari »), NULL sans capture ou inconnue.
-- - `origin` : comment le dresseur actuel l'a obtenu ; `obtained_at` : depuis quand.
-- - `sterile` : un individu ne pond qu'un œuf dans sa vie ; `locked` : il ne part jamais (ni revente,
--   ni échange, ni sacrifice).
-- - `pc_pos`, `nickname`, `showcase_pos` : rangement et décor, sans effet sur le jeu. Deux individus
--   peuvent prétendre à la même case du PC (course, échange) : la disposition tranche à la lecture,
--   le plus ancien garde la case. D'où aucun index unique.
-- Aucune revente, évolution ni échange ne prend le dernier individu d'une espèce : c'est au code de
-- le garantir, dans la transaction qui le retire.
CREATE TABLE pokemon_owned (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL,
    species_id   INTEGER NOT NULL,
    is_shiny     INTEGER NOT NULL DEFAULT 0 CHECK (is_shiny IN (0, 1)),
    sex          TEXT    CHECK (sex IN ('M', 'F')),
    form         TEXT,
    ball         TEXT,
    origin       TEXT    NOT NULL CHECK (origin IN (
                     'capture', 'safari', 'evolution', 'echange', 'oeuf', 'starter', 'migration')),
    sterile      INTEGER NOT NULL DEFAULT 0 CHECK (sterile IN (0, 1)),
    locked       INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
    obtained_at  INTEGER NOT NULL,
    pc_pos       INTEGER CHECK (pc_pos >= 0),
    nickname     TEXT,
    showcase_pos INTEGER
) STRICT;
CREATE INDEX pokemon_owned_entry ON pokemon_owned (user_id, species_id, is_shiny);
-- « Qui a cette espèce en double ? » lit une espèce chez tous les dresseurs.
CREATE INDEX pokemon_owned_species ON pokemon_owned (species_id);

-- Les boîtes du PC qu'un dresseur a nommées ou archivées ; une boîte sans ligne garde son nom par
-- défaut. `name` NULL : nom par défaut (une boîte archivée sans nom à elle ; la v1 y mettait '').
CREATE TABLE pokemon_pc_boxes (
    user_id  INTEGER NOT NULL,
    box      INTEGER NOT NULL CHECK (box >= 0),
    name     TEXT,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    PRIMARY KEY (user_id, box)
) STRICT, WITHOUT ROWID;

-- Le dernier partage public de la vitrine de chaque dresseur : la ligne revendique le délai entre deux
-- partages.
CREATE TABLE pokemon_showcase_shares (
    user_id   INTEGER PRIMARY KEY,
    shared_at INTEGER NOT NULL
) STRICT;

-- Journal des évolutions (« fusions » en v1, d'où son ancien nom `pokemon_fusions`).
-- `duplicates_spent` : les exemplaires sacrifiés.
CREATE TABLE pokemon_evolutions (
    id               INTEGER PRIMARY KEY,
    user_id          INTEGER NOT NULL,
    from_species_id  INTEGER NOT NULL,
    to_species_id    INTEGER NOT NULL,
    is_shiny         INTEGER NOT NULL DEFAULT 0 CHECK (is_shiny IN (0, 1)),
    duplicates_spent INTEGER NOT NULL CHECK (duplicates_spent >= 0),
    points_spent     INTEGER NOT NULL CHECK (points_spent >= 0),
    created_at       INTEGER NOT NULL
) STRICT;

-- Journal des reventes : une vente détruit des exemplaires dont rien d'autre ne dira qu'ils ont existé.
CREATE TABLE pokemon_sales (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    species_id INTEGER NOT NULL,
    is_shiny   INTEGER NOT NULL DEFAULT 0 CHECK (is_shiny IN (0, 1)),
    quantity   INTEGER NOT NULL CHECK (quantity > 0),
    points     INTEGER NOT NULL CHECK (points >= 0),
    sold_at    INTEGER NOT NULL
) STRICT;
CREATE INDEX pokemon_sales_user ON pokemon_sales (user_id, id);

-- Œufs. Un seul en couvaison par dresseur. Le seuil de messages et l'échéance sont figés à la ponte.
-- Les parents sont désignés par leur id sans clé étrangère : ils peuvent partir avant l'éclosion, et
-- leur espèce reste écrite à côté. `shiny_parents` : chacun multiplie les chances de shiny du bébé.
-- `pokemon_id` : l'individu éclos.
CREATE TABLE pokemon_eggs (
    id                INTEGER PRIMARY KEY,
    user_id           INTEGER NOT NULL,
    species_id        INTEGER NOT NULL,
    father_id         INTEGER,
    mother_id         INTEGER,
    father_species_id INTEGER NOT NULL,
    mother_species_id INTEGER NOT NULL,
    shiny_parents     INTEGER NOT NULL DEFAULT 0 CHECK (shiny_parents BETWEEN 0 AND 2),
    status            TEXT    NOT NULL DEFAULT 'INCUBATING' CHECK (status IN ('INCUBATING', 'HATCHED')),
    messages          INTEGER NOT NULL DEFAULT 0 CHECK (messages >= 0),
    hatch_messages    INTEGER NOT NULL CHECK (hatch_messages >= 0),
    laid_at           INTEGER NOT NULL,
    hatch_at          INTEGER NOT NULL,
    hatched_at        INTEGER,
    pokemon_id        INTEGER,
    CHECK (status <> 'HATCHED' OR hatched_at IS NOT NULL)
) STRICT;
CREATE UNIQUE INDEX pokemon_eggs_incubating ON pokemon_eggs (user_id) WHERE status = 'INCUBATING';

-- ================== POKÉMON : ÉCHANGES ==================

-- Offres d'échange. Chaque côté est un Pokémon, des points (0 = « rien ») ou un objet, et le côté
-- demandé peut rester « à son choix » (`request_open`) : exactement l'un d'eux, vérifié ici. Un côté
-- Pokémon désigne un individu (`*_pokemon_id`) avec l'espèce, la variante, le sexe, la forme et la
-- fertilité qu'il doit encore avoir à l'acceptation ; `*_pokemon_id` NULL : le destinataire choisira.
-- (La v1 notait « pas de Pokémon » par l'espèce 0.)
-- `expires_at` permet une expiration paresseuse dans le WHERE de l'acceptation. Offre ouverte à tous
-- (`open_offer`) : `to_user_id` reste NULL jusqu'au premier qui accepte. `counter_of` : l'offre qu'une
-- contre-offre remplace (passée COUNTERED) ; SETTLED : offre ouverte close par une contre-offre acceptée.
CREATE TABLE pokemon_trades (
    id                 INTEGER PRIMARY KEY,
    from_user_id       INTEGER NOT NULL,
    to_user_id         INTEGER,
    open_offer         INTEGER NOT NULL DEFAULT 0 CHECK (open_offer IN (0, 1)),
    offer_pokemon_id   INTEGER,
    offer_species_id   INTEGER,
    offer_is_shiny     INTEGER NOT NULL DEFAULT 0 CHECK (offer_is_shiny IN (0, 1)),
    offer_sex          TEXT    CHECK (offer_sex IN ('M', 'F')),
    offer_form         TEXT,
    offer_fertile      INTEGER CHECK (offer_fertile IN (0, 1)),
    offer_points       INTEGER CHECK (offer_points >= 0),
    offer_item         TEXT,
    offer_item_qty     INTEGER CHECK (offer_item_qty > 0),
    request_open       INTEGER NOT NULL DEFAULT 0 CHECK (request_open IN (0, 1)),
    request_pokemon_id INTEGER,
    request_species_id INTEGER,
    request_is_shiny   INTEGER NOT NULL DEFAULT 0 CHECK (request_is_shiny IN (0, 1)),
    request_sex        TEXT    CHECK (request_sex IN ('M', 'F')),
    request_form       TEXT,
    request_fertile    INTEGER CHECK (request_fertile IN (0, 1)),
    request_points     INTEGER CHECK (request_points >= 0),
    request_item       TEXT,
    request_item_qty   INTEGER CHECK (request_item_qty > 0),
    status             TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN (
                           'PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'FAILED', 'EXPIRED',
                           'COUNTERED', 'SETTLED')),
    counter_of         INTEGER REFERENCES pokemon_trades (id),
    created_at         INTEGER NOT NULL,
    expires_at         INTEGER NOT NULL,
    resolved_at        INTEGER,
    CHECK (open_offer = 1 OR to_user_id IS NOT NULL),
    CHECK ((offer_species_id IS NOT NULL) + (offer_points IS NOT NULL) + (offer_item IS NOT NULL) = 1),
    CHECK ((request_species_id IS NOT NULL) + (request_points IS NOT NULL)
           + (request_item IS NOT NULL) + request_open = 1),
    CHECK ((offer_item IS NULL) = (offer_item_qty IS NULL)),
    CHECK ((request_item IS NULL) = (request_item_qty IS NULL))
) STRICT;
CREATE INDEX pokemon_trades_pending ON pokemon_trades (expires_at) WHERE status = 'PENDING';

-- Le brouillon d'un échange : ce que le dresseur a choisi de chaque côté avant « Proposer ». Chaque
-- côté est le choix tel quel (JSON), revalidé en entier à l'envoi : le brouillon retient, il ne promet
-- rien. `channel_id` : le salon où l'offre sera publiée. `counter_of` : l'offre qu'il contre.
CREATE TABLE pokemon_trade_drafts (
    id           INTEGER PRIMARY KEY,
    from_user_id INTEGER NOT NULL,
    to_user_id   INTEGER,
    channel_id   INTEGER,
    offer        TEXT    CHECK (json_valid(offer)),
    request      TEXT    CHECK (json_valid(request)),
    counter_of   INTEGER REFERENCES pokemon_trades (id),
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL
) STRICT;

-- ================== POKÉMON : OBJETS ET BOUTIQUE ==================

-- Le sac : un compteur par clé d'objet ; nom, icône et effet viennent du catalogue de la config. La
-- ligne survit à count = 0 pour garder `first_obtained_at` : toute lecture filtre sur count > 0.
CREATE TABLE pokemon_inventory (
    user_id           INTEGER NOT NULL,
    item_key          TEXT    NOT NULL,
    count             INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
    first_obtained_at INTEGER,
    last_obtained_at  INTEGER,
    PRIMARY KEY (user_id, item_key)
) STRICT, WITHOUT ROWID;

-- Journal des mouvements d'objets : le compteur dit ce qu'on a, le journal dit d'où ça vient (le jour
-- où un dresseur jure n'avoir jamais reçu son ticket).
CREATE TABLE pokemon_item_log (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    item_key   TEXT    NOT NULL,
    delta      INTEGER NOT NULL CHECK (delta <> 0),
    source     TEXT    NOT NULL,
    created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX pokemon_item_log_user ON pokemon_item_log (user_id, id);

-- Les balls spéciales achetées, une ligne par ball : la date d'achat décide si elle sert à une
-- apparition (seulement celles d'après). Consommée en supprimant la ligne, rendue en la réinsérant.
CREATE TABLE pokemon_ball_units (
    id        INTEGER PRIMARY KEY,
    user_id   INTEGER NOT NULL,
    ball      TEXT    NOT NULL,
    bought_at INTEGER NOT NULL
) STRICT;
CREATE INDEX pokemon_ball_units_user ON pokemon_ball_units (user_id, ball, bought_at);

-- Le quota d'achat du jour de chaque ball spéciale, réservé avant le débit par un UPSERT gardé et rendu
-- pour ce qui n'est pas livré : c'est lui qui tient la règle, pas le journal des achats.
CREATE TABLE pokemon_shop_daily (
    user_id INTEGER NOT NULL,
    ball    TEXT    NOT NULL,
    day     TEXT    NOT NULL,
    bought  INTEGER NOT NULL DEFAULT 0 CHECK (bought >= 0),
    PRIMARY KEY (user_id, ball, day)
) STRICT, WITHOUT ROWID;

-- Les achats conclus, au prix réellement payé : le bilan de saison seulement.
CREATE TABLE pokemon_shop_purchases (
    id        INTEGER PRIMARY KEY,
    user_id   INTEGER NOT NULL,
    ball      TEXT    NOT NULL,
    quantity  INTEGER NOT NULL CHECK (quantity > 0),
    cost      INTEGER NOT NULL CHECK (cost >= 0),
    bought_at INTEGER NOT NULL
) STRICT;
CREATE INDEX pokemon_shop_purchases_time ON pokemon_shop_purchases (bought_at);

-- Loterie : une ligne par dresseur. `last_day` porte seule la règle du « une fois par jour » : c'est
-- la colonne que garde l'écriture (NULL : jamais joué ; comparer avec IS NOT, pas <>).
-- `draws` et `wins` sont cumulés depuis toujours.
CREATE TABLE pokemon_lottery (
    user_id      INTEGER PRIMARY KEY,
    last_day     TEXT,
    last_draw_at INTEGER NOT NULL DEFAULT 0,
    draws        INTEGER NOT NULL DEFAULT 0 CHECK (draws >= 0),
    wins         INTEGER NOT NULL DEFAULT 0 CHECK (wins BETWEEN 0 AND draws)
) STRICT;

-- Un tirage par ligne, daté : le bilan d'une saison compte les tirages de sa fenêtre.
CREATE TABLE pokemon_lottery_draws (
    id       INTEGER PRIMARY KEY,
    user_id  INTEGER NOT NULL,
    won      INTEGER NOT NULL DEFAULT 0 CHECK (won IN (0, 1)),
    drawn_at INTEGER NOT NULL
) STRICT;
CREATE INDEX pokemon_lottery_draws_time ON pokemon_lottery_draws (drawn_at);

-- ================== POKÉMON : PARC SAFARI ==================

-- Un parc est l'événement public : sa fenêtre d'ouverture et la pause des apparitions qu'il déclenche.
-- Une entrée payante n'en crée pas, elle ouvre directement une visite. `opened_by` : l'administrateur,
-- NULL pour le tirage horaire. `reserved_for` : parc offert à un seul dresseur.
CREATE TABLE pokemon_safari_parks (
    id           INTEGER PRIMARY KEY,
    status       TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    opened_at    INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    opened_by    INTEGER,
    reserved_for INTEGER,
    entries      INTEGER NOT NULL DEFAULT 0 CHECK (entries >= 0),
    closed_at    INTEGER
) STRICT;
-- Jamais deux parcs publics ouverts ; les parcs réservés, à un seul ayant droit, ne se gênent pas.
CREATE UNIQUE INDEX pokemon_safari_parks_open ON pokemon_safari_parks (status)
    WHERE status = 'OPEN' AND reserved_for IS NULL;

-- Visites. La rencontre en cours vit dans la ligne (taux figé, sexe et forme tirés à son arrivée) :
-- les boutons répondent encore après un redémarrage. `generations` : celles que vise le visiteur
-- (« 1,2 »), NULL pour toutes. `shared_at` verrouille le partage du bilan, une fois par visite.
-- `live_author` : la signature du direct, figée à son activation (JSON) ; le message lui-même est dans
-- `public_messages`.
CREATE TABLE pokemon_safari_sessions (
    id                   INTEGER PRIMARY KEY,
    park_id              INTEGER REFERENCES pokemon_safari_parks (id),
    user_id              INTEGER NOT NULL,
    status               TEXT    NOT NULL DEFAULT 'ACTIVE'
                         CHECK (status IN ('ACTIVE', 'FINISHED', 'EXPIRED')),
    generations          TEXT,
    actions_left         INTEGER NOT NULL CHECK (actions_left >= 0),
    entry_cost           INTEGER NOT NULL DEFAULT 0 CHECK (entry_cost >= 0),
    started_at           INTEGER NOT NULL,
    expires_at           INTEGER NOT NULL,
    ended_at             INTEGER,
    balls_thrown         INTEGER NOT NULL DEFAULT 0 CHECK (balls_thrown >= 0),
    baits_used           INTEGER NOT NULL DEFAULT 0 CHECK (baits_used >= 0),
    flees                INTEGER NOT NULL DEFAULT 0 CHECK (flees >= 0),
    catches              INTEGER NOT NULL DEFAULT 0 CHECK (catches >= 0),
    encounter_no         INTEGER NOT NULL DEFAULT 0 CHECK (encounter_no >= 0),
    encounter_species_id INTEGER,
    encounter_is_shiny   INTEGER NOT NULL DEFAULT 0 CHECK (encounter_is_shiny IN (0, 1)),
    encounter_catch_rate INTEGER,
    encounter_bait       INTEGER NOT NULL DEFAULT 0 CHECK (encounter_bait >= 0),
    encounter_sex        TEXT    CHECK (encounter_sex IN ('M', 'F')),
    encounter_form       TEXT,
    shared_at            INTEGER,
    live_author          TEXT    CHECK (json_valid(live_author))
) STRICT;
-- Une visite à la fois par dresseur, et une entrée par dresseur et par parc (une entrée payante, sans
-- parc, échappe à l'index : les visites payantes se succèdent).
CREATE UNIQUE INDEX pokemon_safari_sessions_active ON pokemon_safari_sessions (user_id)
    WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX pokemon_safari_sessions_park ON pokemon_safari_sessions (park_id, user_id)
    WHERE park_id IS NOT NULL;

-- Captures d'une visite : son bilan.
CREATE TABLE pokemon_safari_catches (
    id         INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES pokemon_safari_sessions (id),
    species_id INTEGER NOT NULL,
    is_shiny   INTEGER NOT NULL DEFAULT 0 CHECK (is_shiny IN (0, 1)),
    form       TEXT,
    caught_at  INTEGER NOT NULL
) STRICT;
CREATE INDEX pokemon_safari_catches_session ON pokemon_safari_catches (session_id, id);

-- Les actions d'une visite, pour les dernières lignes du direct. La rencontre notée est celle que
-- l'action visait, même quand un nouveau Pokémon a déjà été tiré derrière.
CREATE TABLE pokemon_safari_events (
    id         INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES pokemon_safari_sessions (id),
    outcome    TEXT    NOT NULL CHECK (outcome IN (
                   'CATCH', 'MISS', 'MISS_FLED', 'FLED', 'FLEE_FAILED', 'BAIT', 'BAIT_FLED')),
    species_id INTEGER NOT NULL,
    is_shiny   INTEGER NOT NULL DEFAULT 0 CHECK (is_shiny IN (0, 1)),
    sex        TEXT    CHECK (sex IN ('M', 'F')),
    form       TEXT,
    played_at  INTEGER NOT NULL
) STRICT;
CREATE INDEX pokemon_safari_events_session ON pokemon_safari_events (session_id, id);

-- ================== POKÉMON : GÉNÉRATIONS ET SAISONS ==================

-- Les générations déjà annoncées : la ligne est la revendication (INSERT OR IGNORE), si bien qu'un
-- redémarrage à l'heure dite n'annonce qu'une fois.
CREATE TABLE pokemon_generations (
    generation   INTEGER PRIMARY KEY,
    announced_at INTEGER NOT NULL
) STRICT;

-- Le starter choisi à l'ouverture d'une génération : un par dresseur et par génération, définitif.
CREATE TABLE pokemon_starters (
    user_id    INTEGER NOT NULL,
    generation INTEGER NOT NULL,
    species_id INTEGER NOT NULL,
    chosen_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, generation)
) STRICT, WITHOUT ROWID;

-- Les paliers de Pokédex déjà récompensés pour un starter (`percent` : le palier de la config). La
-- revendication précède le don, dans la même transaction : jamais donné deux fois, ni perdu.
CREATE TABLE pokemon_starter_rewards (
    user_id    INTEGER NOT NULL,
    generation INTEGER NOT NULL,
    percent    INTEGER NOT NULL CHECK (percent BETWEEN 0 AND 100),
    given_at   INTEGER NOT NULL,
    PRIMARY KEY (user_id, generation, percent),
    FOREIGN KEY (user_id, generation) REFERENCES pokemon_starters (user_id, generation)
) STRICT, WITHOUT ROWID;

-- Les bilans de saison. La ligne, créée à la première tentative, est la revendication ; `claimed_at`
-- est un bail qui expire pour qu'un envoi interrompu soit retenté, `attempts` allonge l'attente.
-- `posted_at` ferme la saison ; `skipped_at` aussi, sans envoi (trop ancienne, ou rien à dire).
-- `payload` : les statistiques calculées (JSON), pour relire un bilan sans le recalculer. Le message
-- publié est dans `public_messages`.
CREATE TABLE pokemon_season_recaps (
    season     INTEGER PRIMARY KEY,
    started_at INTEGER NOT NULL,
    ended_at   INTEGER NOT NULL,
    claimed_at INTEGER,
    attempts   INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    posted_at  INTEGER,
    skipped_at INTEGER,
    payload    TEXT    CHECK (json_valid(payload))
) STRICT;
