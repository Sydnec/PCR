-- Schéma v1 gelé : points.db tel que le crée le code v1 (main @ 97c987a, v1.22.1), extrait d'une base
-- neuve produite par ce code. C'est l'empreinte que `pcr migrate-v1` exige d'une base à convertir, et le
-- schéma de la fixture de test. Ne pas retoucher à la main : un écart avec la prod doit faire refuser
-- la conversion, pas s'adapter en silence. Les déclencheurs de `points_log` sont omis : ils dateraient
-- la fixture avec l'horloge réelle.

CREATE TABLE bet_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bet_id INTEGER,
  option_index INTEGER,
  label TEXT,
  FOREIGN KEY(bet_id) REFERENCES bets(id)
);

CREATE TABLE bet_participations (
  bet_id INTEGER,
  user_id TEXT,
  option_index INTEGER,
  amount INTEGER,
  prediction_value INTEGER,
  PRIMARY KEY(bet_id, user_id),
  FOREIGN KEY(bet_id) REFERENCES bets(id)
);

CREATE TABLE bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id TEXT,
  title TEXT,
  status TEXT DEFAULT 'OPEN',
  winning_option_index INTEGER,
  is_estimation INTEGER DEFAULT 0
);

CREATE TABLE birthdays (
  user_id TEXT PRIMARY KEY,
  day INTEGER NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER,
  last_wished_year INTEGER
);

CREATE TABLE economy_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_redistribution_at INTEGER NOT NULL DEFAULT 0,
  redistribution_since INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE points (
  user_id TEXT PRIMARY KEY,
  balance INTEGER DEFAULT 0,
  last_message_at INTEGER DEFAULT 0,
  messages_today_count INTEGER DEFAULT 0,
  last_reset_date TEXT
);

CREATE TABLE points_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  balance INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE points_redistributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at INTEGER NOT NULL,
  triggered_by TEXT,
  rate REAL NOT NULL,
  participants INTEGER NOT NULL,
  contributors INTEGER NOT NULL,
  pot INTEGER NOT NULL,
  share INTEGER NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE pokemon_ball_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  ball TEXT NOT NULL,
  bought_at INTEGER NOT NULL
);

CREATE TABLE pokemon_data_migrations (
  name TEXT PRIMARY KEY,
  done_at INTEGER NOT NULL
);

CREATE TABLE pokemon_drops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spawn_id INTEGER,
  item_key TEXT NOT NULL,
  species_id INTEGER,
  status TEXT NOT NULL DEFAULT 'OPEN',
  channel_id TEXT,
  message_id TEXT,
  dropped_at INTEGER NOT NULL,
  claimed_by TEXT,
  claimed_at INTEGER,
  message_closed_at INTEGER
);

CREATE TABLE pokemon_eggs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  species_id INTEGER NOT NULL,
  father_id INTEGER,
  mother_id INTEGER,
  father_species_id INTEGER NOT NULL,
  mother_species_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'INCUBATING',
  messages INTEGER NOT NULL DEFAULT 0,
  hatch_messages INTEGER NOT NULL,
  laid_at INTEGER NOT NULL,
  hatch_at INTEGER NOT NULL,
  hatched_at INTEGER,
  pokemon_id INTEGER,
  shiny_parents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE pokemon_fusions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  from_species_id INTEGER NOT NULL,
  to_species_id INTEGER NOT NULL,
  is_shiny INTEGER NOT NULL DEFAULT 0,
  duplicates_spent INTEGER NOT NULL,
  points_spent INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE pokemon_generations (
  generation INTEGER PRIMARY KEY,
  announced_at INTEGER NOT NULL
);

CREATE TABLE pokemon_inventory (
  user_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  first_obtained_at INTEGER,
  last_obtained_at INTEGER,
  PRIMARY KEY (user_id, item_key)
);

CREATE TABLE pokemon_item_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  delta INTEGER NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE pokemon_lottery (
  user_id TEXT PRIMARY KEY,
  last_day TEXT NOT NULL DEFAULT '',
  last_draw_at INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE pokemon_lottery_draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  won INTEGER NOT NULL DEFAULT 0,
  drawn_at INTEGER NOT NULL
);

CREATE TABLE pokemon_owned (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  species_id INTEGER NOT NULL,
  is_shiny INTEGER NOT NULL DEFAULT 0,
  sex TEXT CHECK (sex IN ('M', 'F')),
  ball TEXT,
  origin TEXT NOT NULL,
  sterile INTEGER NOT NULL DEFAULT 0,
  obtained_at INTEGER NOT NULL,
  pc_pos INTEGER,
  nickname TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  form TEXT,
  showcase_pos INTEGER
);

CREATE TABLE pokemon_pc_boxes (
  user_id TEXT NOT NULL,
  box INTEGER NOT NULL,
  name TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, box)
);

CREATE TABLE pokemon_safari_catches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  species_id INTEGER NOT NULL,
  is_shiny INTEGER NOT NULL DEFAULT 0,
  caught_at INTEGER NOT NULL,
  form TEXT
);

CREATE TABLE pokemon_safari_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  species_id INTEGER NOT NULL,
  is_shiny INTEGER NOT NULL DEFAULT 0,
  sex TEXT,
  form TEXT,
  played_at INTEGER NOT NULL
);

CREATE TABLE pokemon_safari_parks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  opened_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  opened_by TEXT,
  reserved_for TEXT,
  channel_id TEXT,
  message_id TEXT,
  entries INTEGER NOT NULL DEFAULT 0,
  closed_at INTEGER,
  message_closed_at INTEGER
);

CREATE TABLE pokemon_safari_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  park_id INTEGER,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  actions_left INTEGER NOT NULL,
  entry_cost INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ended_at INTEGER,
  balls_thrown INTEGER NOT NULL DEFAULT 0,
  baits_used INTEGER NOT NULL DEFAULT 0,
  flees INTEGER NOT NULL DEFAULT 0,
  catches INTEGER NOT NULL DEFAULT 0,
  encounter_no INTEGER NOT NULL DEFAULT 0,
  encounter_species_id INTEGER,
  encounter_is_shiny INTEGER NOT NULL DEFAULT 0,
  encounter_catch_rate INTEGER,
  encounter_bait INTEGER NOT NULL DEFAULT 0,
  encounter_sex TEXT,
  shared_at INTEGER,
  generations TEXT,
  encounter_form TEXT,
  live_channel_id TEXT,
  live_message_id TEXT,
  live_author TEXT,
  live_closed_at INTEGER
);

CREATE TABLE pokemon_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  species_id INTEGER NOT NULL,
  is_shiny INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL,
  points INTEGER NOT NULL,
  sold_at INTEGER NOT NULL
);

CREATE TABLE pokemon_season_recaps (
  season INTEGER PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  claimed_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  posted_at INTEGER,
  skipped_at INTEGER,
  channel_id TEXT,
  message_id TEXT,
  payload TEXT
);

CREATE TABLE pokemon_shop_daily (
  user_id TEXT NOT NULL,
  ball TEXT NOT NULL,
  day TEXT NOT NULL,
  bought INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, ball, day)
);

CREATE TABLE pokemon_shop_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  ball TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  cost INTEGER NOT NULL,
  bought_at INTEGER NOT NULL
);

CREATE TABLE pokemon_showcase_shares (
  user_id TEXT PRIMARY KEY,
  shared_at INTEGER NOT NULL
);

CREATE TABLE pokemon_spawns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  species_id INTEGER NOT NULL,
  is_shiny INTEGER NOT NULL DEFAULT 0,
  catch_rate INTEGER NOT NULL,
  rarity TEXT,
  channel_id TEXT,
  message_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  spawned_at INTEGER NOT NULL,
  throw_count INTEGER NOT NULL DEFAULT 0,
  caught_by TEXT,
  caught_at INTEGER,
  caught_ball TEXT,
  ended_at INTEGER,
  flees_at INTEGER,
  held_item TEXT,
  sex TEXT,
  charm_shiny INTEGER NOT NULL DEFAULT 0,
  form TEXT,
  fished INTEGER NOT NULL DEFAULT 0,
  reserved_for TEXT,
  message_closed_at INTEGER,
  cast_cost INTEGER
);

CREATE TABLE pokemon_starter_rewards (
  user_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  percent INTEGER NOT NULL,
  given_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, generation, percent)
);

CREATE TABLE pokemon_starters (
  user_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  species_id INTEGER NOT NULL,
  chosen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, generation)
);

CREATE TABLE pokemon_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  message_count INTEGER NOT NULL DEFAULT 0,
  last_spawn_at INTEGER NOT NULL DEFAULT 0,
  spawning INTEGER NOT NULL DEFAULT 0,
  total_spawns INTEGER NOT NULL DEFAULT 0,
  spawn_paused_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE pokemon_throws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spawn_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  ball TEXT NOT NULL,
  cost INTEGER NOT NULL,
  probability REAL,
  result TEXT NOT NULL,
  thrown_at INTEGER NOT NULL
);

CREATE TABLE pokemon_trade_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  channel_id TEXT,
  offer TEXT,
  request TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
  , counter_of INTEGER);

CREATE TABLE pokemon_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  offer_species_id INTEGER NOT NULL,
  offer_is_shiny INTEGER NOT NULL DEFAULT 0,
  request_species_id INTEGER NOT NULL,
  request_is_shiny INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  resolved_at INTEGER,
  channel_id TEXT,
  message_id TEXT,
  offer_sex TEXT,
  offer_fertile INTEGER,
  request_sex TEXT,
  request_fertile INTEGER,
  offer_pokemon_id INTEGER,
  request_pokemon_id INTEGER,
  offer_form TEXT,
  request_form TEXT,
  offer_points INTEGER,
  request_points INTEGER,
  offer_item TEXT,
  offer_item_qty INTEGER,
  request_item TEXT,
  request_item_qty INTEGER,
  message_closed_at INTEGER
  , counter_of INTEGER, request_open INTEGER NOT NULL DEFAULT 0, open_offer INTEGER NOT NULL DEFAULT 0);

CREATE INDEX idx_ball_units_user ON pokemon_ball_units(user_id, ball, bought_at);

CREATE INDEX idx_points_log_time ON points_log(created_at);

CREATE INDEX idx_points_log_user ON points_log(user_id, created_at);

CREATE INDEX idx_pokemon_drops_open ON pokemon_drops(status, id);

CREATE UNIQUE INDEX idx_pokemon_eggs_incubating
  ON pokemon_eggs(user_id) WHERE status = 'INCUBATING';

CREATE INDEX idx_pokemon_inventory_user ON pokemon_inventory(user_id);

CREATE INDEX idx_pokemon_item_log_user
  ON pokemon_item_log(user_id, id);

CREATE INDEX idx_pokemon_lottery_draws_time ON pokemon_lottery_draws(drawn_at);

CREATE INDEX idx_pokemon_owned_entry
  ON pokemon_owned(user_id, species_id, is_shiny);

CREATE INDEX idx_pokemon_owned_species ON pokemon_owned(species_id);

CREATE INDEX idx_pokemon_safari_catches_session
  ON pokemon_safari_catches(session_id, id);

CREATE INDEX idx_pokemon_safari_events_session
  ON pokemon_safari_events(session_id, id);

CREATE UNIQUE INDEX idx_pokemon_safari_park_open
  ON pokemon_safari_parks(status) WHERE status = 'OPEN' AND reserved_for IS NULL;

CREATE UNIQUE INDEX idx_pokemon_safari_session_active
  ON pokemon_safari_sessions(user_id) WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX idx_pokemon_safari_session_park
  ON pokemon_safari_sessions(park_id, user_id) WHERE park_id IS NOT NULL;

CREATE INDEX idx_pokemon_sales_user ON pokemon_sales(user_id, id);

CREATE INDEX idx_pokemon_shop_purchases_time ON pokemon_shop_purchases(bought_at);

CREATE UNIQUE INDEX idx_pokemon_spawn_active
  ON pokemon_spawns(status) WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX idx_pokemon_spawn_fishing
  ON pokemon_spawns(reserved_for) WHERE status = 'FISHING';

CREATE INDEX idx_pokemon_spawns_flees ON pokemon_spawns(status, flees_at);

CREATE INDEX idx_pokemon_throws_spawn ON pokemon_throws(spawn_id, id);

CREATE INDEX idx_pokemon_throws_user_ball ON pokemon_throws(user_id, ball);
