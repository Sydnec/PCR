// Une base d'avant le bilan de saison : la colonne `cast_cost` s'ajoute à pokemon_spawns, et les
// trois tables du suivi (bilans, achats de la boutique, journal des tirages) se créent, sans toucher
// à l'historique. Une installation neuve les reçoit par ses CREATE TABLE ; ce sont les bases de
// production, elles, qui passent par ici.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import sqlite3 from "sqlite3";
import { createSandbox, openDatabases, dbAll, dbGet, dbRun, eventually } from "./helpers.js";

const sandbox = createSandbox();

// Les tables telles qu'elles étaient : des apparitions (pêche comprise) sans `cast_cost`, une loterie
// avec ses compteurs cumulés, et aucune des trois nouvelles tables.
await new Promise((resolve, reject) => {
  const legacy = new sqlite3.Database(path.join(sandbox.dir, "points.db"));
  legacy.serialize(() => {
    legacy.run(`CREATE TABLE pokemon_spawns (
      id INTEGER PRIMARY KEY AUTOINCREMENT, species_id INTEGER NOT NULL, is_shiny INTEGER NOT NULL DEFAULT 0,
      catch_rate INTEGER NOT NULL, rarity TEXT, channel_id TEXT, message_id TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE',
      spawned_at INTEGER NOT NULL, throw_count INTEGER NOT NULL DEFAULT 0, caught_by TEXT, caught_at INTEGER,
      caught_ball TEXT, ended_at INTEGER, flees_at INTEGER, held_item TEXT, sex TEXT,
      charm_shiny INTEGER NOT NULL DEFAULT 0, form TEXT, fished INTEGER NOT NULL DEFAULT 0, reserved_for TEXT,
      message_closed_at INTEGER)`);
    legacy.run("INSERT INTO pokemon_spawns (species_id, catch_rate, status, spawned_at, fished, reserved_for) VALUES (129, 255, 'CAUGHT', 1, 1, 'u1')");
    legacy.run("INSERT INTO pokemon_spawns (species_id, catch_rate, status, spawned_at) VALUES (16, 255, 'FLED', 2)");
    legacy.run("CREATE TABLE pokemon_lottery (user_id TEXT PRIMARY KEY, last_day TEXT NOT NULL DEFAULT '', last_draw_at INTEGER NOT NULL DEFAULT 0, draws INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0)");
    legacy.run("INSERT INTO pokemon_lottery (user_id, draws, wins) VALUES ('u1', 12, 5)");
  });
  legacy.close((err) => (err ? reject(err) : resolve()));
});

const { points } = await openDatabases();
const columns = async (table) => (await dbAll(points, `PRAGMA table_info(${table})`)).map((column) => column.name);

describe("le suivi du bilan de saison, sur une base existante", () => {
  it("pokemon_spawns reçoit cast_cost, vide pour l'historique : les pêches d'avant ne coûtent rien au bilan", async () => {
    await eventually(async () => assert.ok((await columns("pokemon_spawns")).includes("cast_cost")));
    assert.deepEqual(await dbAll(points, "SELECT species_id, fished, cast_cost FROM pokemon_spawns ORDER BY id"), [
      { species_id: 129, fished: 1, cast_cost: null },
      { species_id: 16, fished: 0, cast_cost: null },
    ]);
  });

  it("les trois tables sont créées, avec leurs colonnes", async () => {
    await eventually(async () => {
      assert.deepEqual(await columns("pokemon_season_recaps"), ["season", "started_at", "ended_at", "claimed_at", "attempts", "posted_at", "skipped_at", "channel_id", "message_id", "payload"]);
      assert.deepEqual(await columns("pokemon_shop_purchases"), ["id", "user_id", "ball", "quantity", "cost", "bought_at"]);
      assert.deepEqual(await columns("pokemon_lottery_draws"), ["id", "user_id", "won", "drawn_at"]);
    });
  });

  it("les compteurs cumulés de la loterie sont intacts : la saison 1 en dépend", async () => {
    assert.deepEqual(await dbGet(points, "SELECT user_id, draws, wins FROM pokemon_lottery"), { user_id: "u1", draws: 12, wins: 5 });
  });

  it("les nouvelles tables s'écrivent ; une saison n'a qu'une ligne", async () => {
    await dbRun(points, "INSERT INTO pokemon_season_recaps (season, started_at, ended_at) VALUES (1, 0, 10)");
    await assert.rejects(() => dbRun(points, "INSERT INTO pokemon_season_recaps (season, started_at, ended_at) VALUES (1, 0, 10)"), /UNIQUE/);
    await dbRun(points, "INSERT INTO pokemon_shop_purchases (user_id, ball, quantity, cost, bought_at) VALUES ('u1', 'appat', 1, 230, 5)");
    await dbRun(points, "INSERT INTO pokemon_lottery_draws (user_id, drawn_at) VALUES ('u1', 5)");
    assert.equal((await dbGet(points, "SELECT won FROM pokemon_lottery_draws")).won, 0, "un tirage est perdant tant qu'on ne l'a pas marqué gagnant");
  });
});
