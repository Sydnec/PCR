// Les apparitions : la durée de vie tirée à la naissance d'un Pokémon, et la
// revendication du droit d'en faire apparaître un — une seule instruction SQL
// gardée, dont dépend l'absence de double apparition.
import { describe, it, beforeEach, before } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbGet, sleep, eventually, eventuallyStable, withRandom } from "./helpers.js";

const sandbox = createSandbox({
  config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } },
});
process.env.POKEMON_CHANNEL_ID = "123";
const { points } = await openDatabases();
const { registerMessageForSpawn, rollFleeDeadline } = await import("../modules/pokemon/spawn.js");
const { getPokemonConfig } = await import("../modules/pokemon/config.js");

const MINUTE = 60 * 1000;
const spawnConfig = () => getPokemonConfig().spawn;

describe("durée de vie d'un Pokémon", () => {
  const flee = { min: 45, max: 90 };
  const minutes = (random, rarity, config = { fleeAfterMinutes: flee, legendaryFleeMultiplier: 2 }) =>
    withRandom(random, () => rollFleeDeadline(0, config, rarity)) / MINUTE;

  it("tombe dans la fourchette réglée, bornes comprises", () => {
    assert.equal(minutes(0, "COMMUN"), 45);
    assert.ok(Math.abs(minutes(0.999999, "COMMUN") - 90) < 0.001);
    assert.ok(Math.abs(minutes(0.5, "RARE") - 67.5) < 1e-9);
  });

  it("part de l'instant de l'apparition", () => {
    const at = 1_000_000;
    const deadline = withRandom(0, () => rollFleeDeadline(at, { fleeAfterMinutes: flee }, "COMMUN"));
    assert.equal(deadline, at + 45 * MINUTE);
  });

  it("un légendaire reste deux fois plus longtemps, minimum comme maximum", () => {
    assert.equal(minutes(0, "LEGENDAIRE"), 90);
    assert.ok(Math.abs(minutes(0.999999, "LEGENDAIRE") - 180) < 0.001);
  });

  it("sans rareté, le facteur ne joue pas", () => {
    assert.equal(minutes(0, null), 45);
    assert.equal(minutes(0, undefined), 45);
  });

  it("un facteur réglable : ×3 donne 135 à 270 minutes", () => {
    const config = { fleeAfterMinutes: flee, legendaryFleeMultiplier: 3 };
    assert.equal(minutes(0, "LEGENDAIRE", config), 135);
    assert.ok(Math.abs(minutes(0.999999, "LEGENDAIRE", config) - 270) < 0.001);
  });

  it("un facteur sous 1 ou illisible ne raccourcit jamais un légendaire", () => {
    for (const bad of [0, 0.5, -2, "abc", undefined]) {
      const config = { fleeAfterMinutes: flee, legendaryFleeMultiplier: bad };
      assert.equal(minutes(0, "LEGENDAIRE", config), 45, `facteur ${bad}`);
    }
  });

  it("accepte une fourchette donnée à l'envers", () => {
    const config = { fleeAfterMinutes: { min: 90, max: 45 } };
    assert.equal(minutes(0, "COMMUN", config), 45);
    assert.ok(Math.abs(minutes(0.999999, "COMMUN", config) - 90) < 0.001);
  });

  it("avec les réglages du jeu, un légendaire dépasse toujours la durée minimale d'un autre", () => {
    const { fleeAfterMinutes, legendaryFleeMultiplier } = spawnConfig();
    assert.ok(fleeAfterMinutes.min * legendaryFleeMultiplier > fleeAfterMinutes.min);
  });
});

describe("revendication d'une apparition (registerMessageForSpawn)", () => {
  let fetches;
  const client = {
    channels: {
      fetch: async () => {
        fetches += 1;
        // Salon introuvable : doSpawn libère aussitôt son verrou, sans rien poster.
        return null;
      },
    },
  };

  before(() => sleep(0));

  // Un état précis : le seuil de messages et le délai sont atteints, sauf ce que le
  // scénario précise. `message_count` repart de zéro quand le droit est revendiqué.
  async function arrange({ active = null, count = 1000, lastSpawnAgo = 60 * MINUTE, paused = 0, locked = 0 }) {
    await dbRun(points, "DELETE FROM pokemon_spawns");
    if (active) {
      await dbRun(
        points,
        `INSERT INTO pokemon_spawns (species_id, catch_rate, rarity, status, spawned_at, flees_at, message_id)
         VALUES (150, 3, ?, 'ACTIVE', 1, 9999999999999, 'm')`,
        [active]
      );
    }
    await dbRun(
      points,
      `UPDATE pokemon_state SET message_count = ?, last_spawn_at = ?, spawning = ?, spawn_paused_until = ? WHERE id = 1`,
      [count, Date.now() - lastSpawnAgo, locked, paused]
    );
    fetches = 0;
  }

  const readState = () => dbGet(points, "SELECT message_count, last_spawn_at, spawning FROM pokemon_state WHERE id = 1");

  // Un message, puis le temps que la cascade de rappels se termine : le verrou
  // revient à 0 quand doSpawn a fini, et c'est l'état stable qu'on observe. Pas de
  // durée fixe : on attend que le message ait eu un effet (le compteur bouge, ou un
  // salon est sollicité), puis que l'état ne bouge plus pendant un court répit.
  async function message() {
    const before = (await readState()).message_count;
    registerMessageForSpawn(client);
    await eventually(async () => {
      assert.ok((await readState()).message_count !== before || fetches > 0, "le message n'a encore eu aucun effet");
    });
    let last = JSON.stringify(await readState());
    for (let since = Date.now(); Date.now() - since < 100; ) {
      await sleep(20);
      const now = JSON.stringify(await readState());
      if (now !== last) {
        last = now;
        since = Date.now();
      }
    }
    return JSON.parse(last);
  }
  const claimed = (state) => state.message_count === 0;

  beforeEach(() => dbRun(points, "DELETE FROM pokemon_spawns"));

  it("un salon vide reçoit un Pokémon au message suivant", async () => {
    await arrange({ count: 0, lastSpawnAgo: 0 });
    assert.equal(claimed(await message()), true);
    assert.equal(fetches, 1);
  });

  it("un Pokémon ordinaire est remplacé quand le seuil et le délai sont atteints", async () => {
    await arrange({ active: "COMMUN" });
    assert.equal(claimed(await message()), true);
    assert.equal(fetches, 1);
  });

  it("un légendaire, lui, n'est jamais chassé par les messages", async () => {
    await arrange({ active: "LEGENDAIRE" });
    const state = await message();
    assert.equal(claimed(state), false);
    assert.equal(fetches, 0);
    assert.ok(state.message_count >= 1000, "le compteur continue de monter");
  });

  it("même après des milliers de messages, un légendaire reste", async () => {
    await arrange({ active: "LEGENDAIRE", count: 50_000 });
    assert.equal(claimed(await message()), false);
    assert.equal(fetches, 0);
  });

  it("le légendaire parti, le message suivant fait apparaître le prochain", async () => {
    await arrange({ active: "LEGENDAIRE" });
    assert.equal(claimed(await message()), false);
    await dbRun(points, "UPDATE pokemon_spawns SET status = 'FLED', ended_at = ?", [Date.now() - 1000]);
    assert.equal(claimed(await message()), true);
    assert.equal(fetches, 1);
  });

  it("sous le seuil de messages, rien ne bouge", async () => {
    const needed = spawnConfig().messagesPerSpawn;
    await arrange({ active: "COMMUN", count: 0 });
    for (let i = 0; i < needed - 2; i++) await message();
    const state = await dbGet(points, "SELECT message_count FROM pokemon_state WHERE id = 1");
    assert.equal(state.message_count, needed - 2);
    assert.equal(fetches, 0);
  });

  it("le seuil atteint, c'est le message suivant qui remplace", async () => {
    const needed = spawnConfig().messagesPerSpawn;
    await arrange({ active: "COMMUN", count: needed - 1 });
    assert.equal(claimed(await message()), true);
  });

  it("le délai minimum protège un Pokémon qui vient d'apparaître", async () => {
    await arrange({ active: "COMMUN", lastSpawnAgo: 0 });
    assert.equal(claimed(await message()), false);
    assert.equal(fetches, 0);
  });

  it("un parc safari en cours suspend les apparitions, salon vide compris", async () => {
    await arrange({ count: 0, lastSpawnAgo: 0, paused: Date.now() + 60 * MINUTE });
    assert.equal(claimed(await message()), false);
    assert.equal(fetches, 0);
  });

  it("la pause terminée, les apparitions reprennent sans attendre le seuil", async () => {
    await arrange({ count: 0, lastSpawnAgo: 0, paused: Date.now() - 1 });
    assert.equal(claimed(await message()), true);
  });

  it("un verrou déjà pris interdit une seconde revendication", async () => {
    await arrange({ count: 1000, locked: 1 });
    registerMessageForSpawn(client);
    await sleep(300);
    assert.equal(fetches, 0);
  });

  it("dix messages simultanés ne font apparaître qu'un seul Pokémon", async () => {
    await arrange({ active: "COMMUN" });
    for (let i = 0; i < 10; i++) registerMessageForSpawn(client);
    await eventuallyStable(() => assert.equal(fetches, 1));
  });

  it("une apparition désactivée ne compte même pas les messages", async () => {
    await arrange({ active: "COMMUN", count: 5 });
    sandbox.writeConfig({ pokemon: { enabled: false } });
    try {
      registerMessageForSpawn(client);
      await sleep(300);
    } finally {
      sandbox.writeConfig({ pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } });
    }
    const state = await dbGet(points, "SELECT message_count FROM pokemon_state WHERE id = 1");
    assert.equal(state.message_count, 5);
    assert.equal(fetches, 0);
  });
});
