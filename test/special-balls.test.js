// Les balls spéciales : la boutique (achat, plafond, remboursement), leur date d'achat
// qui décide si elles servent, et leur bonus au lancer.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbAll, dbGet, eventually, withRandom, speciesByName } from "./helpers.js";

createSandbox({
  config: { pokemon: { generationOpenings: { 2: "2000-01-01T00:00:00+01:00" }, spawn: { embedRefreshMs: 1 }, capture: { throwCooldownSeconds: 0 } } },
});
const { points, stats } = await openDatabases();
const shop = await import("../modules/pokemon/shop.js");
const capture = await import("../modules/pokemon/capture.js");
const economy = await import("../modules/economy.js");
const data = await import("../modules/pokemon/data.js");
const { getPokemonConfig, getBall } = await import("../modules/pokemon/config.js");

const call = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value))));
const species = (name) => speciesByName(data.allSpecies, name);
const client = { channels: { fetch: async () => { throw new Error("pas de Discord"); } } };
const balance = (user = "u1") => call(economy.getBalance, user);
const setBalance = (amount, user = "u1") =>
  dbRun(points, "INSERT INTO points (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = ?", [user, amount, amount]);
const units = (user = "u1", ball = "appat") => dbAll(points, "SELECT * FROM pokemon_ball_units WHERE user_id = ? AND ball = ? ORDER BY bought_at, id", [user, ball]);
const addUnit = (boughtAt, { user = "u1", ball = "appat" } = {}) =>
  dbRun(points, "INSERT INTO pokemon_ball_units (user_id, ball, bought_at) VALUES (?, ?, ?)", [user, ball, boughtAt]);
const throwBall = (user, ball, random = [0]) => withRandom(random, () => call(capture.resolveThrow, client, user, 1, ball, {}));

async function seedSpawn(name = "Roucool", { fished = 0, spawnedAt = 1000 } = {}) {
  await dbRun(points, "DELETE FROM pokemon_spawns");
  await dbRun(
    points,
    `INSERT INTO pokemon_spawns (id, species_id, is_shiny, catch_rate, rarity, status, spawned_at, flees_at, sex, charm_shiny, fished)
     VALUES (1, ?, 0, ?, ?, 'ACTIVE', ?, 9999999999999, 'M', 0, ?)`,
    [species(name).id, species(name).catchRate, data.rarityOf(species(name)), spawnedAt, fished]
  );
}

beforeEach(async () => {
  for (const table of ["points", "pokemon_owned", "pokemon_inventory", "pokemon_throws", "pokemon_ball_units", "points_log", "pokemon_shop_purchases"]) {
    await dbRun(points, `DELETE FROM ${table}`);
  }
  await seedSpawn();
});

describe("la boutique", () => {
  it("l'achat débite le prix, donne une ligne par ball datée de maintenant", async () => {
    await setBalance(1000);
    const before = Date.now();
    const result = await call(shop.buyBalls, "u1", "appat", 3);
    assert.deepEqual([result.ok, result.bought, result.cost], [true, 3, 690]);
    assert.equal(await balance(), 310);
    const rows = await units();
    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => row.bought_at >= before));
  });

  it("un refus donne les chiffres et ne touche à rien : solde, plafond, ball inconnue, quantité", async () => {
    await setBalance(100);
    assert.match((await call(shop.buyBalls, "u1", "appat", 1)).reason, /Il te faut 230 points, tu en as 100/);
    await setBalance(100000);
    for (let index = 0; index < 8; index++) await addUnit(1);
    assert.match((await call(shop.buyBalls, "u1", "appat", 3)).reason, /Tu en as 8 sur 10 : tu peux encore en acheter 2, pas 3/);
    assert.match((await call(shop.buyBalls, "u1", "poke", 1)).reason, /pas en vente/);
    assert.match((await call(shop.buyBalls, "u1", "appat", 0)).reason, /au moins 1/);
    assert.equal(await balance(), 100000, "rien n'a été débité");
    assert.equal((await units()).length, 8);
  });

  it("deux achats simultanés ne dépassent jamais le plafond, et le surplus est remboursé", async () => {
    await setBalance(100000);
    const results = await Promise.all([call(shop.buyBalls, "u1", "appat", 6), call(shop.buyBalls, "u1", "appat", 6)]);
    assert.equal((await units()).length, 10);
    assert.equal(results.reduce((sum, result) => sum + result.bought, 0), 10);
    assert.equal(await balance(), 100000 - 10 * 230, "seules les 10 balls livrées sont payées");
  });

  it("un achat dont l'insertion échoue rembourse tout", async () => {
    await setBalance(1000);
    await dbRun(points, "CREATE TRIGGER panne BEFORE INSERT ON pokemon_ball_units BEGIN SELECT RAISE(ABORT, 'panne'); END");
    await assert.rejects(() => call(shop.buyBalls, "u1", "appat", 2), /panne/);
    await dbRun(points, "DROP TRIGGER panne");
    assert.equal(await balance(), 1000);
    assert.equal((await units()).length, 0);
  });

  it("une erreur en cours d'achat : ce qui est livré existe, le reste est remboursé, et on le dit", async () => {
    await setBalance(1000);
    await dbRun(points, "CREATE TRIGGER panne BEFORE INSERT ON pokemon_ball_units WHEN (SELECT COUNT(*) FROM pokemon_ball_units WHERE user_id = NEW.user_id) >= 1 BEGIN SELECT RAISE(ABORT, 'panne'); END");
    const result = await call(shop.buyBalls, "u1", "appat", 3);
    await dbRun(points, "DROP TRIGGER panne");
    assert.deepEqual([result.ok, result.partial, result.bought, result.cost], [true, true, 1, 230]);
    assert.match(result.reason, /Une erreur a interrompu l'achat : 1 sur 3 achetée/);
    assert.equal((await units()).length, 1);
    assert.equal(await balance(), 1000 - 230, "seule la ball livrée est payée");
  });

  it("un achat compte dans les points dépensés du dresseur", async () => {
    // Les statistiques s'accumulent d'un test à l'autre : on compare avant et après.
    const spent = async () => (await dbGet(stats, "SELECT points_spent FROM pokemon_stats WHERE user_id = 'u1'"))?.points_spent ?? 0;
    const before = await spent();
    await setBalance(1000);
    await call(shop.buyBalls, "u1", "catalyseur", 2);
    await eventually(async () => assert.equal((await spent()) - before, 600));
  });

  it("une ball dont la génération est fermée n'est pas en vente", async () => {
    const appat = getPokemonConfig().capture.specialBalls.appat;
    const original = appat.generation;
    appat.generation = 3;
    try {
      assert.deepEqual(shop.openSpecialBalls().map((ball) => ball.key), ["catalyseur"]);
      await setBalance(1000);
      assert.match((await call(shop.buyBalls, "u1", "appat", 1)).reason, /pas en vente/);
    } finally {
      appat.generation = original;
    }
  });
});

describe("le journal des achats (lu par le bilan de saison)", () => {
  const purchases = () => dbAll(points, "SELECT user_id, ball, quantity, cost, bought_at FROM pokemon_shop_purchases ORDER BY id");
  const quiet = async (work) => {
    const original = console.error;
    const lines = [];
    console.error = (...args) => lines.push(args.join(" "));
    try {
      return { result: await work(), errors: lines };
    } finally {
      console.error = original;
    }
  };

  it("un achat conclu écrit une ligne : dresseur, ball, quantité, prix payé, date", async () => {
    await setBalance(2000);
    const before = Date.now();
    await call(shop.buyBalls, "u1", "appat", 3);
    await eventually(async () => {
      const rows = await purchases();
      assert.deepEqual(rows.map(({ user_id, ball, quantity, cost }) => ({ user_id, ball, quantity, cost })), [{ user_id: "u1", ball: "appat", quantity: 3, cost: 690 }]);
      assert.ok(rows[0].bought_at >= before);
    });
  });

  it("un refus n'écrit rien : ni solde insuffisant, ni plafond, ni ball hors vente", async () => {
    await setBalance(100);
    await call(shop.buyBalls, "u1", "appat", 1);
    await call(shop.buyBalls, "u1", "poke", 1);
    await call(shop.buyBalls, "u1", "appat", 0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(await purchases(), []);
  });

  it("un achat livré en partie ne garde que ce qui l'a été, au prix payé", async () => {
    await setBalance(1000);
    await dbRun(points, "CREATE TRIGGER panne BEFORE INSERT ON pokemon_ball_units WHEN (SELECT COUNT(*) FROM pokemon_ball_units WHERE user_id = NEW.user_id) >= 1 BEGIN SELECT RAISE(ABORT, 'panne'); END");
    const { result } = await quiet(() => call(shop.buyBalls, "u1", "appat", 3));
    await dbRun(points, "DROP TRIGGER panne");
    assert.equal(result.bought, 1);
    await eventually(async () => assert.deepEqual((await purchases()).map((row) => [row.quantity, row.cost]), [[1, 230]]));
  });

  it("un achat tout remboursé n'écrit rien", async () => {
    await setBalance(1000);
    await dbRun(points, "CREATE TRIGGER panne BEFORE INSERT ON pokemon_ball_units BEGIN SELECT RAISE(ABORT, 'panne'); END");
    await assert.rejects(() => call(shop.buyBalls, "u1", "appat", 2), /panne/);
    await dbRun(points, "DROP TRIGGER panne");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(await purchases(), []);
  });

  it("une écriture du journal qui échoue est signalée mais ne défait pas l'achat", async () => {
    await setBalance(1000);
    await dbRun(points, "CREATE TRIGGER panne BEFORE INSERT ON pokemon_shop_purchases BEGIN SELECT RAISE(ABORT, 'panne'); END");
    const lines = [];
    const original = console.error;
    console.error = (...args) => lines.push(args.join(" "));
    try {
      const result = await call(shop.buyBalls, "u1", "appat", 2);
      assert.deepEqual([result.ok, result.bought, result.cost], [true, 2, 460]);
      await eventually(async () => assert.ok(lines.some((line) => line.includes("Journal des achats de la boutique") && line.includes("panne"))));
      assert.equal(await balance(), 1000 - 460, "les points sont partis");
      assert.equal((await units()).length, 2, "les balls sont là");
      assert.deepEqual(await purchases(), []);
    } finally {
      console.error = original;
      await dbRun(points, "DROP TRIGGER panne");
    }
  });
});

describe("la date d'achat", () => {
  it("seule une ball achetée AVANT l'apparition est prise, la plus ancienne d'abord", async () => {
    await addUnit(900);
    await addUnit(500);
    await addUnit(1000); // même milliseconde : pas avant
    await addUnit(2000);
    const first = await call(shop.takeUnit, "u1", "appat", 1000);
    assert.equal(first.bought_at, 500);
    assert.equal((await call(shop.takeUnit, "u1", "appat", 1000)).bought_at, 900);
    assert.equal(await call(shop.takeUnit, "u1", "appat", 1000), null, "il ne reste que celles d'après");
  });

  it("une ball rendue garde sa date : elle servira comme avant", async () => {
    await addUnit(500);
    const taken = await call(shop.takeUnit, "u1", "appat", 1000);
    assert.equal((await units()).length, 0);
    await call(shop.restoreUnit, taken);
    assert.deepEqual((await units()).map((row) => row.bought_at), [500]);
  });

  it("les comptes distinguent ce qu'on a de ce qui sert à cette apparition", async () => {
    await addUnit(500);
    await addUnit(2000);
    const counts = await new Promise((resolve, reject) => shop.getUnitCounts("u1", (err, value) => (err ? reject(err) : resolve(value)), { spawnedAt: 1000 }));
    assert.deepEqual(counts.get("appat"), { held: 2, eligible: 1 });
  });
});

describe("le lancer d'une ball spéciale", () => {
  const probability = (ball, name, fished) =>
    data.catchProbability(species(name).catchRate, data.ballMultiplier(getBall(ball), { fished, speciesId: species(name).id }), getPokemonConfig().capture.globalMultiplier);

  it("l'Appât Ball vaut ×3 sur un Pokémon pêché, ×1 sinon", async () => {
    await addUnit(500);
    await seedSpawn("Ronflex", { fished: 1 });
    const hit = await throwBall("u1", "appat", [0.9999]);
    assert.equal(hit.status, "miss");
    assert.ok(Math.abs(hit.probability - probability("appat", "Ronflex", true)) < 1e-9);
    assert.ok(hit.probability > probability("appat", "Ronflex", false));
    assert.equal(data.ballMultiplier(getBall("appat"), { fished: true, speciesId: species("Ronflex").id }), 3, "×3 sur une pêche");
    await addUnit(500);
    await seedSpawn("Ronflex", { fished: 0 });
    const plain = await throwBall("u1", "appat", [0.9999]);
    assert.ok(Math.abs(plain.probability - probability("poke", "Ronflex", false)) < 1e-9, "×1 : comme une Poké Ball");
  });

  it("la Catalyseur Ball vaut ×4 sur les espèces du Catalyseur, ×1 sur les autres", async () => {
    assert.deepEqual([...data.speciesEvolvingWith("catalyseur")].sort((a, b) => a - b), [95, 117, 123, 137]);
    await addUnit(500, { ball: "catalyseur" });
    await seedSpawn("Onix");
    const onix = await throwBall("u1", "catalyseur", [0.9999]);
    assert.ok(Math.abs(onix.probability - probability("catalyseur", "Onix", false)) < 1e-9);
    assert.equal(data.ballMultiplier(getBall("catalyseur"), { speciesId: 95 }), 4);
    assert.equal(data.ballMultiplier(getBall("catalyseur"), { speciesId: species("Roucool").id }), 1);
  });

  it("la ball est consommée au lancer (raté ou capture), sans débiter de points", async () => {
    await setBalance(500);
    await addUnit(500);
    await addUnit(500);
    const miss = await throwBall("u1", "appat", [0.9999]);
    assert.equal(miss.status, "miss");
    assert.equal((await units()).length, 1);
    assert.equal(await balance(), 500, "une ball achetée ne coûte rien au lancer");
    const caught = await throwBall("u1", "appat", [0]);
    assert.equal(caught.status, "catch");
    assert.equal((await units()).length, 0);
    assert.match(capture.throwMessage(caught), /Appât Ball utilisée/);
  });

  it("sans ball achetée avant l'apparition : refus avec le décompte, rien n'est consommé", async () => {
    await addUnit(2000);
    const refused = await throwBall("u1", "appat");
    assert.equal(refused.status, "no-unit");
    assert.equal(refused.held, 1);
    assert.match(capture.throwMessage(refused), /tu en as 1\b.*après son achat/);
    assert.equal((await units()).length, 1);
    assert.equal((await dbAll(points, "SELECT * FROM pokemon_throws")).length, 0);
  });

  it("battu à la course : la ball est rendue avec sa date, et le lancer annulé", async () => {
    await addUnit(500, { user: "u1" });
    await addUnit(600, { user: "u2" });
    const [first, second] = await Promise.all([throwBall("u1", "appat", [0]), throwBall("u2", "appat", [0])]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, ["catch", "void"]);
    const loser = first.status === "void" ? "u1" : "u2";
    assert.equal((await units(loser)).length, 1, "la perdante retrouve sa ball");
    assert.match(capture.throwMessage(first.status === "void" ? first : second), /Ta \*\*Appât Ball\*\* t'a été rendue/);
  });

  it("startThrow refuse une ball spéciale fermée avant de consommer le délai", () => {
    const appat = getPokemonConfig().capture.specialBalls.appat;
    appat.generation = 3;
    try {
      assert.deepEqual(capture.startThrow("u1", "appat"), { status: "unknown-ball" });
    } finally {
      appat.generation = 2;
    }
    assert.equal(capture.startThrow("u1", "appat"), null, "ouverte, elle part");
  });

  it("une ball dont la génération est fermée est inconnue au lancer", async () => {
    const appat = getPokemonConfig().capture.specialBalls.appat;
    appat.generation = 3;
    try {
      await addUnit(500);
      assert.equal((await throwBall("u1", "appat")).status, "unknown-ball");
      assert.equal((await units()).length, 1);
    } finally {
      appat.generation = 2;
    }
  });

  it("les balls spéciales ne se mêlent pas aux balls ordinaires de la config", () => {
    const standard = Object.keys(getPokemonConfig().capture.balls);
    assert.ok(!standard.includes("appat") && !standard.includes("catalyseur"));
    assert.equal(getBall("appat").special, true);
    assert.equal(getBall("poke").special, undefined);
  });
});
