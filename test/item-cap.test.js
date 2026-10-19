// La limite de détention d'un objet (`maxHeld`, la Master Ball) : au-delà, chaque
// exemplaire gagné se vend d'office `overflowValue` points. Les compensations et
// l'administrateur passent outre ; l'échange la vérifie et refuse. Ce que les
// dresseurs gardaient déjà au-delà se vend une fois, au démarrage.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbAll, dbGet } from "./helpers.js";

createSandbox({ config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } } });
const { points } = await openDatabases();
const items = await import("../modules/pokemon/items.js");
const economy = await import("../modules/economy.js");
const collection = await import("../modules/pokemon/collection.js");
const { checkSide } = await import("../modules/pokemon/trade-side.js");
const { buildLotteryEmbed } = await import("../modules/pokemon/embeds.js");

const MASTER = "ball_master";
const call = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value))));
const grant = (user, quantity = 1, options = {}) =>
  call(items.grantItem, user, MASTER, quantity, { source: "test", ...options });
const count = (user, key = MASTER) => call(items.getItemCount, user, key);
const balance = (user) => call(economy.getBalance, user);
const setCount = (user, n, key = MASTER) =>
  dbRun(
    points,
    `INSERT INTO pokemon_inventory (user_id, item_key, count, first_obtained_at, last_obtained_at) VALUES (?, ?, ?, 1, 1)
     ON CONFLICT(user_id, item_key) DO UPDATE SET count = excluded.count`,
    [user, key, n]
  );
const value = () => items.itemOverflowValue(items.getItem(MASTER));
// La panne du crédit des points, par un déclencheur comme le veut docs/tests.md : elle ne
// dépend pas du texte de la requête, et tout ce qui écrit dans `points` la rencontre.
const failPoints = () => dbRun(points, "CREATE TRIGGER panne BEFORE INSERT ON points BEGIN SELECT RAISE(ABORT, 'panne provoquée'); END");
const healPoints = () => dbRun(points, "DROP TRIGGER IF EXISTS panne");

beforeEach(async () => {
  await healPoints();
  for (const table of ["pokemon_inventory", "pokemon_item_log", "points", "points_log", "pokemon_trades", "pokemon_data_migrations"]) {
    await dbRun(points, `DELETE FROM ${table}`);
  }
});

describe("la limite de détention", () => {
  it("la Master Ball est limitée à 1, et le surplus vaut 10 000 points", () => {
    const item = items.getItem(MASTER);
    assert.equal(items.itemCap(item), 1);
    assert.equal(value(), 10000);
    assert.equal(items.itemCap(items.getItem("super_bonbon")), null);
  });

  it("une limite sans prix de revente ne joue pas : rien ne se détruit contre zéro", () => {
    assert.equal(items.itemCap({ maxHeld: 1, overflowValue: 0 }), null);
    assert.equal(items.itemCap({ maxHeld: 1 }), null);
    assert.equal(items.itemCap({ maxHeld: 1, overflowValue: 5 }), 1);
  });

  it("la première se garde, la seconde se vend d'office", async () => {
    assert.deepEqual(await grant("u1"), { kept: 1, sold: 0, points: 0 });
    assert.deepEqual(await grant("u1"), { kept: 0, sold: 1, points: 10000 });
    assert.equal(await count("u1"), 1);
    assert.equal(await balance("u1"), 10000);
    const log = await dbAll(points, "SELECT delta, source FROM pokemon_item_log WHERE user_id = 'u1' ORDER BY id");
    assert.deepEqual(log, [
      { delta: 1, source: "test" },
      { delta: 0, source: "vente-auto:test" },
    ]);
  });

  it("un lot de trois sur un sac vide : une gardée, deux vendues", async () => {
    assert.deepEqual(await grant("u1", 3), { kept: 1, sold: 2, points: 20000 });
    assert.equal(await count("u1"), 1);
    assert.equal(await balance("u1"), 20000);
  });

  it("deux gains simultanés : une seule sous la limite", async () => {
    const results = await Promise.all([grant("u1"), grant("u1")]);
    assert.deepEqual(results.map((r) => r.kept).sort(), [0, 1]);
    assert.equal(await count("u1"), 1);
    assert.equal(await balance("u1"), 10000);
  });

  it("si les points de la vente ne passent pas, la ball se garde au-delà de la limite plutôt que de se perdre", async () => {
    await grant("u1");
    await failPoints();
    let result;
    try {
      result = await grant("u1");
    } finally {
      await healPoints();
    }
    assert.deepEqual(result, { kept: 1, sold: 0, points: 0 });
    assert.equal(await count("u1"), 2);
    assert.equal(await balance("u1"), 0);
  });

  it("« ignore » passe outre (compensation, administrateur) ; « refuse » ne crédite rien", async () => {
    await grant("u1");
    assert.deepEqual(await grant("u1", 2, { overflow: "ignore" }), { kept: 2, sold: 0, points: 0 });
    assert.equal(await count("u1"), 3);
    assert.equal(await grant("u2", 2, { overflow: "refuse" }), null, "tout ou rien");
    assert.equal(await count("u2"), 0);
    assert.deepEqual(await grant("u2", 1, { overflow: "refuse" }), { kept: 1, sold: 0, points: 0 });
    assert.equal(await grant("u2", 1, { overflow: "refuse" }), null);
    assert.equal(await count("u2"), 1);
    assert.equal(await balance("u2"), 0, "un refus ne vend rien");
  });

  it("un objet sans limite se crédite comme avant", async () => {
    assert.deepEqual(await call(items.grantItem, "u1", "super_bonbon", 7, { source: "test" }), { kept: 7, sold: 0, points: 0 });
    assert.equal(await count("u1", "super_bonbon"), 7);
  });

  it("la phrase dit ce qui a été vendu, et rien quand tout a été gardé", () => {
    const item = items.getItem(MASTER);
    const notice = items.overflowNotice(item, { kept: 0, sold: 1, points: 10000 });
    assert.match(notice, /Master Ball/);
    assert.match(notice, /vendue/);
    assert.ok(notice.includes((10000).toLocaleString("fr-FR")), "le montant vendu, à la française");
    assert.equal(items.overflowNotice(item, { kept: 1, sold: 0, points: 0 }), null);
    assert.equal(items.overflowNotice(item, null), null);
  });

  it("la loterie le dit dans son embed", () => {
    const item = items.getItem(MASTER);
    const embed = buildLotteryEmbed({ prize: { item, quantity: 1, granted: { kept: 0, sold: 1, points: 10000 } } }).toJSON();
    assert.match(embed.description, /Tu gagnes \*\*1× Master Ball\*\* ! Tu as déjà une Master Ball, le maximum/);
  });
});

describe("l'échange et la limite", () => {
  const propose = (offer, request, fromUserId = "u1", toUserId = "u2") =>
    call(collection.proposeTrade, { fromUserId, toUserId, offer, request, channelId: "salon" });
  const accept = (trade) => call(collection.acceptTrade, trade.id, {});

  it("on ne propose pas une Master Ball à qui en a déjà une, ni n'en demande quand on en a une", async () => {
    await setCount("u1", 1);
    await setCount("u2", 1);
    const give = await checkSide({ kind: "item", id: MASTER, quantity: 1 }, null, "u1", true, "u2");
    assert.match(give.error, /<@u2> a déjà \*\*1\*\* Master Ball, et on n'en garde pas plus de \*\*1\*\*/);
    const ask = await checkSide({ kind: "item", id: MASTER, quantity: 1 }, null, "u2", false, "u1");
    assert.match(ask.error, /^Tu as déjà \*\*1\*\* Master Ball/);
    await setCount("u2", 0);
    assert.deepEqual((await checkSide({ kind: "item", id: MASTER, quantity: 1 }, null, "u1", true, "u2")).side, { item: MASTER, quantity: 1 });
  });

  it("à l'acceptation, un receveur qui en a gagné une entre-temps fait échouer l'échange, sans rien bouger", async () => {
    await setCount("u1", 1);
    await economy.addPoints("u2", 500);
    const trade = await propose({ item: MASTER, quantity: 1 }, { points: 500 });
    await setCount("u2", 1);
    const result = await accept(trade);
    assert.equal(result.ok, false);
    assert.match(result.reason, /^Tu as déjà 1 Master Ball, et on n'en garde pas plus de 1/);
    assert.deepEqual([await count("u1"), await count("u2"), await balance("u2")], [1, 1, 500]);
    assert.equal((await dbGet(points, "SELECT status FROM pokemon_trades WHERE id = ?", [trade.id])).status, "FAILED");
  });

  it("une Master Ball contre une Master Ball passe : celle qu'on donne part avant", async () => {
    await setCount("u1", 1);
    await setCount("u2", 1);
    const trade = await propose({ item: MASTER, quantity: 1 }, { item: MASTER, quantity: 1 });
    assert.equal((await accept(trade)).ok, true);
    assert.deepEqual([await count("u1"), await count("u2")], [1, 1]);
  });

  it("une Master Ball à qui n'en a pas passe, sans vente", async () => {
    await setCount("u1", 1);
    const trade = await propose({ item: MASTER, quantity: 1 }, { points: 0 });
    assert.equal((await accept(trade)).ok, true);
    assert.deepEqual([await count("u1"), await count("u2"), await balance("u2")], [0, 1, 0]);
  });
});

describe("le surplus d'avant la limite", () => {
  it("se vend une seule fois : un don de l'administrateur après coup reste", async () => {
    await setCount("u1", 3);
    await setCount("u2", 1);
    assert.deepEqual(await call(items.sellHeldOverCap), { sold: 2 });
    assert.deepEqual([await count("u1"), await count("u2")], [1, 1]);
    assert.equal(await balance("u1"), 2 * value());
    assert.equal(await balance("u2"), 0);
    const log = await dbAll(points, "SELECT delta, source FROM pokemon_item_log WHERE user_id = 'u1'");
    assert.deepEqual(log, [{ delta: -2, source: "vente-auto:plafond-detention" }]);

    await grant("u1", 2, { overflow: "ignore" });
    assert.deepEqual(await call(items.sellHeldOverCap), { sold: 0 });
    assert.equal(await count("u1"), 3);
  });

  it("une ancienne table pokemon_migrations, d'un autre schéma, ne gêne pas la marque", async () => {
    // L'état des bases de production : une table de ce nom, sans colonne done_at.
    await dbRun(points, "DROP TABLE IF EXISTS pokemon_migrations");
    await dbRun(points, "CREATE TABLE pokemon_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
    await setCount("u1", 2);
    assert.deepEqual(await call(items.sellHeldOverCap), { sold: 1 });
    assert.equal((await dbAll(points, "SELECT name FROM pokemon_data_migrations")).length, 1);
    assert.deepEqual(await call(items.sellHeldOverCap), { sold: 0 });

    // Et le démarrage la supprime, sans toucher à la marque.
    const { dropLegacyTables } = await import("../modules/points-db.js");
    await new Promise((resolve) => dropLegacyTables(resolve));
    const tables = (await dbAll(points, "SELECT name FROM sqlite_master WHERE type = 'table'")).map((row) => row.name);
    assert.ok(!tables.includes("pokemon_migrations"));
    assert.ok(tables.includes("pokemon_data_migrations"));
    assert.equal((await dbAll(points, "SELECT name FROM pokemon_data_migrations")).length, 1);
  });

  it("des points qui ne passent pas rendent le surplus, et la migration se rejouera", async () => {
    await setCount("u1", 2);
    await failPoints();
    try {
      await assert.rejects(() => call(items.sellHeldOverCap), /panne provoquée/);
    } finally {
      await healPoints();
    }
    assert.equal(await count("u1"), 2, "rien ne se perd");
    assert.equal((await dbAll(points, "SELECT * FROM pokemon_data_migrations")).length, 0);
    assert.deepEqual(await call(items.sellHeldOverCap), { sold: 1 });
    assert.equal(await count("u1"), 1);
  });
});
