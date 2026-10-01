// Les minuteurs : ce que le bot fait de lui-même, sans que personne ne clique. Un
// minuteur qui n'est jamais planifié, ou qui plante au premier tour, ne se voit
// pas avant des jours — l'ouverture de la génération 2, par exemple, tient à un
// minuteur d'une minute. On vérifie donc deux choses : que chaque minuteur écrit
// dans functions/handlers/ est bien planifié dans index.js, et que chacun fait son
// travail une fois lancé.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createSandbox, openDatabases, dbRun, dbAll, dbGet, sleep, withRandom, speciesByName } from "./helpers.js";

const GEN1 = { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } };
const sandbox = createSandbox({ config: GEN1 });
process.env.POKEMON_CHANNEL_ID = "123";
process.env.POKEMON_ROLE_ID = "role-pokemon";
process.env.GUILD_ID = "guild-1";
process.env.DEFAULT_ROLE_ID = "role-default";
const { points } = await openDatabases();
const data = await import("../modules/pokemon/data.js");
const species = (name) => speciesByName(data.allSpecies, name);
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const handlerFiles = fs.readdirSync(path.join(ROOT, "functions/handlers")).filter((file) => file.endsWith(".js"));

// Un bot qui garde ce que les gestionnaires y posent, et un salon qui note ce qu'on y publie.
async function loadBot({ sendFails = false } = {}) {
  const sent = [];
  const channel = {
    send: async (payload) => {
      if (sendFails) throw new Error("salon fermé");
      sent.push(payload);
      return { id: `m${sent.length}`, edit: async () => {} };
    },
    messages: { fetch: async () => ({ edit: async () => {}, embeds: [] }) },
  };
  const bot = {
    sent,
    channels: { fetch: async () => channel },
    guilds: { fetch: async () => { throw new Error("Discord ne répond pas"); } },
  };
  for (const file of handlerFiles) {
    if (file === "handleCommands.js" || file === "handleEvents.js") continue;
    (await import(`../functions/handlers/${file}`)).default(bot);
  }
  return bot;
}
const quiet = async (work) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await work();
  } finally {
    console.error = original;
  }
};

beforeEach(async () => {
  for (const table of ["pokemon_generations", "pokemon_eggs", "pokemon_owned", "pokemon_safari_parks", "pokemon_safari_sessions", "pokemon_spawns", "points", "pokemon_redistribution"]) {
    await dbRun(points, `DELETE FROM ${table}`).catch(() => {});
  }
  sandbox.writeConfig(GEN1);
});

describe("chaque minuteur est planifié", () => {
  const index = fs.readFileSync(path.join(ROOT, "index.js"), "utf8");
  const defined = handlerFiles.flatMap((file) =>
    [...fs.readFileSync(path.join(ROOT, "functions/handlers", file), "utf8").matchAll(/bot\.(handle\w+OnTimer)\s*=/g)].map((match) => ({ file, name: match[1] }))
  );

  it("on trouve les minuteurs du dépôt (le scan ne doit pas être vide)", () => {
    assert.ok(defined.length >= 8, `${defined.length} minuteurs trouvés`);
    for (const wanted of ["handlePokemonFleeOnTimer", "handleEggHatchOnTimer", "handleGenerationOpeningOnTimer", "handleSafariParkOnTimer", "handleRedistributionOnTimer", "handleRemindersOnTimer"]) {
      assert.ok(defined.some((entry) => entry.name === wanted), wanted);
    }
  });

  for (const { file, name } of defined) {
    it(`${name} est lancé par index.js`, () => {
      assert.match(index, new RegExp(`bot\\.${name}\\(\\)`), `${file} définit ${name}, que rien ne lance`);
    });
  }

  it("les minuteurs du jeu qui ne dépendent d'aucune activité tournent chaque minute ; le parc et le pot, chaque heure", () => {
    const cron = (label) => new RegExp(`schedule\\("([^"]+)", "${label}"`).exec(index)?.[1];
    for (const label of ["fuite des Pokémon", "éclosion des œufs", "ouverture des générations", "rappels"]) assert.equal(cron(label), "* * * * *", label);
    for (const label of ["parc safari", "pot commun"]) assert.equal(cron(label), "0 * * * *", label);
  });
});

describe("l'ouverture d'une génération (minuteur d'une minute)", () => {
  const announcements = (bot) => bot.sent.filter((payload) => payload.embeds?.[0]?.toJSON().title?.includes("génération est ouverte"));

  it("rien à dire tant que la génération 2 est fermée", async () => {
    const bot = await loadBot();
    await bot.handleGenerationOpeningOnTimer();
    assert.deepEqual(bot.sent, []);
  });

  it("à l'heure dite, la génération s'annonce une seule fois, avec le rôle du jeu", async () => {
    sandbox.writeConfig({ pokemon: { generationOpenings: { 2: new Date(Date.now() - 60_000).toISOString() } } });
    const bot = await loadBot();
    await bot.handleGenerationOpeningOnTimer();
    await bot.handleGenerationOpeningOnTimer();
    await bot.handleGenerationOpeningOnTimer();
    const [announcement] = announcements(bot);
    assert.equal(announcements(bot).length, 1, "annoncée une seule fois malgré trois passages");
    assert.equal(announcement.content, "<@&role-pokemon>");
    assert.match(announcement.embeds[0].toJSON().description, /100\*\* nouvelles espèces/);
  });

  it("deux processus qui passent en même temps : une seule annonce", async () => {
    sandbox.writeConfig({ pokemon: { generationOpenings: { 2: new Date(Date.now() - 1000).toISOString() } } });
    const bot = await loadBot();
    await Promise.all([bot.handleGenerationOpeningOnTimer(), bot.handleGenerationOpeningOnTimer(), bot.handleGenerationOpeningOnTimer()]);
    assert.equal(announcements(bot).length, 1);
  });

  it("un salon qui refuse l'annonce ne la répète pas chaque minute", async () => {
    sandbox.writeConfig({ pokemon: { generationOpenings: { 2: new Date(Date.now() - 1000).toISOString() } } });
    const broken = await loadBot({ sendFails: true });
    await quiet(() => broken.handleGenerationOpeningOnTimer());
    const healthy = await loadBot();
    await healthy.handleGenerationOpeningOnTimer();
    assert.equal(announcements(healthy).length, 0);
    assert.equal((await dbAll(points, "SELECT generation FROM pokemon_generations")).length, 1);
  });

  it("le jeu désactivé n'annonce rien", async () => {
    sandbox.writeConfig({ pokemon: { enabled: false, generationOpenings: { 2: new Date(Date.now() - 1000).toISOString() } } });
    const bot = await loadBot();
    await bot.handleGenerationOpeningOnTimer();
    assert.deepEqual(bot.sent, []);
  });
});

describe("l'éclosion des œufs (minuteur d'une minute)", () => {
  it("fait éclore l'œuf dont l'échéance est passée, et seulement lui", async () => {
    sandbox.writeConfig({ pokemon: { generation: 2 } });
    const egg = async (user, hatchAt) => {
      await dbRun(points, "INSERT INTO pokemon_eggs (user_id, species_id, father_species_id, mother_species_id, shiny_parents, status, messages, hatch_messages, laid_at, hatch_at) VALUES (?, ?, ?, ?, 0, 'INCUBATING', 0, 200, ?, ?)", [user, species("Pichu").id, species("Pikachu").id, species("Pikachu").id, Date.now() - 1000, hatchAt]);
    };
    await egg("u1", Date.now() - 10);
    await egg("u2", Date.now() + 3_600_000);
    const bot = await loadBot();
    bot.handleEggHatchOnTimer();
    await sleep(300);
    assert.equal((await dbGet(points, "SELECT status FROM pokemon_eggs WHERE user_id = 'u1'")).status, "HATCHED");
    assert.equal((await dbGet(points, "SELECT status FROM pokemon_eggs WHERE user_id = 'u2'")).status, "INCUBATING");
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_owned WHERE user_id = 'u1' AND origin = 'oeuf'")).length, 1);
    assert.equal(bot.sent.length, 1);
  });
});

describe("le parc safari (minuteur horaire)", () => {
  const parks = () => dbAll(points, "SELECT status FROM pokemon_safari_parks");

  it("le tirage horaire ouvre un parc quand la chance le veut, pas sinon", async () => {
    const bot = await loadBot();
    await withRandom(0.99, () => bot.handleSafariParkOnTimer());
    assert.deepEqual(await parks(), []);
    await withRandom(0, () => bot.handleSafariParkOnTimer());
    assert.deepEqual((await parks()).map((park) => park.status), ["OPEN"]);
    assert.equal(bot.sent.length, 1, "le parc est annoncé");
  });

  it("un parc dont la durée est écoulée est fermé au passage suivant, avant tout nouveau tirage", async () => {
    await dbRun(points, "INSERT INTO pokemon_safari_parks (status, opened_at, expires_at, reserved_for) VALUES ('OPEN', ?, ?, NULL)", [Date.now() - 7_200_000, Date.now() - 1000]);
    const bot = await loadBot();
    await withRandom(0.99, () => bot.handleSafariParkOnTimer());
    assert.deepEqual((await parks()).map((park) => park.status), ["CLOSED"]);
  });

  it("une visite dont le parc est fermé est close aussi", async () => {
    await dbRun(points, "INSERT INTO pokemon_safari_parks (status, opened_at, expires_at, reserved_for) VALUES ('OPEN', ?, ?, NULL)", [Date.now() - 7_200_000, Date.now() - 1000]);
    await dbRun(points, "INSERT INTO pokemon_safari_sessions (user_id, status, actions_left, started_at, expires_at, park_id, encounter_species_id, encounter_catch_rate) VALUES ('u1', 'ACTIVE', 10, ?, ?, 1, ?, 100)", [Date.now() - 7_000_000, Date.now() - 500, species("Roucool").id]);
    const bot = await loadBot();
    await withRandom(0.99, () => bot.handleSafariParkOnTimer());
    assert.notEqual((await dbGet(points, "SELECT status FROM pokemon_safari_sessions WHERE user_id = 'u1'")).status, "ACTIVE");
  });

  it("désactivé par la configuration : aucun tirage", async () => {
    sandbox.writeConfig({ pokemon: { ...GEN1.pokemon, safari: { enabled: false } } });
    const bot = await loadBot();
    await withRandom(0, () => bot.handleSafariParkOnTimer());
    assert.deepEqual(await parks(), []);
  });
});

describe("le pot commun et les autres minuteurs ne propagent jamais une erreur", () => {
  it("un serveur injoignable est journalisé, le minuteur reste vivant", async () => {
    sandbox.writeConfig({ pokemon: GEN1.pokemon, redistribution: { enabled: true, intervalHours: 1 } });
    const bot = await loadBot();
    await quiet(async () => {
      await bot.handleRedistributionOnTimer();
      await bot.handleRedistributionOnTimer();
    });
  });

  it("les minuteurs du jeu s'exécutent à vide sans rien casser", async () => {
    const bot = await loadBot();
    await quiet(async () => {
      await bot.handlePokemonFleeOnTimer();
      bot.handleEggHatchOnTimer();
      await bot.handleGenerationOpeningOnTimer();
      await bot.handleSafariParkOnTimer();
    });
    assert.deepEqual(await dbAll(points, "SELECT id FROM pokemon_spawns"), []);
  });
});
