// La pêche : les tables officielles, le lancer de ligne (prix, canne, une touche à la fois,
// fuite), la capture réservée au pêcheur, et la rareté sauvage des espèces pêchables.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbAll, dbGet, withRandom, speciesByName } from "./helpers.js";

createSandbox({
  config: { pokemon: { generationOpenings: { 2: "2000-01-01T00:00:00+01:00" }, spawn: { embedRefreshMs: 1 }, capture: { throwCooldownSeconds: 0 } } },
});
const { points } = await openDatabases();
const fishing = await import("../modules/pokemon/fishing.js");
const capture = await import("../modules/pokemon/capture.js");
const spawnModule = await import("../modules/pokemon/spawn.js");
const economy = await import("../modules/economy.js");
const items = await import("../modules/pokemon/items.js");
const data = await import("../modules/pokemon/data.js");
const { getPokemonConfig } = await import("../modules/pokemon/config.js");

const call = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value))));
const species = (name) => speciesByName(data.allSpecies, name);
const client = { channels: { fetch: async () => { throw new Error("pas de Discord"); } } };
const balance = (user = "u1") => call(economy.getBalance, user);
const setBalance = (amount, user = "u1") =>
  dbRun(points, "INSERT INTO points (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = ?", [user, amount, amount]);
const cast = (rod = "canne", user = "u1") => withRandom([0.5], () => call(fishing.castLine, user, rod));
const give = (key, user = "u1") => call((...a) => items.grantItem(user, key, 1, { source: "test" }, a.at(-1)));
const spawns = () => dbAll(points, "SELECT * FROM pokemon_spawns ORDER BY id");

beforeEach(async () => {
  for (const table of ["points", "pokemon_inventory", "pokemon_item_log", "pokemon_spawns", "pokemon_throws", "pokemon_owned", "points_log"]) {
    await dbRun(points, `DELETE FROM ${table}`);
  }
});

describe("les tables de pêche officielles", () => {
  it("chaque canne a sa table, qui totalise 100 %, avec des espèces du jeu", () => {
    for (const pool of ["old", "good", "super"]) {
      const table = data.fishingPool(pool);
      assert.ok(table.length >= 5, pool);
      assert.ok(table.every((entry) => entry.species && entry.weight > 0));
      const total = table.reduce((sum, entry) => sum + entry.weight, 0);
      assert.ok(Math.abs(total - 100) < 1, `${pool} : ${total}`);
    }
    assert.equal(data.fishingPool("old")[0].species.name, "Magicarpe", "la Canne : surtout des Magicarpe");
    assert.ok(data.fishingPool("super").length > data.fishingPool("old").length, "plus la canne est bonne, plus la table est large");
    assert.deepEqual(data.fishingPool("inconnue"), []);
  });

  it("le tirage suit les poids : 0 donne le plus fréquent, presque 1 le plus rare", () => {
    const table = data.fishingPool("good");
    assert.equal(withRandom([0], () => data.pickFished("good")).id, table[0].species.id);
    assert.equal(withRandom([0.999999], () => data.pickFished("good")).id, table.at(-1).species.id);
  });
});

describe("lancer la ligne", () => {
  it("la Canne de base est donnée une seule fois, et le lancer débite son prix", async () => {
    await setBalance(500);
    const result = await cast();
    assert.equal(result.ok, true, result.reason);
    assert.equal(await balance(), 400);
    assert.equal(await call(items.getItemCount, "u1", "canne"), 1, "donnée à la première pêche");
    const [row] = await spawns();
    assert.deepEqual([row.status, row.fished, row.reserved_for], ["FISHING", 1, "u1"]);
    assert.equal(row.channel_id, null, "pas de salon : la touche n'est qu'au pêcheur");
    const fleeMs = getPokemonConfig().fishing.fleeSeconds * 1000;
    assert.ok(Math.abs(row.flees_at - row.spawned_at - fleeMs) < 5);
  });

  it("une touche à la fois : la suivante est refusée, rien n'est débité", async () => {
    await setBalance(500);
    const first = await cast();
    const second = await cast();
    assert.equal(second.ok, false);
    assert.match(second.reason, /déjà une touche/);
    assert.equal(second.existing.id, first.spawn.id);
    assert.equal(await balance(), 400);
    assert.equal((await spawns()).length, 1);
  });

  it("deux lancers simultanés : un seul passe, l'autre est remboursé", async () => {
    await setBalance(500);
    const results = await Promise.all([cast(), cast()]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(await balance(), 400, "un seul lancer payé");
    assert.equal((await spawns()).length, 1);
  });

  it("une touche qui s'est enfuie libère la ligne", async () => {
    await setBalance(500);
    const first = await cast();
    await dbRun(points, "UPDATE pokemon_spawns SET flees_at = ? WHERE id = ?", [Date.now() - 1, first.spawn.id]);
    assert.equal((await cast()).ok, true);
    const rows = await spawns();
    assert.deepEqual(rows.map((row) => row.status), ["FLED", "FISHING"]);
  });

  it("chaque canne a son prix, et il faut la posséder : le refus donne les chiffres", async () => {
    await setBalance(80);
    assert.match((await cast("super_canne")).reason, /Tu n'as pas de Super Canne/);
    await give("super_canne");
    assert.match((await cast("super_canne")).reason, /La Super Canne pêche à 100 points, tu en as 80/);
    assert.match((await cast("pas-une-canne")).reason, /Choisis une canne/);
    assert.equal((await spawns()).length, 0);
    assert.equal(await balance(), 80);
    await setBalance(300);
    assert.equal((await cast("super_canne")).ok, true);
    assert.equal(await balance(), 200, "100 points la Super Canne");
  });

  it("une touche qui ne s'enregistre pas rend les points", async () => {
    await setBalance(500);
    await dbRun(points, "CREATE TRIGGER panne BEFORE INSERT ON pokemon_spawns BEGIN SELECT RAISE(ABORT, 'panne'); END");
    await assert.rejects(() => cast(), /panne/);
    await dbRun(points, "DROP TRIGGER panne");
    assert.equal(await balance(), 500);
  });

  it("relire les cannes ou la touche n'écrit rien : seul le premier passage donne la Canne", async () => {
    const logs = async () => (await dbAll(points, "SELECT * FROM pokemon_item_log")).length;
    await call(fishing.getRodsOf, "u1");
    const afterFirst = await logs();
    assert.equal(afterFirst, 1, "la Canne de base, donnée une fois");
    await call(fishing.getRodsOf, "u1");
    await call(fishing.getRodsOf, "u1");
    assert.equal(await logs(), afterFirst, "les relectures du site n'écrivent pas");

    await setBalance(500);
    const first = await cast();
    await dbRun(points, "UPDATE pokemon_spawns SET flees_at = ? WHERE id = ?", [Date.now() - 1, first.spawn.id]);
    assert.equal(await call(fishing.getFishingSpawn, "u1"), null, "enfuie : plus en cours");
    assert.equal((await spawns())[0].status, "FISHING", "mais la lecture ne l'a pas fermée : c'est le prochain lancer qui le fait");
  });

  it("une touche écrite mais illisible n'est pas remboursée : elle existe, et le dit", async () => {
    await setBalance(500);
    const original = points.get;
    points.get = function (sql, ...rest) {
      if (/SELECT \* FROM pokemon_spawns WHERE id = \?/.test(sql)) return rest.at(-1)(new Error("panne de lecture"));
      return original.call(this, sql, ...rest);
    };
    let result;
    try {
      result = await cast();
    } finally {
      points.get = original;
    }
    assert.equal(result.ok, false);
    assert.equal(result.debited, true);
    assert.match(result.reason, /100 points débités.*relance \/pk pecher/);
    assert.equal(await balance(), 400, "pas de remboursement : la ligne existe");
    assert.equal((await spawns()).length, 1);
    assert.equal((await call(fishing.getFishingSpawn, "u1")).status, "FISHING", "elle se retrouve");
  });

  it("la pêche attend sa génération", async () => {
    const config = getPokemonConfig();
    config.fishing.generation = 3;
    try {
      await setBalance(500);
      assert.match((await cast()).reason, /La pêche ouvre avec la 3e génération/);
      assert.equal(await balance(), 500);
      assert.deepEqual(await call(fishing.getRodsOf, "u1"), []);
    } finally {
      config.fishing.generation = 2;
    }
  });

  it("les cannes du dresseur : la base possédée, les autres à gagner, par prix croissant", async () => {
    const rods = await call(fishing.getRodsOf, "u1");
    assert.deepEqual(rods.map((rod) => [rod.key, rod.price, rod.owned]), [["canne", 100, true], ["super_canne", 100, false], ["mega_canne", 100, false]]);
  });

  it("la Canne de base ne s'échange pas, les autres oui", () => {
    assert.equal(items.isTradable(items.getItem("canne")), false);
    assert.equal(items.isTradable(items.getItem("super_canne")), true);
    assert.equal(items.isTradable(items.getItem("mega_canne")), true);
  });
});

describe("la capture d'une pêche", () => {
  const throwBall = (user, ball = "poke", random = [0]) =>
    withRandom(random, () => call(capture.resolveThrow, client, user, 1, ball, {}));

  async function hook(user = "u1") {
    await setBalance(5000, user);
    const result = await cast("canne", user);
    await dbRun(points, "UPDATE pokemon_spawns SET id = 1, held_item = 'pepite', catch_rate = 255 WHERE id = ?", [result.spawn.id]);
    return result;
  }

  it("seul le pêcheur peut lancer dessus : un autre est refusé sans rien débiter", async () => {
    await hook();
    await setBalance(5000, "u2");
    const refused = await throwBall("u2");
    assert.equal(refused.status, "not-yours");
    assert.match(capture.throwMessage(refused), /pas pour toi/);
    assert.equal(await balance("u2"), 5000);
    assert.equal((await spawns())[0].status, "FISHING");
  });

  it("le pêcheur le capture avec une ball payée, et garde l'objet tenu sans course", async () => {
    await hook();
    const before = await balance();
    const caught = await throwBall("u1");
    assert.equal(caught.status, "catch");
    assert.equal(before - (await balance()), getPokemonConfig().capture.balls.poke.price, "la ball se paie, contrairement au safari");
    assert.equal((await spawns())[0].status, "CAUGHT");
    assert.equal(await call(items.getItemCount, "u1", "pepite"), 1, "l'objet suit le Pokémon, il ne tombe pas au sol");
    assert.equal((await dbAll(points, "SELECT * FROM pokemon_drops")).length, 0);
    assert.equal((await dbAll(points, "SELECT * FROM pokemon_owned WHERE user_id = 'u1'")).length, 1);
  });

  it("une touche enfuie n'est plus là, sans rien débiter", async () => {
    await hook();
    await dbRun(points, "UPDATE pokemon_spawns SET flees_at = ? WHERE id = 1", [Date.now() - 1]);
    const before = await balance();
    assert.equal((await throwBall("u1")).status, "gone");
    assert.equal(await balance(), before);
  });

  it("la fuite s'applique jusque dans l'écriture : une touche qui s'enfuit entre le débit et la capture n'est pas prise", async () => {
    await hook();
    const before = await balance();
    const original = points.run;
    // Entre le contrôle et l'écriture de la capture, l'échéance tombe.
    points.run = function (sql, ...rest) {
      if (/SET status = 'CAUGHT'/.test(sql)) original.call(this, "UPDATE pokemon_spawns SET flees_at = ? WHERE id = 1", [Date.now() - 1]);
      return original.call(this, sql, ...rest);
    };
    let outcome;
    try {
      outcome = await throwBall("u1");
    } finally {
      points.run = original;
    }
    assert.equal(outcome.status, "void", "annulé, comme battu à la course");
    assert.equal(await balance(), before, "la ball est remboursée");
    assert.equal((await spawns())[0].status, "FISHING", "elle n'a pas été capturée");
  });

  it("une pêche n'est jamais « le dernier Pokémon » du salon, ni ne retarde le suivant", async () => {
    const result = await hook();
    await dbRun(points, "UPDATE pokemon_spawns SET status = 'CAUGHT', ended_at = ? WHERE id = ?", [Date.now(), result.spawn.id]);
    assert.equal(await call(spawnModule.getLastEndedSpawn), null);
    assert.equal((await dbGet(points, "SELECT COUNT(*) AS n FROM pokemon_spawns WHERE status = 'ACTIVE'")).n, 0);
  });
});

describe("la rareté sauvage des espèces pêchables", () => {
  it("le facteur s'applique aux espèces des tables, pas aux autres, et seulement pêche ouverte", () => {
    const config = getPokemonConfig();
    const weight = (name) => data.spawnWeight(species(name), config.spawn);
    const magikarp = weight("Magicarpe");
    const rattata = weight("Rattata");
    config.fishing.wildRarityFactor = 1;
    const plain = { magikarp: weight("Magicarpe"), rattata: weight("Rattata") };
    config.fishing.wildRarityFactor = 0.7;
    try {
      assert.ok(Math.abs(magikarp - plain.magikarp * 0.7) < 1e-9, "×0,7 sur un Magicarpe");
      assert.equal(rattata, plain.rattata, "un Rattata ne se pêche pas");
      config.fishing.generation = 3;
      assert.equal(weight("Magicarpe"), plain.magikarp, "la pêche fermée ne change rien");
    } finally {
      config.fishing.generation = 2;
      config.fishing.wildRarityFactor = 0.7;
    }
  });
});
