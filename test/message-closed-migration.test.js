// Une base d'avant la marque `message_closed_at` : la colonne s'ajoute, et tout
// ce qui était déjà terminé est marqué d'un coup — ses messages ont reçu leur
// fin, ou ne la recevront plus. Sans cela, le rattrapage réécrirait au premier
// démarrage des centaines de vieux messages.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import sqlite3 from "sqlite3";
import { createSandbox, openDatabases, dbAll, eventually } from "./helpers.js";

const sandbox = createSandbox();

// Les tables telles qu'elles étaient, sans la colonne, avec un peu d'historique.
await new Promise((resolve, reject) => {
  const legacy = new sqlite3.Database(path.join(sandbox.dir, "points.db"));
  legacy.serialize(() => {
    legacy.run(`CREATE TABLE pokemon_spawns (
      id INTEGER PRIMARY KEY AUTOINCREMENT, species_id INTEGER NOT NULL, is_shiny INTEGER NOT NULL DEFAULT 0,
      catch_rate INTEGER NOT NULL, rarity TEXT, channel_id TEXT, message_id TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE',
      spawned_at INTEGER NOT NULL, throw_count INTEGER NOT NULL DEFAULT 0, caught_by TEXT, caught_at INTEGER,
      caught_ball TEXT, ended_at INTEGER, flees_at INTEGER, held_item TEXT, sex TEXT,
      charm_shiny INTEGER NOT NULL DEFAULT 0, form TEXT, fished INTEGER NOT NULL DEFAULT 0, reserved_for TEXT)`);
    for (const status of ["CAUGHT", "FLED", "ACTIVE"]) {
      legacy.run("INSERT INTO pokemon_spawns (species_id, catch_rate, status, spawned_at, message_id, channel_id, ended_at) VALUES (16, 255, ?, 1, 'm', 'c', 1)", [status]);
    }
    legacy.run(`CREATE TABLE pokemon_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT, from_user_id TEXT NOT NULL, to_user_id TEXT NOT NULL,
      offer_species_id INTEGER NOT NULL, offer_is_shiny INTEGER NOT NULL DEFAULT 0, request_species_id INTEGER NOT NULL,
      request_is_shiny INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'PENDING', created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, resolved_at INTEGER, channel_id TEXT, message_id TEXT, offer_sex TEXT,
      offer_fertile INTEGER, request_sex TEXT, request_fertile INTEGER, offer_pokemon_id INTEGER,
      request_pokemon_id INTEGER, offer_form TEXT, request_form TEXT, offer_points INTEGER, request_points INTEGER,
      offer_item TEXT, offer_item_qty INTEGER, request_item TEXT, request_item_qty INTEGER)`);
    for (const status of ["ACCEPTED", "CANCELLED", "PENDING"]) {
      legacy.run("INSERT INTO pokemon_trades (from_user_id, to_user_id, offer_species_id, request_species_id, status, created_at, expires_at, message_id, channel_id) VALUES ('a', 'b', 0, 0, ?, 1, 9999999999999, 't', 'c')", [status]);
    }
  });
  legacy.close((err) => (err ? reject(err) : resolve()));
});

const { points } = await openDatabases();

describe("la marque des messages conclus, sur une base existante", () => {
  it("marque l'historique terminé, et lui seul", async () => {
    await eventually(async () => {
      const spawns = await dbAll(points, "SELECT status, message_closed_at FROM pokemon_spawns ORDER BY id");
      assert.deepEqual(spawns.map((row) => [row.status, row.message_closed_at !== null]), [["CAUGHT", true], ["FLED", true], ["ACTIVE", false]]);
    });
    await eventually(async () => {
      const trades = await dbAll(points, "SELECT status, message_closed_at FROM pokemon_trades ORDER BY id");
      assert.deepEqual(trades.map((row) => [row.status, row.message_closed_at !== null]), [["ACCEPTED", true], ["CANCELLED", true], ["PENDING", false]]);
    });
  });
});
