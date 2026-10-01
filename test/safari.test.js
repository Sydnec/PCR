// Les actions du parc safari : lancer, appâter, fuir. Chaque action décompte une
// action de la visite par une écriture gardée, puis tire au sort : le hasard est
// figé pour regarder exactement où passent les seuils.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbGet, dbAll, withRandom, speciesByName } from "./helpers.js";

createSandbox({ config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } } });
const { points } = await openDatabases();
const { playAction } = await import("../modules/pokemon/safari.js");
const data = await import("../modules/pokemon/data.js");
const { getSafariConfig } = await import("../modules/pokemon/config.js");

const safari = () => getSafariConfig();
const id = (name) => speciesByName(data.allSpecies, name).id;
const ACTIONS = 25;

async function seed({ species = "Bulbizarre", bait = 0, actions = ACTIONS, shiny = 0, rate = null, user = "u1" } = {}) {
  await dbRun(points, "DELETE FROM pokemon_safari_sessions");
  await dbRun(points, "DELETE FROM pokemon_owned");
  await dbRun(points, "DELETE FROM pokemon_safari_catches");
  await dbRun(
    points,
    `INSERT INTO pokemon_safari_sessions
       (id, user_id, status, actions_left, started_at, expires_at, encounter_no,
        encounter_species_id, encounter_is_shiny, encounter_catch_rate, encounter_bait)
     VALUES (1, ?, 'ACTIVE', ?, 1, ?, 1, ?, ?, ?, ?)`,
    [user, actions, Date.now() + 3_600_000, id(species), shiny, rate ?? data.getSpecies(id(species)).catchRate, bait]
  );
}
const own = (name, shiny = 0, count = 1) =>
  Promise.all(
    Array.from({ length: count }, () =>
      dbRun(
        points,
        "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, origin, obtained_at) VALUES ('u1', ?, ?, 'test', 1)",
        [id(name), shiny]
      )
    )
  );
const session = () => dbGet(points, "SELECT * FROM pokemon_safari_sessions WHERE id = 1");

// Une action SANS toucher au hasard : à envelopper dans withRandom quand plusieurs
// partent ensemble (deux withRandom imbriqués se rendraient un hasard truqué).
const playRaw = async (action, { user = "u1", token = null } = {}) => {
  const row = await session();
  return new Promise((resolve, reject) =>
    playAction(user, 1, String(token ?? row.actions_left), action, (error, result) =>
      error ? reject(error) : resolve(result)
    )
  );
};

// Une action, avec ce que le hasard tire : une valeur, ou une suite.
const play = (action, random, options) => withRandom(random, () => playRaw(action, options));

describe("appâter", () => {
  beforeEach(() => seed());

  it("le premier appât risque la nervosité d'AVANT la baie : 5 %", async () => {
    assert.equal((await play("BAIT", 0.04)).outcome, "BAIT_FLED");
    await seed();
    assert.equal((await play("BAIT", 0.06)).outcome, "BAIT", "6 % : le premier appât a passé");
  });

  it("le second appât risque 8 %, celui de la nervosité acquise au premier", async () => {
    await seed({ bait: 1 });
    assert.equal((await play("BAIT", 0.07)).outcome, "BAIT_FLED");
    await seed({ bait: 1 });
    assert.equal((await play("BAIT", 0.09)).outcome, "BAIT");
  });

  it("le risque annoncé après le premier appât est celui de la prochaine action", async () => {
    const result = await play("BAIT", 0.99);
    assert.equal(result.outcome, "BAIT");
    assert.equal(result.baitStacks, 1);
    const wild = safari().wildFleeChance;
    const perBait = safari().wildFleeChancePerBait;
    assert.ok(Math.abs(data.safariFleeChance(result.baitStacks, safari()) - (wild + perBait)) < 1e-9);
  });

  it("monte le facteur, et donc les chances, avec les appâts avalés", async () => {
    const first = await play("BAIT", 0.99);
    assert.ok(first.probability > data.safariCatchProbability(first.session.encounter_catch_rate, 0, safari()));
    const second = await play("BAIT", 0.99);
    assert.equal(second.baitStacks, 2);
    assert.ok(second.probability > first.probability);
  });

  it("un appât qui fait fuir passe à la rencontre suivante, appâts remis à zéro", async () => {
    await seed({ bait: 1 });
    const result = await play("BAIT", [0.01, 0.99]);
    assert.equal(result.outcome, "BAIT_FLED");
    const row = await session();
    assert.equal(row.encounter_bait, 0);
    assert.equal(row.encounter_no, 2);
  });

  it("au plafond, un appât de plus est refusé SANS consommer d'action", async () => {
    await seed({ bait: 2 });
    const result = await play("BAIT", 0.99);
    assert.equal(result.ok, false);
    assert.match(result.reason, /n'a plus faim/);
    const row = await session();
    assert.equal(row.actions_left, ACTIONS);
    assert.equal(row.baits_used, 0);
  });
});

describe("lancer la Safari Ball", () => {
  beforeEach(() => seed());

  it("capture quand le tirage passe sous la probabilité, et crédite la boîte", async () => {
    const result = await play("BALL", 0);
    assert.equal(result.outcome, "CATCH");
    const owned = await dbAll(points, "SELECT species_id, is_shiny, origin FROM pokemon_owned");
    assert.deepEqual(owned, [{ species_id: id("Bulbizarre"), is_shiny: 0, origin: "safari" }]);
    const row = await session();
    assert.equal(row.catches, 1);
    assert.equal(row.encounter_no, 2, "la rencontre suivante est tirée");
    assert.equal(row.encounter_bait, 0);
    assert.equal((await dbAll(points, "SELECT * FROM pokemon_safari_catches")).length, 1);
  });

  it("un shiny rencontré est un shiny capturé", async () => {
    await seed({ shiny: 1 });
    await play("BALL", 0);
    const owned = await dbAll(points, "SELECT is_shiny FROM pokemon_owned");
    assert.deepEqual(owned, [{ is_shiny: 1 }]);
  });

  it("rate quand le tirage dépasse la probabilité", async () => {
    const result = await play("BALL", [0.999, 0.999]);
    assert.equal(result.outcome, "MISS");
    assert.equal((await dbAll(points, "SELECT * FROM pokemon_owned")).length, 0);
  });

  it("un raté peut faire détaler : 5 % sans appât", async () => {
    assert.equal((await play("BALL", [0.999, 0.04])).outcome, "MISS_FLED");
    await seed();
    assert.equal((await play("BALL", [0.999, 0.06])).outcome, "MISS");
  });

  it("un raté après deux appâts risque 11 %", async () => {
    await seed({ bait: 2 });
    assert.equal((await play("BALL", [0.999, 0.1])).outcome, "MISS_FLED");
    await seed({ bait: 2 });
    assert.equal((await play("BALL", [0.999, 0.12])).outcome, "MISS");
  });

  it("une capture ne déclenche jamais de fuite : le tirage de fuite n'a lieu qu'après un raté", async () => {
    const result = await play("BALL", [0, 0]);
    assert.equal(result.outcome, "CATCH");
  });

  it("le plancher de capture joue dans le vrai tirage : un taux 3 est capturé comme un taux 10", async () => {
    const floor = data.safariCatchProbability(3, 0, safari());
    const raw = (3 * safari().ball.multiplier) / 765;
    assert.ok(floor > raw);
    const between = (floor + raw) / 2 + (floor - raw) / 2 - 1e-6; // juste sous le seuil du plancher
    assert.ok(between > raw && between < floor);
    await seed({ rate: 3 });
    assert.equal((await play("BALL", between)).outcome, "CATCH", "capturé grâce au plancher");
    await seed({ rate: 3 });
    assert.equal((await play("BALL", [floor + 1e-6, 0.99])).outcome, "MISS", "au-dessus, raté");
  });

  it("deux appâts multiplient le taux du plancher, pas le taux brut", async () => {
    await seed({ rate: 3, bait: 2 });
    const probability = data.safariCatchProbability(3, 2, safari());
    assert.ok(probability > (3 * safari().ball.multiplier * 4) / 765);
    assert.equal((await play("BALL", probability - 1e-6)).outcome, "CATCH");
  });
});

describe("fuir", () => {
  beforeEach(() => seed());

  it("passe au Pokémon suivant", async () => {
    const result = await play("FLEE", 0.99);
    assert.equal(result.outcome, "FLED");
    assert.equal((await session()).encounter_no, 2);
  });

  it("peut échouer, et la rencontre reste en place", async () => {
    const result = await play("FLEE", 0.01);
    assert.equal(result.outcome, "FLEE_FAILED");
    const row = await session();
    assert.equal(row.encounter_no, 1);
    assert.equal(row.encounter_species_id, id("Bulbizarre"));
  });
});

describe("décompte des actions et garde-fous", () => {
  beforeEach(() => seed());

  it("chaque action coûte exactement une action et compte dans son geste", async () => {
    await play("BAIT", 0.99);
    await play("BALL", [0.999, 0.99]);
    await play("FLEE", 0.99);
    const row = await session();
    assert.equal(row.actions_left, ACTIONS - 3);
    assert.equal(row.baits_used, 1);
    assert.equal(row.balls_thrown, 1);
    assert.equal(row.flees, 1);
  });

  it("un double clic ne joue qu'une fois : le jeton est le nombre d'actions restantes", async () => {
    const [first, second] = await withRandom(0.999, () =>
      Promise.all([
        playRaw("BALL", { token: ACTIONS }),
        playRaw("BALL", { token: ACTIONS }),
      ])
    );
    const refused = [first, second].filter((result) => result.ok === false);
    assert.equal(refused.length, 1, "l'un des deux est refusé");
    assert.equal((await session()).actions_left, ACTIONS - 1);
  });

  it("un jeton périmé est refusé sans rien consommer", async () => {
    const result = await play("BALL", 0.99, { token: ACTIONS + 5 });
    assert.equal(result.ok, false);
    assert.equal((await session()).actions_left, ACTIONS);
  });

  it("la visite d'un autre n'est pas jouable", async () => {
    const result = await play("BALL", 0.99, { user: "intrus" });
    assert.equal(result.ok, false);
    assert.match(result.reason, /pas la tienne/);
    assert.equal((await session()).actions_left, ACTIONS);
  });

  it("une visite terminée refuse toute action", async () => {
    await dbRun(points, "UPDATE pokemon_safari_sessions SET status = 'FINISHED'");
    const result = await play("BALL", 0.99);
    assert.equal(result.ok, false);
    assert.match(result.reason, /terminée/);
  });

  it("une action inconnue est une erreur, pas un tirage", async () => {
    await assert.rejects(() => play("TELEPORT", 0.5), /inconnue/);
  });

  it("la dernière action clôt la visite et rend le bilan", async () => {
    await seed({ actions: 1 });
    const result = await play("BALL", 0);
    assert.equal(result.finished, true);
    assert.equal(result.catches.length, 1);
    assert.equal((await session()).status, "FINISHED");
    assert.equal(result.lineage, undefined, "plus de rencontre : plus de lignée à lire");
  });

  it("une visite expirée refuse aussi", async () => {
    await dbRun(points, "UPDATE pokemon_safari_sessions SET expires_at = ?", [Date.now() - 1000]);
    const result = await play("BALL", 0.99);
    assert.equal(result.ok, false);
  });
});

describe("collection et lignée jointes au résultat", () => {
  beforeEach(() => seed());

  it("joint ce que le dresseur possède de chaque maillon de la lignée", async () => {
    await own("Herbizarre", 0, 2);
    await own("Florizarre", 1);
    const result = await play("BAIT", 0.99);
    assert.deepEqual(
      [...result.lineage].map(([speciesId, counts]) => [data.getSpecies(speciesId).name, counts]),
      [
        ["Bulbizarre", { normal: 0, shiny: 0 }],
        ["Herbizarre", { normal: 2, shiny: 0 }],
        ["Florizarre", { normal: 0, shiny: 1 }],
      ]
    );
  });

  it("garde `owned` comme les compteurs de l'espèce seule : l'API du site le sert tel quel", async () => {
    await own("Bulbizarre", 0, 3);
    await own("Herbizarre");
    const result = await play("BAIT", 0.99);
    assert.deepEqual(result.owned, { normal: 3, shiny: 0 });
  });

  it("une espèce sans lignée n'a que son propre maillon", async () => {
    await seed({ species: "Tauros" });
    const result = await play("BAIT", 0.99);
    assert.deepEqual([...result.lineage.keys()], [id("Tauros")]);
  });

  it("une lignée à embranchement joint toutes ses cibles", async () => {
    await seed({ species: "Évoli" });
    await own("Aquali");
    const result = await play("BAIT", 0.99);
    assert.deepEqual(
      [...result.lineage.keys()].map((speciesId) => data.getSpecies(speciesId).name),
      ["Évoli", "Aquali", "Voltali", "Pyroli"]
    );
    assert.equal(result.lineage.get(id("Aquali")).normal, 1);
  });

  it("après une capture, la lignée décrite est celle de la rencontre SUIVANTE", async () => {
    const result = await play("BALL", 0);
    assert.equal(result.outcome, "CATCH");
    const next = (await session()).encounter_species_id;
    const chain = data.evolutionChain(data.getSpecies(next)).map((link) => link.id);
    assert.deepEqual([...result.lineage.keys()], chain);
  });
});
