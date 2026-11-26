-- Fixture synthétique de botdata-<ANNÉE>.db (schéma v1 gelé). Les lignes « __global__ » portent les
-- totaux du serveur, comme en v1 ; l'emoji NULL vient d'une réaction à un emoji serveur supprimé.

INSERT INTO message_stats (user_id, channel_id, date, count) VALUES
  ('111111111111111111', '900000000000000001', '2026-11-25', 10),
  ('222222222222222222', '900000000000000001', '2026-11-25', 5),
  ('__global__', '__global__', '2026-11-25', 15);

INSERT INTO word_stats (user_id, word, count) VALUES ('111111111111111111', 'pokemon', 4);

INSERT INTO emoji_stats (user_id, emoji, count) VALUES
  ('111111111111111111', '🔥', 2),
  ('111111111111111111', NULL, 1),
  ('__global__', '🔥', 2);

INSERT INTO reaction_stats (user_id, count) VALUES ('111111111111111111', 3), ('__global__', 3);

INSERT INTO message_reactions (message_id, count) VALUES ('800000000000000001', 3);

INSERT INTO command_stats (command, count) VALUES ('pk loterie', 7);

INSERT INTO bet_stats (user_id, total_wagered, max_win) VALUES ('111111111111111111', 130, 150);

INSERT INTO voice_time (user_id, total_time_ms, longest_session, join_time)
  VALUES ('111111111111111111', 3600000, 1200000, 1764000000000);

INSERT INTO randomizabaise_stats (message_id, user_a, user_b, user_c, reaction_count, is_shiny)
  VALUES ('800000000000000099', '111111111111111111', '222222222222222222', NULL, 2, 0);

INSERT INTO pokemon_stats
  (user_id, throws, catches, points_spent, points_burned, expected_catches, shiny_catches,
   legendary_catches, best_catch_probability, best_catch_species, fastest_catch_ms,
   most_throws_on_one_spawn, fusions, duplicates_spent, fusion_points, trades, safari_sessions,
   safari_catches, safari_points_spent) VALUES
  ('111111111111111111', 2, 1, 30, 10, 0.8, 0, 0, 0.5, 25, 100000, 2, 1, 3, 500, 1, 1, 1, 0),
  ('__global__', 2, 1, 30, 10, 0.8, 0, 0, 0.5, 25, 100000, 2, 1, 3, 500, 1, 1, 1, 0);

INSERT INTO pokemon_ball_stats (user_id, ball, count, cost) VALUES
  ('111111111111111111', 'poke', 1, 10), ('__global__', 'poke', 1, 10);

INSERT INTO pokemon_species_stats
  (species_id, spawns, catches, escapes, shiny_spawns, shiny_catches, throws_received, points_burned,
   max_throws_single_spawn) VALUES (25, 1, 1, 0, 0, 0, 3, 10, 3);

INSERT INTO pokemon_highlights (id, type, user_id, species_id, is_shiny, value, detail, created_at)
  VALUES (1, 'SHINY', '111111111111111111', 25, 1, NULL, NULL, 1763000100000);

INSERT INTO pokemon_daily_stats (date, spawns, throws, catches, points_burned)
  VALUES ('2026-11-25', 4, 3, 1, 10);

INSERT INTO reminders (id, user_id, guild_id, channel_id, message, trigger_at, created_at, sent, sent_at)
  VALUES
  (1, '111111111111111111', '700000000000000001', '900000000000000001', 'Pense au safari',
   1764100000000, 1764000000000, 0, NULL),
  (2, '222222222222222222', '700000000000000001', '900000000000000001', 'Parti sans date',
   1763000000000, 1762000000000, 1, NULL),
  (3, '__bad', '700000000000000001', '900000000000000001', 'Perdu', 1764100000000, 1764000000000, 0, NULL);

INSERT INTO messages (id, link, expire_at) VALUES ('m1', 'https://discord.com/x', 1764000000000);
INSERT INTO progress (id, last_processed_timestamp) VALUES ('history', 1760000000000);
