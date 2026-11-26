-- Fixture synthétique de points.db (schéma v1 gelé) : un peu de tout, et chaque cas limite que la
-- conversion doit écarter ou corriger. Membres : A = 111…, B = 222…, C = 333… ; « __bad » n'est pas un
-- identifiant Discord. Salon 900…1, messages 800…n.

INSERT INTO points (user_id, balance, last_message_at, messages_today_count, last_reset_date) VALUES
  ('111111111111111111', 5000, 1764000000000, 3, '2026-11-25'),
  ('222222222222222222', -200, 0, 0, ''),
  ('__bad', 50, 0, 0, NULL);

INSERT INTO points_log (id, user_id, delta, balance, created_at) VALUES
  (1, '111111111111111111', 5000, 5000, 1763000000000),
  (2, '222222222222222222', -200, -200, 1763000000001),
  (3, '__bad', 50, 50, 1763000000002);

-- Les lignes uniques sont posées par le code v1 au démarrage, pas par sa DDL.
INSERT INTO economy_state (id, next_redistribution_at, redistribution_since)
  VALUES (1, 1764100000000, 1763999000000);

INSERT INTO points_redistributions
  (id, ran_at, triggered_by, rate, participants, contributors, pot, share, failures) VALUES
  (1, 1763500000000, 'auto', 5, 10, 8, 1000, 100, 0),
  (2, 1763600000000, '111111111111111111', 5, 10, 8, 900, 90, 2);

INSERT INTO bets (id, creator_id, title, status, winning_option_index, is_estimation) VALUES
  (1, '111111111111111111', 'Il pleuvra ?', 'CLOSED', 2, 0),
  (2, '222222222222222222', 'Combien de Zarbi ?', 'CLOSED', 42, 1),
  (3, '111111111111111111', 'Rouge ou bleu ?', 'OPEN', NULL, 0);

INSERT INTO bet_options (id, bet_id, option_index, label) VALUES
  (1, 1, 1, 'Oui'), (2, 1, 2, 'Non'), (3, 3, 1, 'Rouge'), (4, 3, 2, 'Bleu'), (5, 3, 2, 'Bleu bis');

INSERT INTO bet_participations (bet_id, user_id, option_index, amount, prediction_value) VALUES
  (1, '111111111111111111', 2, 100, NULL),
  (1, '222222222222222222', 1, 50, NULL),
  (2, '111111111111111111', 0, 30, 40),
  (3, '222222222222222222', 2, 70, NULL),
  (3, '333333333333333333', 9, 10, NULL);

INSERT INTO birthdays (user_id, day, month, year, last_wished_year) VALUES
  ('111111111111111111', 14, 7, 1990, 2026),
  ('222222222222222222', 5, 3, NULL, NULL);

INSERT INTO pokemon_state (id, message_count, last_spawn_at, spawning, total_spawns, spawn_paused_until)
  VALUES (1, 12, 1764000000000, 1, 345, 0);

INSERT INTO pokemon_spawns
  (id, species_id, is_shiny, catch_rate, rarity, channel_id, message_id, status, spawned_at, throw_count,
   caught_by, caught_at, caught_ball, ended_at, flees_at, held_item, sex, charm_shiny, form, fished,
   reserved_for, message_closed_at, cast_cost) VALUES
  (1, 25, 0, 190, 'COMMUN', '900000000000000001', '800000000000000001', 'CAUGHT', 1763000000000, 3,
   '111111111111111111', 1763000100000, 'super', 1763000100000, 1763003600000, 'pepite', 'M', 0, NULL, 0,
   NULL, 1763000100500, NULL),
  (2, 16, 0, 255, 'COMMUN', '900000000000000001', '800000000000000002', 'FLED', 1763100000000, 0,
   NULL, NULL, NULL, 1763103600000, 1763103600000, NULL, 'F', 0, NULL, 0, NULL, NULL, NULL),
  (3, 201, 1, 45, 'RARE', '900000000000000001', '800000000000000003', 'ACTIVE', 1764000000000, 0,
   NULL, NULL, NULL, NULL, 1764003600000, NULL, NULL, 1, 'A', 0, NULL, NULL, NULL),
  (4, 129, 0, 255, 'COMMUN', NULL, NULL, 'FISHING', 1764000500000, 0,
   NULL, NULL, NULL, NULL, 1764000560000, NULL, 'M', 0, NULL, 1, '222222222222222222', NULL, 200);

INSERT INTO pokemon_throws (id, spawn_id, user_id, ball, cost, probability, result, thrown_at) VALUES
  (1, 1, '111111111111111111', 'poke', 10, 0.3, 'MISS', 1763000050000),
  (2, 1, '111111111111111111', 'super', 20, 0.5, 'CATCH', 1763000100000),
  (3, 99, '111111111111111111', 'poke', 10, 0.3, 'MISS', 1763000060000),
  (4, 1, '222222222222222222', 'poke', 0, 0.3, 'VOID', 1763000070000);

INSERT INTO pokemon_drops
  (id, spawn_id, item_key, species_id, status, channel_id, message_id, dropped_at, claimed_by, claimed_at,
   message_closed_at) VALUES
  (1, 1, 'pepite', 25, 'CLAIMED', '900000000000000001', '800000000000000010', 1763000100000,
   '222222222222222222', 1763000200000, 1763000200500),
  (2, 77, 'super_bonbon', NULL, 'OPEN', '900000000000000001', '800000000000000011', 1764000000000,
   NULL, NULL, NULL);

INSERT INTO pokemon_owned
  (id, user_id, species_id, is_shiny, sex, ball, origin, sterile, obtained_at, pc_pos, nickname, locked,
   form, showcase_pos) VALUES
  (1, '111111111111111111', 25, 0, 'M', 'poke', 'capture', 0, 1763000100000, 0, 'Pika', 0, NULL, 1),
  (2, '111111111111111111', 25, 1, 'F', 'super', 'capture', 0, 1763000200000, -3, NULL, 1, NULL, NULL),
  (3, '222222222222222222', 132, 0, NULL, NULL, 'oeuf', 1, 1763000300000, NULL, '', 0, NULL, NULL),
  (4, '333333333333333333', 201, 0, NULL, 'safari', 'safari', 0, 1763000400000, NULL, NULL, 0, 'A', NULL);

INSERT INTO pokemon_pc_boxes (user_id, box, name, archived) VALUES
  ('111111111111111111', 0, 'Favoris', 0),
  ('111111111111111111', 1, '', 1);

INSERT INTO pokemon_showcase_shares (user_id, shared_at) VALUES ('111111111111111111', 1763500000000);

INSERT INTO pokemon_fusions
  (id, user_id, from_species_id, to_species_id, is_shiny, duplicates_spent, points_spent, created_at)
  VALUES (1, '111111111111111111', 1, 2, 0, 3, 500, 1763400000000);

INSERT INTO pokemon_sales (id, user_id, species_id, is_shiny, quantity, points, sold_at)
  VALUES (1, '222222222222222222', 16, 0, 2, 40, 1763450000000);

INSERT INTO pokemon_eggs
  (id, user_id, species_id, father_id, mother_id, father_species_id, mother_species_id, status, messages,
   hatch_messages, laid_at, hatch_at, hatched_at, pokemon_id, shiny_parents) VALUES
  (1, '111111111111111111', 172, 1, 2, 25, 25, 'INCUBATING', 10, 50, 1764000000000, 1764086400000,
   NULL, NULL, 1),
  (2, '222222222222222222', 132, NULL, NULL, 132, 132, 'HATCHED', 50, 50, 1762000000000, 1762086400000,
   1762090000000, 3, 0);

-- 1 : offre classique en attente. 2 : offre ouverte à tous (destinataire '', espèce 0, points,
-- « à son choix »). 3 : contrée par 4 (objet sans quantité). 5 : acceptée, contre-offre d'une offre
-- absente, fin jamais écrite sur son message.
INSERT INTO pokemon_trades
  (id, from_user_id, to_user_id, offer_species_id, offer_is_shiny, request_species_id, request_is_shiny,
   status, created_at, expires_at, resolved_at, channel_id, message_id, offer_sex, offer_fertile,
   request_sex, request_fertile, offer_pokemon_id, request_pokemon_id, offer_form, request_form,
   offer_points, request_points, offer_item, offer_item_qty, request_item, request_item_qty,
   message_closed_at, counter_of, request_open, open_offer) VALUES
  (1, '111111111111111111', '222222222222222222', 25, 0, 132, 0, 'PENDING', 1764000000000, 1764172800000,
   NULL, '900000000000000001', '800000000000000020', 'M', 1, NULL, NULL, 1, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0),
  (2, '111111111111111111', '', 0, 0, 0, 0, 'PENDING', 1764000000000, 1764172800000,
   NULL, '900000000000000001', '800000000000000021', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
   500, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1),
  (3, '222222222222222222', '111111111111111111', 0, 0, 25, 0, 'COUNTERED', 1763900000000, 1764072800000,
   1763950000000, '900000000000000001', '800000000000000022', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, 'pepite', NULL, NULL, NULL, 1763950000500, NULL, 0, 0),
  (4, '111111111111111111', '222222222222222222', 25, 0, 0, 0, 'PENDING', 1763950000000, 1764122800000,
   NULL, '900000000000000001', '800000000000000023', NULL, NULL, NULL, NULL, 1, NULL, NULL, NULL,
   NULL, 0, NULL, NULL, NULL, NULL, NULL, 3, 0, 0),
  (5, '333333333333333333', '111111111111111111', 201, 0, 25, 0, 'ACCEPTED', 1763800000000, 1763972800000,
   1763850000000, '900000000000000001', '800000000000000024', NULL, NULL, NULL, NULL, 4, 1, 'A', NULL,
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, 99, 0, 0);

INSERT INTO pokemon_trade_drafts
  (id, from_user_id, to_user_id, channel_id, offer, request, created_at, expires_at, counter_of) VALUES
  (1, '111111111111111111', '', '900000000000000001', '{"kind":"pk","id":"25"}', NULL,
   1764000000000, 1764000900000, NULL);

INSERT INTO pokemon_inventory (user_id, item_key, count, first_obtained_at, last_obtained_at) VALUES
  ('111111111111111111', 'pepite', 2, 1763000200000, 1763000200000),
  ('222222222222222222', 'ticket_safari', 0, 1762000000000, 1762000000000),
  ('333333333333333333', 'evolyte', -1, 1762000000000, 1762000000000);

INSERT INTO pokemon_item_log (id, user_id, item_key, delta, source, created_at) VALUES
  (1, '111111111111111111', 'pepite', 2, 'drop', 1763000200000),
  (2, '222222222222222222', 'ticket_safari', 0, 'bug', 1762000000000);

INSERT INTO pokemon_lottery (user_id, last_day, last_draw_at, draws, wins) VALUES
  ('111111111111111111', '2026-11-25', 1764000000000, 10, 3),
  ('222222222222222222', '', 0, 0, 0),
  ('333333333333333333', '2026-11-20', 1763600000000, 2, 3);

INSERT INTO pokemon_lottery_draws (id, user_id, won, drawn_at)
  VALUES (1, '111111111111111111', 1, 1764000000000);

INSERT INTO pokemon_safari_parks
  (id, status, opened_at, expires_at, opened_by, reserved_for, channel_id, message_id, entries, closed_at,
   message_closed_at) VALUES
  (1, 'CLOSED', 1763700000000, 1763710800000, NULL, NULL, '900000000000000001', '800000000000000030', 2,
   1763710800000, 1763710800500);

INSERT INTO pokemon_safari_sessions
  (id, park_id, user_id, status, actions_left, entry_cost, started_at, expires_at, ended_at, balls_thrown,
   baits_used, flees, catches, encounter_no, encounter_species_id, encounter_is_shiny,
   encounter_catch_rate, encounter_bait, encounter_sex, shared_at, generations, encounter_form,
   live_channel_id, live_message_id, live_author, live_closed_at) VALUES
  (1, 1, '111111111111111111', 'FINISHED', 0, 0, 1763700100000, 1763701900000, 1763701000000, 20, 3, 2,
   1, 25, NULL, 0, NULL, 0, NULL, NULL, NULL, NULL, '900000000000000001', '800000000000000031',
   '{"name":"A"}', NULL),
  (2, NULL, '222222222222222222', 'ACTIVE', 12, 1500, 1764000000000, 1764001800000, NULL, 10, 1, 1, 0, 13,
   111, 0, 120, 1, 'F', NULL, '1,2', NULL, NULL, NULL, NULL, NULL);

INSERT INTO pokemon_safari_catches (id, session_id, species_id, is_shiny, caught_at, form) VALUES
  (1, 1, 16, 0, 1763700500000, NULL),
  (2, 42, 16, 0, 1763700600000, NULL);

INSERT INTO pokemon_safari_events (id, session_id, outcome, species_id, is_shiny, sex, form, played_at)
  VALUES (1, 1, 'CATCH', 16, 0, 'M', NULL, 1763700500000);

INSERT INTO pokemon_generations (generation, announced_at) VALUES (2, 1762000000000);

INSERT INTO pokemon_starters (user_id, generation, species_id, chosen_at)
  VALUES ('111111111111111111', 2, 152, 1762000100000);

INSERT INTO pokemon_starter_rewards (user_id, generation, percent, given_at) VALUES
  ('111111111111111111', 2, 33, 1763000000000),
  ('222222222222222222', 2, 33, 1763000000000);

INSERT INTO pokemon_ball_units (id, user_id, ball, bought_at)
  VALUES (1, '111111111111111111', 'appat', 1764000000000);

INSERT INTO pokemon_shop_daily (user_id, ball, day, bought)
  VALUES ('111111111111111111', 'appat', '2026-11-25', 1);

INSERT INTO pokemon_shop_purchases (id, user_id, ball, quantity, cost, bought_at)
  VALUES (1, '111111111111111111', 'appat', 1, 300, 1764000000000);

INSERT INTO pokemon_season_recaps
  (season, started_at, ended_at, claimed_at, attempts, posted_at, skipped_at, channel_id, message_id,
   payload) VALUES
  (1, 1755000000000, 1762000000000, 1762000100000, 1, 1762000200000, NULL, '900000000000000001',
   '800000000000000040', '{"top":[]}');

INSERT INTO pokemon_data_migrations (name, done_at) VALUES ('individuals', 1760000000000);
