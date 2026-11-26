-- Schéma v1 gelé : botdata-<ANNÉE>.db tel que le crée le code v1 (main @ 97c987a, v1.22.1), extrait d'une base
-- neuve produite par ce code. C'est l'empreinte que `pcr migrate-v1` exige d'une base à convertir, et le
-- schéma de la fixture de test. Ne pas retoucher à la main : un écart avec la prod doit faire refuser
-- la conversion, pas s'adapter en silence. Les déclencheurs de `points_log` sont omis : ils dateraient
-- la fixture avec l'horloge réelle.

CREATE TABLE bet_stats (user_id TEXT PRIMARY KEY, total_wagered INTEGER DEFAULT 0, max_win INTEGER DEFAULT 0);

CREATE TABLE command_stats (command TEXT PRIMARY KEY, count INTEGER DEFAULT 0);

CREATE TABLE emoji_stats (user_id TEXT, emoji TEXT, count INTEGER DEFAULT 0, PRIMARY KEY(user_id, emoji));

CREATE TABLE message_reactions (message_id TEXT PRIMARY KEY, count INTEGER DEFAULT 0);

CREATE TABLE message_stats (user_id TEXT, channel_id TEXT, date TEXT, count INTEGER DEFAULT 0, PRIMARY KEY(user_id, channel_id, date));

CREATE TABLE messages (id TEXT PRIMARY KEY, link TEXT, expire_at INTEGER);

CREATE TABLE pokemon_ball_stats (
  user_id TEXT,
  ball TEXT,
  count INTEGER DEFAULT 0,
  cost INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, ball)
);

CREATE TABLE pokemon_daily_stats (
  date TEXT PRIMARY KEY,
  spawns INTEGER DEFAULT 0,
  throws INTEGER DEFAULT 0,
  catches INTEGER DEFAULT 0,
  points_burned INTEGER DEFAULT 0
);

CREATE TABLE pokemon_highlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  user_id TEXT,
  species_id INTEGER,
  is_shiny INTEGER DEFAULT 0,
  value INTEGER,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE pokemon_species_stats (
  species_id INTEGER PRIMARY KEY,
  spawns INTEGER DEFAULT 0,
  catches INTEGER DEFAULT 0,
  escapes INTEGER DEFAULT 0,
  shiny_spawns INTEGER DEFAULT 0,
  shiny_catches INTEGER DEFAULT 0,
  throws_received INTEGER DEFAULT 0,
  points_burned INTEGER DEFAULT 0,
  max_throws_single_spawn INTEGER DEFAULT 0
);

CREATE TABLE pokemon_stats (
  user_id TEXT PRIMARY KEY,
  throws INTEGER DEFAULT 0,
  catches INTEGER DEFAULT 0,
  points_spent INTEGER DEFAULT 0,
  points_burned INTEGER DEFAULT 0,
  expected_catches REAL DEFAULT 0,
  shiny_catches INTEGER DEFAULT 0,
  legendary_catches INTEGER DEFAULT 0,
  best_catch_probability REAL,
  best_catch_species INTEGER,
  fastest_catch_ms INTEGER,
  most_throws_on_one_spawn INTEGER DEFAULT 0,
  fusions INTEGER DEFAULT 0,
  duplicates_spent INTEGER DEFAULT 0,
  fusion_points INTEGER DEFAULT 0,
  trades INTEGER DEFAULT 0,
  safari_sessions INTEGER DEFAULT 0,
  safari_catches INTEGER DEFAULT 0,
  safari_points_spent INTEGER DEFAULT 0
);

CREATE TABLE progress (id TEXT PRIMARY KEY, last_processed_timestamp INTEGER);

CREATE TABLE randomizabaise_stats (message_id TEXT PRIMARY KEY, user_a TEXT, user_b TEXT, user_c TEXT, reaction_count INTEGER DEFAULT 0, is_shiny INTEGER DEFAULT 0);

CREATE TABLE reaction_stats (user_id TEXT, count INTEGER DEFAULT 0, PRIMARY KEY(user_id));

CREATE TABLE reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message TEXT NOT NULL,
  trigger_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  sent BOOLEAN DEFAULT 0,
  sent_at INTEGER
);

CREATE TABLE voice_time (user_id TEXT PRIMARY KEY, total_time_ms INTEGER DEFAULT 0, longest_session INTEGER DEFAULT 0, join_time INTEGER);

CREATE TABLE word_stats (user_id TEXT, word TEXT, count INTEGER DEFAULT 0, PRIMARY KEY(user_id, word));

CREATE INDEX idx_pokemon_highlights_type ON pokemon_highlights(type, created_at);
