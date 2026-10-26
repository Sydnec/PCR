// Le site et les balls spéciales : la boutique (catalogue, achat), l'onglet qui
// n'apparaît qu'une fois la génération ouverte, et les balls spéciales d'une
// apparition avec ce qui sert à CETTE apparition.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbAll, speciesByName } from "./helpers.js";

createSandbox({ config: { pokemon: { generationOpenings: { 2: "2000-01-01T00:00:00+01:00" } } } });
const { points } = await openDatabases();
const { routes, HttpError } = await import("../modules/web/api.js");
const data = await import("../modules/pokemon/data.js");
const { getBall, getPokemonConfig, specialBallDailyLimit, specialBallLimit } = await import("../modules/pokemon/config.js");

const fr = (value) => value.toLocaleString("fr-FR");
const species = (name) => speciesByName(data.allSpecies, name);
const route = (method, path) => routes.find((entry) => entry.method === method && entry.path === path);
const call = (method, path, body = {}) =>
  route(method, path).handler({ user: { id: "u1" }, body, params: {}, query: {}, bot: null });
const setBalance = (amount) =>
  dbRun(points, "INSERT INTO points (user_id, balance) VALUES ('u1', ?) ON CONFLICT(user_id) DO UPDATE SET balance = ?", [amount, amount]);

beforeEach(async () => {
  for (const table of ["points", "pokemon_ball_units", "pokemon_spawns", "pokemon_inventory", "pokemon_item_log", "points_log", "pokemon_shop_daily"]) await dbRun(points, `DELETE FROM ${table}`);
});

describe("la boutique du site", () => {
  // Les routes POST (l'achat, la pêche) sont couvertes par le parcours de web-routes.test.js ;
  // une lecture ne l'est pas, d'où cette seule déclaration.
  it("la lecture de la boutique demande une connexion", () => {
    assert.equal(route("GET", "/api/shop").auth, true);
  });

  it("le catalogue porte prix, effet, image et ce qu'on en a", async () => {
    await setBalance(900);
    const shop = await call("GET", "/api/shop");
    assert.equal(shop.balance, 900);
    assert.equal(shop.limit, specialBallLimit());
    assert.equal(shop.dailyLimit, specialBallDailyLimit());
    assert.ok(shop.resetsAt > Date.now());
    assert.deepEqual(shop.balls.map((ball) => [ball.key, ball.price, ball.held]), [
      ["appat", getBall("appat").price, 0],
      ["catalyseur", getBall("catalyseur").price, 0],
    ]);
    assert.match(shop.balls[0].effect, new RegExp(`×${getBall("appat").bonus.multiplier} sur les Pokémon pêchés`));
    assert.ok(shop.balls[0].image);
  });

  it("acheter rend la boutique à jour ; un refus dit pourquoi, avec les chiffres, sans rien débiter", async () => {
    // Deux balls payées, et il reste moins qu'une troisième ne coûte.
    const price = getBall("appat").price;
    const left = price - 1;
    await setBalance(2 * price + left);
    const bought = await call("POST", "/api/shop/buy", { ball: "appat", quantity: 2 });
    assert.deepEqual([bought.ok, bought.bought, bought.cost, bought.balance], [true, 2, 2 * price, left]);
    assert.equal(bought.balls[0].held, 2);
    assert.equal(bought.balls[0].boughtToday, 2);
    assert.equal(bought.dailyLimit, specialBallDailyLimit());
    const refused = await call("POST", "/api/shop/buy", { ball: "appat", quantity: 1 });
    assert.equal(refused.ok, false);
    assert.match(refused.message, new RegExp(`Il te faut ${fr(price)} points, tu en as ${fr(left)}`));
    assert.equal((await dbAll(points, "SELECT * FROM pokemon_ball_units")).length, 2);
  });

  it("un corps mal formé est refusé", async () => {
    for (const body of [{}, { ball: 3 }, { ball: "appat", quantity: 0 }, { ball: "appat", quantity: 1.5 }]) {
      await assert.rejects(() => call("POST", "/api/shop/buy", body), HttpError);
    }
  });

  it("le catalogue nomme les balls spéciales en vente, de quoi les afficher dans un journal de lancers", async () => {
    const catalogue = await call("GET", "/api/catalogue");
    assert.deepEqual(catalogue.balls.map((ball) => ball.key), ["poke", "super", "hyper", "master", "appat", "catalyseur", "safari"]);
  });

  it("/api/me dit que la boutique est ouverte", async () => {
    assert.equal((await call("GET", "/api/me")).shop, true);
  });
});

describe("les balls spéciales d'une apparition", () => {
  it("chaque ball dit ses chances et combien servent à CETTE apparition", async () => {
    await dbRun(
      points,
      `INSERT INTO pokemon_spawns (id, species_id, is_shiny, catch_rate, rarity, status, spawned_at, flees_at, sex, charm_shiny, fished)
       VALUES (1, ?, 0, ?, 'COMMUN', 'ACTIVE', 1000, 9999999999999, 'M', 0, 1)`,
      [species("Onix").id, species("Onix").catchRate]
    );
    await dbRun(points, "INSERT INTO pokemon_ball_units (user_id, ball, bought_at) VALUES ('u1', 'appat', 500), ('u1', 'appat', 2000), ('u1', 'catalyseur', 500)");
    const { spawn } = await call("GET", "/api/spawn");
    const [appat, catalyseur] = spawn.specialBalls;
    assert.deepEqual([appat.key, appat.held, appat.eligible], ["appat", 2, 1], "la seconde Appât Ball est postérieure");
    assert.deepEqual([catalyseur.key, catalyseur.held, catalyseur.eligible], ["catalyseur", 1, 1]);
    const base = data.catchProbability(species("Onix").catchRate, 1, 1);
    assert.ok(Math.abs(appat.probability - Math.min(1, base * getBall("appat").bonus.multiplier)) < 1e-9, "Onix pêché : le bonus de l'Appât");
    assert.ok(Math.abs(catalyseur.probability - Math.min(1, base * getBall("catalyseur").bonus.multiplier)) < 1e-9, "Onix évolue avec le Catalyseur : son bonus");
    assert.ok(spawn.balls.some((ball) => ball.key === "master"), "la Master Ball reste dans `balls`, que la vue range avec les spéciales");
  });
});

describe("la pêche sur le site", () => {
  it("la route de lancer refuse un corps sans canne", async () => {
    await assert.rejects(() => call("POST", "/api/fishing/cast", {}), HttpError);
    await assert.rejects(() => call("POST", "/api/fishing/cast", { rod: 3 }), HttpError);
  });

  it("sans touche : les cannes, avec leur prix et ce qu'on en a", async () => {
    await setBalance(500);
    const { fishing } = await call("GET", "/api/spawn");
    assert.equal(fishing.open, true);
    const rodPrice = (key) => getPokemonConfig().items[key].rod.price;
    assert.deepEqual(fishing.rods.map((rod) => [rod.key, rod.price, rod.owned]), [
      ["canne", rodPrice("canne"), true],
      ["super_canne", rodPrice("super_canne"), false],
      ["mega_canne", rodPrice("mega_canne"), false],
    ]);
    assert.equal(fishing.spawn, null);
  });

  it("lancer la ligne débite la canne ; la touche arrive avec ses balls, ses balls spéciales et sa fuite", async () => {
    const price = getPokemonConfig().items.canne.rod.price;
    await setBalance(price * 5);
    const result = await call("POST", "/api/fishing/cast", { rod: "canne" });
    assert.deepEqual([result.ok, result.message, result.price], [true, null, price]);
    const { fishing } = await call("GET", "/api/spawn");
    const touch = fishing.spawn;
    assert.ok(touch.fished && touch.fleesAt > Date.now());
    assert.ok(touch.balls.length >= 4 && touch.specialBalls.length === 2);
    const [row] = await dbAll(points, "SELECT status, reserved_for FROM pokemon_spawns");
    assert.deepEqual([row.status, row.reserved_for], ["FISHING", "u1"]);
  });

  it("un refus est une issue : ok faux et le message, sans rien débiter", async () => {
    const price = getPokemonConfig().items.canne.rod.price;
    const left = price - 1;
    await setBalance(left);
    const refused = await call("POST", "/api/fishing/cast", { rod: "canne" });
    assert.equal(refused.ok, false);
    assert.match(refused.message, new RegExp(`La Canne pêche à ${fr(price)} points, tu en as ${fr(left)}`));
    assert.equal((await dbAll(points, "SELECT * FROM pokemon_spawns")).length, 0);
  });

  it("la touche d'un autre dresseur n'apparaît pas, et la pêche d'un salon ne la montre pas", async () => {
    await setBalance(500);
    await call("POST", "/api/fishing/cast", { rod: "canne" });
    const other = await route("GET", "/api/spawn").handler({ user: { id: "u2" }, body: {}, params: {}, query: {}, bot: null });
    assert.equal(other.fishing.spawn, null);
    assert.equal(other.spawn, null, "une pêche n'est jamais l'apparition du salon");
    assert.equal(other.last, null);
  });
});
