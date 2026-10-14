// Le starter de génération : un choix définitif à l'ouverture de la génération 2,
// puis des évolutions en récompense à 33 %, 66 % et 100 % du Pokédex (hors
// légendaires), chacune donnée une fois, rattrapée si le choix vient tard.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbAll, dbGet, eventually, sleep } from "./helpers.js";

createSandbox({ config: { pokemon: { generationOpenings: { 2: "2000-01-01T00:00:00+01:00" } } } });
const { points } = await openDatabases();
const starters = await import("../modules/pokemon/starters.js");
const { charmSpecies } = await import("../modules/pokemon/charms.js");
const data = await import("../modules/pokemon/data.js");

const call = (fn, ...args) =>
  new Promise((resolve, reject) =>
    fn(...args, (error, ...rest) => (error ? reject(error) : resolve(rest.length > 1 ? rest : rest[0])))
  );
const species = (name) => data.allSpecies().find((entry) => entry.name === name);
const [GERMIGNON, HERICENDRE, KAIMINUS] = [152, 155, 158];

// Donne des espèces directement en base : les tests lancent la vérification eux-mêmes,
// sans celle que creditSpecies lance à son tour.
async function own(speciesId, { user = "u1", shiny = 0 } = {}) {
  await dbRun(
    points,
    `INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, sterile, obtained_at, locked)
     VALUES (?, ?, ?, 'M', 'test', 0, 1, 0)`,
    [user, speciesId, shiny]
  );
}
const ownedIds = async (user = "u1") => (await dbAll(points, "SELECT species_id, is_shiny, origin FROM pokemon_owned WHERE user_id = ? ORDER BY id", [user]));
const rewards = (user = "u1") => dbAll(points, "SELECT percent FROM pokemon_starter_rewards WHERE user_id = ? ORDER BY percent", [user]);
const choose = (speciesId, user = "u1", generation = 2) => call(starters.chooseStarter, user, generation, speciesId);
const check = (user = "u1") => call(starters.checkStarterRewards, user);

// Les espèces de la génération 2 qui comptent, hors les lignées des trois starters :
// de quoi régler le pourcentage sans que les récompenses faussent le compte.
const counted = () => charmSpecies(2);
const outsideLines = () => {
  const lines = new Set();
  for (const id of [GERMIGNON, HERICENDRE, KAIMINUS]) {
    for (let current = data.getSpecies(id), guard = 0; current && guard < 4; guard++) {
      lines.add(current.id);
      current = data.getSpecies(current.evolvesInto?.[0]);
    }
  }
  return counted().filter((entry) => !lines.has(entry.id));
};

beforeEach(async () => {
  await dbRun(points, "DROP TRIGGER IF EXISTS panne");
  for (const table of ["pokemon_owned", "pokemon_starters", "pokemon_starter_rewards", "pokemon_inventory"]) {
    await dbRun(points, `DELETE FROM ${table}`);
  }
});

describe("choisir son starter", () => {
  it("donne le stade 1 tout de suite, et le choix est définitif", async () => {
    const result = await choose(HERICENDRE);
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.species.id, HERICENDRE);
    assert.deepEqual(await ownedIds(), [{ species_id: HERICENDRE, is_shiny: 0, origin: "starter" }]);
    assert.equal((await dbGet(points, "SELECT species_id FROM pokemon_starters WHERE user_id = 'u1' AND generation = 2")).species_id, HERICENDRE);

    const again = await choose(KAIMINUS);
    assert.equal(again.ok, false);
    assert.match(again.reason, /Tu as déjà choisi \*\*Héricendre\*\* pour la 2e génération : le choix est définitif/);
    assert.equal((await ownedIds()).length, 1, "aucun second starter");
    assert.equal((await dbGet(points, "SELECT species_id FROM pokemon_starters WHERE user_id = 'u1'")).species_id, HERICENDRE);
  });

  it("refuse une génération sans starter, un Pokémon qui n'en est pas un, et rien n'est écrit", async () => {
    assert.match((await choose(1, "u1", 1)).reason, /ne propose pas de starter/);
    assert.match((await choose(species("Rattata").id)).reason, /n'est pas l'un des starters proposés/);
    assert.match((await choose(GERMIGNON, "u1", 3)).reason, /ne propose pas de starter/);
    assert.deepEqual(await ownedIds(), []);
    assert.equal((await dbAll(points, "SELECT * FROM pokemon_starters")).length, 0);
  });

  it("deux choix simultanés : un seul passe, un seul Pokémon est donné", async () => {
    const results = await Promise.all([choose(GERMIGNON), choose(KAIMINUS)]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal((await ownedIds()).length, 1);
    assert.equal((await dbAll(points, "SELECT * FROM pokemon_starters")).length, 1);
  });

  it("un don qui échoue retire le choix : on peut recommencer, rien n'est perdu ni créé", async () => {
    await dbRun(points, "CREATE TRIGGER panne BEFORE INSERT ON pokemon_owned BEGIN SELECT RAISE(ABORT, 'panne'); END");
    await assert.rejects(() => choose(GERMIGNON), /panne/);
    await dbRun(points, "DROP TRIGGER panne");
    assert.equal((await dbAll(points, "SELECT * FROM pokemon_starters")).length, 0);
    assert.deepEqual(await ownedIds(), []);
    assert.equal((await choose(KAIMINUS)).ok, true, "le choix n'a pas été consommé par la panne");
  });

  it("les générations proposées : la 2 seulement, jamais la 1", () => {
    assert.deepEqual(starters.starterGenerations(), [2]);
    assert.deepEqual(starters.starterChoices(2).map((entry) => entry.id), [GERMIGNON, HERICENDRE, KAIMINUS]);
    assert.deepEqual(starters.starterChoices(1), []);
  });
});

describe("le rattrapage au démarrage", () => {
  it("un choix revendiqué sans Pokémon (coupure) reçoit son stade 1 ; un choix complet n'en reçoit pas de plus", async () => {
    await dbRun(points, "INSERT INTO pokemon_starters (user_id, generation, species_id, chosen_at) VALUES ('u1', 2, ?, 1)", [KAIMINUS]);
    await choose(HERICENDRE, "u2");
    const client = { channels: { fetch: async () => null }, guilds: { fetch: async () => null } };
    starters.repairStarters(client);
    await eventually(async () => assert.deepEqual((await ownedIds("u1")).map((row) => row.species_id), [KAIMINUS]));
    await sleep(150);
    assert.equal((await ownedIds("u2")).length, 1, "u2 avait déjà son starter");
    starters.repairStarters(client);
    await sleep(150);
    assert.equal((await ownedIds("u1")).length, 1, "un second passage ne redonne rien");
  });
});

describe("les paliers du Pokédex", () => {
  it("chaque palier se donne une seule fois, à son pourcentage, de la lignée du starter", async () => {
    await choose(GERMIGNON);
    const pool = outsideLines();
    const total = counted().length;
    let next = 0;
    const haveNow = async () => new Set((await ownedIds()).map((row) => row.species_id)).size;
    // Ajoute des espèces une à une tant que le palier n'est pas atteint, ou, avec
    // `justBelow`, tant que la suivante ne l'atteindrait pas.
    const fill = async (percent, { justBelow = false } = {}) => {
      for (;;) {
        const have = await haveNow();
        if (justBelow ? starters.tierReached({ have: have + 1, total }, percent) : starters.tierReached({ have, total }, percent)) return;
        await own(pool[next++].id);
      }
    };

    await fill(33, { justBelow: true });
    assert.deepEqual(await check(), [], "pas encore 33 %");

    await fill(33);
    const first = await check();
    assert.deepEqual(first.map((entry) => [entry.percent, entry.species.name, entry.shiny]), [[33, "Macronium", false]]);
    assert.deepEqual(await check(), [], "le palier ne se redonne pas");
    assert.deepEqual((await rewards()).map((row) => row.percent), [33]);

    await fill(66);
    const second = await check();
    assert.deepEqual(second.map((entry) => [entry.percent, entry.species.name]), [[66, "Méganium"]]);

    // Il reste les lignées des deux autres starters, que le palier final demande aussi.
    for (const id of [HERICENDRE, 156, 157, KAIMINUS, 159, 160]) await own(id);
    await fill(100);
    const third = await check();
    assert.deepEqual(third.map((entry) => [entry.percent, entry.species.name, entry.shiny]), [[100, "Germignon", true]]);
    const shiny = (await ownedIds()).filter((row) => row.is_shiny);
    assert.deepEqual(shiny.map((row) => row.species_id), [GERMIGNON], "le stade 1 shiny, en plus du normal");
    assert.deepEqual((await rewards()).map((row) => row.percent), [33, 66, 100]);
    assert.deepEqual(await check(), []);
  });

  it("un choix tardif rattrape tous les paliers déjà atteints d'un coup", async () => {
    for (const entry of outsideLines()) await own(entry.id);
    for (const id of [HERICENDRE, 156, 157]) await own(id);
    // Le Pokédex est presque complet : seules les lignées des deux autres starters manquent.
    for (const id of [GERMIGNON, 153, 154, KAIMINUS, 159, 160]) await own(id);
    const result = await choose(HERICENDRE);
    assert.equal(result.ok, true);
    assert.deepEqual(result.rewards.map((entry) => entry.percent), [33, 66, 100]);
    assert.deepEqual((await rewards()).map((row) => row.percent), [33, 66, 100]);
    assert.ok((await ownedIds()).some((row) => row.species_id === HERICENDRE && row.is_shiny === 1), "le shiny du palier final");
  });

  it("un don de palier qui échoue retire sa revendication : le passage suivant le donne", async () => {
    await choose(KAIMINUS);
    for (const entry of outsideLines()) await own(entry.id);
    await dbRun(points, "CREATE TRIGGER panne BEFORE INSERT ON pokemon_owned WHEN NEW.origin = 'starter' BEGIN SELECT RAISE(ABORT, 'panne'); END");
    assert.deepEqual(await check(), [], "aucun palier donné pendant la panne");
    assert.equal((await rewards()).length, 0, "aucune revendication ne reste");
    await dbRun(points, "DROP TRIGGER panne");
    const retry = await check();
    assert.ok(retry.length >= 1, "le palier manquant est rattrapé");
    assert.equal(new Set(retry.map((entry) => entry.percent)).size, retry.length, "chaque palier une seule fois");
  });

  it("sans starter choisi, aucun palier : compléter le Pokédex ne donne rien", async () => {
    for (const entry of counted()) await own(entry.id);
    assert.deepEqual(await check(), []);
    assert.equal((await rewards()).length, 0);
  });

  it("les légendaires ne comptent pas, et les générations fermées ne donnent rien", async () => {
    assert.ok(counted().every((entry) => !data.isLegendary(entry)));
    assert.equal(starters.tierReached({ have: 0, total: 0 }, 33), false, "un Pokédex sans espèce ne récompense personne");
    assert.equal(starters.tierReached({ have: 33, total: 100 }, 33), true);
    assert.equal(starters.tierReached({ have: 32, total: 100 }, 33), false);
  });

  it("un réglage à chaud absurde ne donne rien : stade manquant, pourcentage nul, doublon", async () => {
    const config = await import("../modules/pokemon/config.js");
    assert.deepEqual(starters.starterTiers().map((tier) => tier.percent), [33, 66, 100]);
    const original = config.getPokemonConfig().starters.rewards;
    try {
      config.getPokemonConfig().starters.rewards = [
        { percent: 33, shiny: false },
        { percent: 0, stage: 2 },
        { percent: 150, stage: 2 },
        { percent: 50, stage: 2 },
        { percent: 50, stage: 3 },
      ];
      assert.deepEqual(starters.starterTiers(), [{ percent: 50, stage: 2 }], "un seul palier valide, le premier à ce pourcentage");
    } finally {
      config.getPokemonConfig().starters.rewards = original;
    }
  });

  it("lineageAt suit la lignée, sans dépendre de ce que le jeu a ouvert", () => {
    const start = data.getSpecies(GERMIGNON);
    assert.deepEqual([1, 2, 3].map((stage) => starters.lineageAt(start, stage)?.name), ["Germignon", "Macronium", "Méganium"]);
    assert.equal(starters.lineageAt(start, 4), null);
  });
});
