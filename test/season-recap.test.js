// Le bilan de saison : ce qu'il compte (chaque statistique, sur une base où des lignes tombent
// dedans et dehors de la fenêtre), comment il se met en forme (sections vides omises, limites de
// Discord), et comment il part (une seule fois, réessayé, sauté quand il est trop vieux).
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbAll, speciesByName } from "./helpers.js";

const HOUR = 3_600_000;
const MINUTE = 60_000;
const DAY = 24 * HOUR;
// La 2e génération s'est ouverte à OPEN2, dans un passé assez lointain pour qu'elle soit
// vraiment active pendant ces tests : le bilan de la saison 1 se calcule donc, comme en
// production, alors que la suivante est déjà ouverte.
const OPEN2 = Date.parse("2025-06-01T12:00:00Z");
const BASE = { pokemon: { generationOpenings: { 2: new Date(OPEN2).toISOString() } } };
const sandbox = createSandbox({ config: BASE });
process.env.POKEMON_CHANNEL_ID = "123";
const { points } = await openDatabases();
const data = await import("../modules/pokemon/data.js");
const items = await import("../modules/pokemon/items.js");
const charms = await import("../modules/pokemon/charms.js");
const { getPokemonConfig } = await import("../modules/pokemon/config.js");
const stats = await import("../modules/pokemon/season-stats.js");
const season = await import("../modules/pokemon/season.js");

// Season 1 : de l'origine à l'ouverture de la 2e. Season 2 : de là à un mois plus tard.
const W1 = { start: 0, end: OPEN2 };
const W2 = { start: OPEN2, end: OPEN2 + 30 * DAY };
const IN = (offset = 1000) => W2.start + offset;
const BEFORE = W2.start - 1;
const AFTER = W2.end;
// Un instant de la saison 1.
const T1 = 100;

const fr = (value) => value.toLocaleString("fr-FR");
const species = (name) => speciesByName(data.allSpecies, name);
const id = (name) => species(name).id;
const nameOf = (speciesId) => data.getSpecies(speciesId).name;
const names = (list) => list.map((entry) => nameOf(entry.species));
const configure = (seasonRecap = {}, extra = {}) =>
  sandbox.writeConfig({ pokemon: { ...BASE.pokemon, ...extra, seasonRecap } });
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

// ---------------------- Graines ----------------------

async function bulk(table, columns, rows) {
  for (let index = 0; index < rows.length; index += 100) {
    const chunk = rows.slice(index, index + 100);
    await dbRun(
      points,
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ")}`,
      chunk.flat()
    );
  }
}

async function addSpawn(speciesId, { at = IN(), status = "FLED", shiny = 0, fished = 0, by = null, caughtAt = null, castCost = null, fleesAt = null, reservedFor = null } = {}) {
  const { lastID } = await dbRun(
    points,
    `INSERT INTO pokemon_spawns (species_id, is_shiny, catch_rate, rarity, status, spawned_at, caught_by, caught_at, fished, cast_cost, flees_at, reserved_for)
     VALUES (?, ?, 45, 'COMMUN', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [speciesId, shiny, status, at, by, caughtAt ?? (status === "CAUGHT" ? at : null), fished, castCost, fleesAt, reservedFor]
  );
  return lastID;
}
const addSpawns = (speciesId, count, options = {}) => Promise.all(Array.from({ length: count }, () => addSpawn(speciesId, options)));
const addThrow = (spawnId, user, { at = IN(), result = "MISS", ball = "poke", cost = 100, p = 0.5 } = {}) =>
  dbRun(points, "INSERT INTO pokemon_throws (spawn_id, user_id, ball, cost, probability, result, thrown_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [spawnId, user, ball, cost, p, result, at]);
const addOwned = (user, speciesId, at) =>
  dbRun(points, "INSERT INTO pokemon_owned (user_id, species_id, origin, obtained_at) VALUES (?, ?, 'capture', ?)", [user, speciesId, at]);
const addLog = (user, item, delta, source, at = IN()) =>
  dbRun(points, "INSERT INTO pokemon_item_log (user_id, item_key, delta, source, created_at) VALUES (?, ?, ?, ?, ?)", [user, item, delta, source, at]);
const addSession = (user, { at = IN(), balls = 0, cost = 0, catches = 0 } = {}) =>
  dbRun(points, "INSERT INTO pokemon_safari_sessions (user_id, status, actions_left, entry_cost, started_at, expires_at, balls_thrown, catches) VALUES (?, 'FINISHED', 0, ?, ?, ?, ?, ?)", [user, cost, at, at + HOUR, balls, catches]);
const addSafariCatch = (sessionId, speciesId, { at = IN(), shiny = 0 } = {}) =>
  dbRun(points, "INSERT INTO pokemon_safari_catches (session_id, species_id, is_shiny, caught_at) VALUES (?, ?, ?, ?)", [sessionId, speciesId, shiny, at]);

// Des lancers en nombre : `count` lancers de probabilité `p` pour `user`, dont `catches` gagnants.
async function addThrows(user, { count, catches, p = 0.5, at = IN(), result = "MISS" }) {
  const rows = Array.from({ length: count }, (_, index) => [1, user, "poke", 100, p, index < catches ? "CATCH" : result, at]);
  await bulk("pokemon_throws", ["spawn_id", "user_id", "ball", "cost", "probability", "result", "thrown_at"], rows);
}

const TABLES = [
  "pokemon_spawns", "pokemon_throws", "pokemon_owned", "pokemon_safari_sessions", "pokemon_safari_catches",
  "pokemon_fusions", "pokemon_sales", "pokemon_item_log", "pokemon_lottery", "pokemon_lottery_draws",
  "pokemon_drops", "pokemon_trades", "pokemon_shop_purchases", "pokemon_season_recaps", "pokemon_generations",
  "pokemon_eggs", "pokemon_starters",
];
beforeEach(async () => {
  for (const table of TABLES) await dbRun(points, `DELETE FROM ${table}`);
  await dbRun(points, "DROP TRIGGER IF EXISTS panne");
  sandbox.writeConfig(BASE);
});

const compute = (window = W2, seasonNumber = 2) => stats.computeSeasonStats(seasonNumber, window);
// Les champs d'un message, par nom : le nom d'un champ est le nom de la section.
const fieldsOf = (message) =>
  Object.fromEntries(message.embeds.flatMap((embed) => embed.toJSON().fields.map((field) => [field.name, field.value])));
const message = (payload) => season.buildSeasonMessage(payload);

// ====================== LA FENÊTRE ======================

describe("les bornes d'une saison", () => {
  it("la saison 1 commence au début des données ; la 2e à l'ouverture de la 2e génération", async () => {
    assert.equal(await stats.openingOf(1), 0);
    assert.equal(await stats.openingOf(2), OPEN2);
    assert.deepEqual(await stats.seasonWindow(1), { start: 0, end: OPEN2 });
  });

  it("à défaut de date, ou si la date est encore à venir, c'est l'annonce de l'ouverture qui fait foi", async () => {
    const announced = OPEN2 + 7 * MINUTE;
    // Ouverte avant l'heure avec `pokemon.generation` : la date programmée n'a rien ouvert.
    configure({}, { generation: 2, generationOpenings: { 2: "2999-01-01T00:00:00Z" } });
    assert.equal(await stats.openingOf(2), null, "ni date passée ni annonce : on ne sait pas encore");
    await dbRun(points, "INSERT INTO pokemon_generations (generation, announced_at) VALUES (2, ?)", [announced]);
    assert.equal(await stats.openingOf(2), announced);
    // Une date illisible vaut une date absente.
    configure({}, { generationOpenings: { 2: "pas une date" } });
    assert.equal(await stats.openingOf(2), announced);
  });

  it("la date programmée, passée, fait foi sur l'annonce tardive d'un bot qui était éteint", async () => {
    await dbRun(points, "INSERT INTO pokemon_generations (generation, announced_at) VALUES (2, ?)", [OPEN2 + 3 * DAY]);
    assert.equal(await stats.openingOf(2), OPEN2);
  });

  it("la fin est exclue : l'instant d'ouverture appartient à la saison qui commence", async () => {
    await addSpawn(id("Roucool"), { at: W2.start });
    await addSpawn(id("Roucool"), { at: W2.start - 1 });
    await addSpawn(id("Roucool"), { at: W2.end });
    await addSpawn(id("Roucool"), { at: W2.end - 1 });
    assert.equal((await compute()).pokemon.spawns, 2);
    assert.equal((await compute(W1, 1)).pokemon.spawns, 1, "celle d'avant l'ouverture est de la saison 1");
  });
});

describe("les génériques de génération ne changent pas le jeu en cours", () => {
  it("sans paramètre, la génération active ; avec, celle qu'on demande", () => {
    assert.equal(data.activeGeneration(), 2);
    assert.deepEqual(data.allSpecies().map((s) => s.id), data.allSpecies(data.activeGeneration()).map((s) => s.id));
    assert.equal(data.allSpecies(1).length, 151);
    assert.equal(data.allSpecies(2).length, 251);
    assert.equal(data.fishingOpen(), true);
    assert.equal(data.fishingOpen(1), false, "la pêche n'existait pas encore");
    assert.equal(data.fishingRarity(1).factor, 1);
    assert.equal(data.fishingRarity().factor, getPokemonConfig().fishing.wildRarityFactor);
  });

  it("un objet d'une génération fermée ne pèse rien dans la table de cette génération-là", () => {
    const item = items.getItem("pierre_soleil");
    assert.equal(items.itemDropWeightIn(item, 1), 0);
    assert.equal(items.itemDropWeightIn(item, 2), item.dropWeight);
    assert.equal(items.itemDropWeight(item), item.dropWeight, "la table courante est inchangée");
    assert.equal(items.itemLotteryWeightIn(item, 1), 0);
    assert.equal(items.itemLotteryWeight(item), items.itemLotteryWeightIn(item, 2));
    // Un filtre direct ne reçoit pas l'indice du tableau pour une génération.
    assert.deepEqual(items.getItems().filter(items.itemOpen).map((i) => i.key), items.getItems().map((i) => i.key));
  });
});

// ====================== LES POKÉMON ======================

describe("les apparitions et les lancers", () => {
  it("les apparitions de la fenêtre, touches de pêche comprises, et elles seules", async () => {
    await addSpawn(id("Roucool"));
    await addSpawn(id("Rattata"), { fished: 1 });
    await addSpawn(id("Rattata"), { at: IN(5000) });
    await addSpawn(id("Roucool"), { at: BEFORE });
    await addSpawn(id("Roucool"), { at: AFTER });
    const payload = await compute();
    assert.equal(payload.pokemon.spawns, 3);
    assert.match(fieldsOf(message(payload)).Apparitions, new RegExp(`${fr(3)}\\*\\* Pokémon sont apparus, touches de pêche comprises`));
  });

  it("les lancers : ni les remboursés, ni ceux d'avant ou d'après ; plus les balls du safari", async () => {
    const spawn = await addSpawn(id("Roucool"));
    await addThrow(spawn, "u1");
    await addThrow(spawn, "u2", { result: "CATCH" });
    await addThrow(spawn, "u1", { result: "VOID" });
    await addThrow(spawn, "u1", { at: BEFORE });
    await addThrow(spawn, "u1", { at: AFTER });
    await addSession("u1", { balls: 4 });
    await addSession("u2", { at: BEFORE, balls: 9 });
    const payload = await compute();
    assert.deepEqual(payload.pokemon.throws, { total: 6, safari: 4 });
    assert.match(fieldsOf(message(payload)).Lancers, /6\*\* lancers \(dont 4 au safari\)/);
  });

  it("sans balls au safari, « dont » n'apparaît pas", async () => {
    await addThrow(await addSpawn(id("Roucool")), "u1");
    assert.doesNotMatch(fieldsOf(message(await compute())).Lancers, /dont/);
  });

  it("les points dépensés : le total et chaque source, sans compter ce qui est remboursé ni hors saison", async () => {
    const spawn = await addSpawn(id("Roucool"));
    await addThrow(spawn, "u1", { cost: 100 });
    await addThrow(spawn, "u1", { cost: 400, ball: "hyper", result: "CATCH" });
    await addThrow(spawn, "u1", { cost: 100, result: "VOID" });
    await addThrow(spawn, "u1", { cost: 100, at: BEFORE });
    await bulk("pokemon_fusions", ["user_id", "from_species_id", "to_species_id", "duplicates_spent", "points_spent", "created_at"], [
      ["u1", 1, 2, 1, 1500, IN()], ["u1", 1, 2, 1, 3000, AFTER],
    ]);
    await addSession("u1", { cost: 5000 });
    await addSession("u1", { cost: 5000, at: BEFORE });
    await addSpawn(id("Magicarpe"), { fished: 1, castCost: 100 });
    await addSpawn(id("Magicarpe"), { fished: 1, castCost: 100, at: BEFORE });
    await bulk("pokemon_shop_purchases", ["user_id", "ball", "quantity", "cost", "bought_at"], [
      ["u1", "appat", 2, 460, IN()], ["u1", "appat", 1, 230, AFTER],
    ]);
    const payload = await compute();
    assert.deepEqual(payload.pokemon.spending, { total: 500 + 1500 + 5000 + 100 + 460, parts: { throws: 500, fusions: 1500, safari: 5000, fishing: 100, shop: 460 } });
    const lines = fieldsOf(message(payload))["Points dépensés"].split("\n");
    assert.equal(lines[0], `**${fr(7560)}** points`);
    assert.deepEqual(lines.slice(1), [`▫️ lancers : ${fr(500)}`, `▫️ évolutions : ${fr(1500)}`, `▫️ safari : ${fr(5000)}`, `▫️ pêche : ${fr(100)}`, `▫️ boutique : ${fr(460)}`]);
  });

  it("une source à zéro n'est pas listée, et sans aucune dépense la section disparaît", async () => {
    await addThrow(await addSpawn(id("Roucool")), "u1", { cost: 100 });
    const lines = fieldsOf(message(await compute()))["Points dépensés"].split("\n");
    assert.deepEqual(lines, [`**${fr(100)}** points`, `▫️ lancers : ${fr(100)}`]);
    await dbRun(points, "DELETE FROM pokemon_throws");
    assert.equal(fieldsOf(message(await compute()))["Points dépensés"], undefined);
  });

  it("les évolutions : le nombre seulement, celles de la saison", async () => {
    await bulk("pokemon_fusions", ["user_id", "from_species_id", "to_species_id", "duplicates_spent", "points_spent", "created_at"], [
      ["u1", 1, 2, 1, 1500, IN()], ["u2", 1, 2, 1, 1500, IN(5)], ["u1", 1, 2, 1, 1500, BEFORE],
    ]);
    const payload = await compute();
    assert.equal(payload.pokemon.evolutions, 2);
    assert.equal(fieldsOf(message(payload)).Évolutions, `**2** évolutions`);
  });
});

describe("les classements d'espèces", () => {
  it("les plus apparus : les topSize premiers, une égalité tranchée par le numéro du Pokédex", async () => {
    await addSpawns(id("Roucool"), 4);
    await addSpawns(id("Piafabec"), 3);
    await addSpawns(id("Rattata"), 3);
    await addSpawns(id("Chenipan"), 2);
    await addSpawns(id("Aspicot"), 1);
    await addSpawns(id("Abo"), 1);
    await addSpawns(id("Roucool"), 10, { at: BEFORE });
    const { mostSeen } = (await compute()).pokemon;
    assert.deepEqual(names(mostSeen), ["Roucool", "Rattata", "Piafabec", "Chenipan", "Aspicot"], "Abo, sixième, n'y est pas ; le passé n'y compte pas");
    assert.deepEqual(mostSeen.map((entry) => entry.count), [4, 3, 3, 2, 1]);
    configure({ topSize: 2 });
    assert.equal((await compute()).pokemon.mostSeen.length, 2, "la longueur suit le réglage");
  });

  // Ce qui ne peut jamais apparaître : bébés (œufs), évolutions par échange, formes qu'un objet est seul à donner.
  const itemTargets = new Set(Object.values(getPokemonConfig().items).flatMap((item) => Object.values(item.evolution?.targets ?? {}).map(Number)));
  const cannotSpawn = (s) => s.isBaby || s.tradeEvolution || itemTargets.has(s.id);
  const spawnable = (generation) => data.allSpecies(generation).filter((s) => !data.isLegendary(s) && !cannotSpawn(s));
  const seedEveryone = (generation, counts = new Map(), fallback = 3, at = IN()) =>
    bulk("pokemon_spawns", ["species_id", "status", "spawned_at", "catch_rate"], spawnable(generation).flatMap((s) => Array.from({ length: counts.get(s.id) ?? fallback }, () => [s.id, "FLED", at, 45])));

  it("les plus timides : les moins apparus parmi ce qui pouvait apparaître, zéro compris", async () => {
    await seedEveryone(2, new Map([[id("Roucool"), 0], [id("Rattata"), 1], [id("Piafabec"), 2]]));
    const { shyest } = (await compute()).pokemon;
    assert.deepEqual(names(shyest).slice(0, 3), ["Roucool", "Rattata", "Piafabec"]);
    assert.deepEqual(shyest.slice(0, 3).map((entry) => entry.count), [0, 1, 2], "un compte de zéro est permis");
    assert.ok(shyest.slice(3).every((entry) => entry.count === 3));
    assert.equal(shyest.length, 5);
  });

  it("les plus timides : ni légendaire, ni bébé, ni évolution qui ne sort que par échange ou par objet", async () => {
    // Tout ce qui peut apparaître est apparu une fois ; les autres, jamais : s'ils étaient comptés, ils ouvriraient la liste à zéro.
    await seedEveryone(2, new Map(), 1);
    const { shyest } = (await compute()).pokemon;
    assert.equal(shyest.length, 5);
    assert.ok(shyest.every((entry) => entry.count === 1), names(shyest).join(", "));
    assert.ok(data.allSpecies(2).some((s) => data.isLegendary(s)) && data.allSpecies(2).some((s) => s.isBaby) && data.getSpecies(id("Alakazam")).tradeEvolution, "le jeu de données contient bien de quoi se tromper");
  });

  it("la saison 1 se calcule avec le Pokédex de la 1re génération, même quand la 2e est ouverte", async () => {
    assert.equal(data.activeGeneration(), 2);
    await seedEveryone(1, new Map([[id("Roucool"), 0]]), 3, 100);
    const { shyest } = (await compute(W1, 1)).pokemon;
    assert.equal(nameOf(shyest[0].species), "Roucool");
    assert.ok(shyest.every((entry) => data.getSpecies(entry.species).generation === 1), "Germignon, à zéro, n'est pas de cette saison-là");
    // La saison 2, elle, compte les espèces de la 2e génération.
    await dbRun(points, "DELETE FROM pokemon_spawns");
    await seedEveryone(1, new Map(), 1);
    const second = (await compute()).pokemon.shyest;
    assert.ok(second.every((entry) => data.getSpecies(entry.species).generation === 2 && entry.count === 0));
  });

  it("les plus capturés : captures du salon et du safari de la saison, pas celles d'avant ni d'après", async () => {
    await addSpawn(id("Roucool"), { status: "CAUGHT", by: "u1" });
    await addSpawn(id("Roucool"), { status: "CAUGHT", by: "u2" });
    await addSpawn(id("Rattata"), { status: "CAUGHT", by: "u1" });
    await addSpawn(id("Rattata"), { status: "FLED" });
    // Apparu dans la saison mais capturé après : c'est une apparition de la saison, une capture de la suivante.
    await addSpawn(id("Abo"), { status: "CAUGHT", by: "u1", caughtAt: AFTER });
    const session = (await addSession("u1")).lastID;
    await addSafariCatch(session, id("Rattata"));
    await addSafariCatch(session, id("Rattata"));
    await addSafariCatch(session, id("Piafabec"), { at: BEFORE });
    const { mostCaught } = (await compute()).pokemon;
    assert.deepEqual(mostCaught.map((entry) => [nameOf(entry.species), entry.count]), [["Rattata", 3], ["Roucool", 2]]);
  });

  it("les plus boudés : le taux de fuite, avec un minimum d'apparitions, jamais le nombre de fuites", async () => {
    const flee = async (name, fled, kept, options = {}) => {
      await addSpawns(id(name), fled, { status: "FLED", ...options });
      await addSpawns(id(name), kept, { status: "CAUGHT", by: "u1", ...options });
    };
    await flee("Roucool", 7, 3);
    await flee("Piafabec", 10, 10);
    await flee("Chenipan", 5, 0);
    await flee("Rattata", 4, 0);
    await flee("Aspicot", 0, 6);
    await flee("Abo", 9, 0, { at: BEFORE });
    const { mostFled } = (await compute()).pokemon;
    assert.deepEqual(mostFled.map((entry) => [nameOf(entry.species), entry.fled, entry.seen]), [["Chenipan", 5, 5], ["Roucool", 7, 10], ["Piafabec", 10, 20]]);
    const text = fieldsOf(message(await compute()))["Les plus boudés"];
    assert.match(text, /\*\*Chenipan\*\* — 100 % \(5\/5\)/);
    assert.match(text, /\*\*Roucool\*\* — 70 % \(7\/10\)/);
    assert.doesNotMatch(text, /Rattata|Aspicot|Abo/, "trop peu d'apparitions, aucune fuite, hors saison");
    configure({ minSpawnsForFleeRate: 6 });
    assert.deepEqual(names((await compute()).pokemon.mostFled), ["Roucool", "Piafabec"], "le minimum se règle");
  });

  it("les plus vendus : la somme des quantités vendues dans la saison", async () => {
    await bulk("pokemon_sales", ["user_id", "species_id", "quantity", "points", "sold_at"], [
      ["u1", id("Roucool"), 2, 500, IN()], ["u2", id("Roucool"), 3, 750, IN(7)],
      ["u1", id("Rattata"), 4, 1000, IN()], ["u1", id("Abo"), 99, 1, BEFORE], ["u1", id("Abo"), 99, 1, AFTER],
    ]);
    const { mostSold } = (await compute()).pokemon;
    assert.deepEqual(mostSold.map((entry) => [nameOf(entry.species), entry.count]), [["Roucool", 5], ["Rattata", 4]]);
  });
});

describe("les touches de pêche échues", () => {
  const bites = (name, count, { fleesAt, status = "FISHING" }) =>
    Promise.all(Array.from({ length: count }, (_, index) => addSpawn(id(name), { status, fished: 1, fleesAt, reservedFor: status === "FISHING" ? `${name}-${index}` : null })));

  it("à la fin de la saison, une touche échue est une fuite même si sa ligne dit encore FISHING ; une touche dans ses délais, non", async () => {
    await bites("Magicarpe", 5, { fleesAt: IN(500) });
    await bites("Rattata", 5, { fleesAt: W2.end + DAY });
    await bites("Roucool", 2, { fleesAt: IN(500) });
    await addSpawns(id("Roucool"), 2, { status: "FLED" });
    await addSpawn(id("Roucool"), { status: "CAUGHT", by: "u1", fished: 1 });
    const { mostFled } = (await compute()).pokemon;
    assert.deepEqual(mostFled.map((entry) => [nameOf(entry.species), entry.fled, entry.seen]), [["Magicarpe", 5, 5], ["Roucool", 4, 5]], "Rattata, encore dans ses délais, n'a pas fui");
  });

  it("l'issue de la plus longue résistance suit la même règle", async () => {
    const [bite] = await bites("Magicarpe", 1, { fleesAt: IN(500) });
    for (let i = 0; i < 4; i++) await addThrow(bite, "u1");
    assert.equal((await compute()).pokemon.longestFight.status, "FLED");
    assert.equal(fieldsOf(message(await compute()))["La plus longue résistance"], "**Magicarpe** a encaissé 4 lancers : il s'est enfui.");
    await dbRun(points, "UPDATE pokemon_spawns SET flees_at = ?", [W2.end + DAY]);
    assert.equal((await compute()).pokemon.longestFight.status, "FISHING");
    assert.match(fieldsOf(message(await compute()))["La plus longue résistance"], /il est toujours là\.$/);
  });
});

describe("shiny, légendaires et records", () => {
  it("compte les shiny et les légendaires capturés, et dit qui a attrapé quel légendaire — safari compris", async () => {
    await addSpawn(id("Roucool"), { status: "CAUGHT", by: "u1", shiny: 1 });
    await addSpawn(id("Mewtwo"), { status: "CAUGHT", by: "u2" });
    await addSpawn(id("Mew"), { status: "CAUGHT", by: "u9", at: BEFORE });
    const session = (await addSession("u3")).lastID;
    await addSafariCatch(session, id("Artikodin"), { shiny: 1 });
    const { rare } = (await compute()).pokemon;
    assert.equal(rare.shiny, 2);
    assert.equal(rare.legendary, 2);
    assert.deepEqual(rare.legendaries.map((entry) => [nameOf(entry.species), entry.user, entry.shiny]).sort(), [["Artikodin", "u3", true], ["Mewtwo", "u2", false]]);
    const text = fieldsOf(message(await compute()))["Shiny et légendaires de la saison"];
    assert.match(text, /✨ \*\*2\*\* shiny capturés/);
    assert.match(text, /🟠 \*\*2\*\* légendaires capturés/);
    assert.match(text, /Mewtwo — <@u2>/);
    assert.match(text, /✨ Artikodin — <@u3>/);
  });

  it("sans shiny ni légendaire, la section n'existe pas", async () => {
    await addSpawn(id("Roucool"), { status: "CAUGHT", by: "u1" });
    assert.equal(fieldsOf(message(await compute()))["Shiny et légendaires de la saison"], undefined);
  });

  it("la capture la plus chanceuse : le lancer gagnant à la plus basse probabilité de la saison", async () => {
    const spawn = await addSpawn(id("Roucool"), { status: "CAUGHT", by: "u2" });
    const rare = await addSpawn(id("Mewtwo"), { status: "CAUGHT", by: "u3" });
    await addThrow(spawn, "u1", { result: "CATCH", p: 0.5 });
    await addThrow(rare, "u3", { result: "CATCH", p: 0.02 });
    await addThrow(spawn, "u4", { result: "CATCH", p: 0.001, at: BEFORE });
    await addThrow(spawn, "u5", { result: "MISS", p: 0.0001 });
    await addThrow(spawn, "u6", { result: "CATCH", p: null });
    const { luckiestCatch } = (await compute()).pokemon;
    assert.deepEqual(luckiestCatch, { user: "u3", species: id("Mewtwo"), probability: 0.02 });
    assert.equal(fieldsOf(message(await compute()))["La capture la plus chanceuse"], "<@u3> a attrapé **Mewtwo** avec seulement 2 % de chances.");
  });

  it("la malchance : le plus petit produit des (1 − p) sur UNE apparition, sans les lancers sans probabilité", async () => {
    const [s1, s2, s3, s4] = [await addSpawn(id("Roucool")), await addSpawn(id("Rattata")), await addSpawn(id("Abo")), await addSpawn(id("Aspicot"))];
    for (let i = 0; i < 3; i++) await addThrow(s1, "a", { p: 0.5 });
    await addThrow(s1, "a", { result: "CATCH", p: 0.0001 });
    await addThrow(s2, "b", { p: 0.2 });
    for (let i = 0; i < 2; i++) await addThrow(s3, "c", { p: 0.5 });
    await addThrow(s3, "c", { p: null });
    for (let i = 0; i < 2; i++) await addThrow(s4, "a", { p: 0.5 });
    await addThrow(s1, "d", { p: 0.99, at: BEFORE });
    const { unluckiestStreak } = (await compute()).pokemon;
    assert.equal(unluckiestStreak.user, "a");
    assert.equal(nameOf(unluckiestStreak.species), "Roucool", "les ratés d'une autre apparition ne s'additionnent pas");
    assert.equal(unluckiestStreak.misses, 3);
    assert.equal(unluckiestStreak.chance, 0.125);
    assert.equal(fieldsOf(message(await compute()))["La malchance de la saison"], "<@a> a raté **Roucool** 3 fois : 1 chance sur 8.");
  });

  it("la plus longue résistance : l'apparition qui a encaissé le plus de lancers payants, et sa fin", async () => {
    const short = await addSpawn(id("Roucool"));
    const long = await addSpawn(id("Rattata"), { status: "FLED" });
    const far = await addSpawn(id("Abo"));
    for (let i = 0; i < 3; i++) await addThrow(short, "u1");
    for (let i = 0; i < 2; i++) await addThrow(short, "u1", { result: "VOID" });
    for (let i = 0; i < 4; i++) await addThrow(long, "u2");
    for (let i = 0; i < 6; i++) await addThrow(far, "u3", { at: AFTER });
    const { longestFight } = (await compute()).pokemon;
    assert.deepEqual(longestFight, { species: id("Rattata"), throws: 4, status: "FLED" });
    assert.equal(fieldsOf(message(await compute()))["La plus longue résistance"], "**Rattata** a encaissé 4 lancers : il s'est enfui.");
  });

  it("la ball préférée : la plus lancée, remboursements exclus, avec son nom", async () => {
    const spawn = await addSpawn(id("Roucool"));
    for (let i = 0; i < 3; i++) await addThrow(spawn, "u1", { ball: "poke" });
    for (let i = 0; i < 2; i++) await addThrow(spawn, "u1", { ball: "hyper" });
    for (let i = 0; i < 2; i++) await addThrow(spawn, "u1", { ball: "hyper", result: "VOID" });
    for (let i = 0; i < 9; i++) await addThrow(spawn, "u1", { ball: "master", at: AFTER });
    const { favoriteBall } = (await compute()).pokemon;
    assert.deepEqual(favoriteBall, { ball: "poke", count: 3 });
    assert.match(fieldsOf(message(await compute()))["La ball préférée du serveur"], /Poké Ball — 3 lancers/);
  });
});

// ====================== LES DRESSEURS ======================

describe("les champions de la saison", () => {
  it("classés par espèces distinctes du Pokédex, légendaires exclus, et pris à la fin de la saison", async () => {
    const dex = data.allSpecies(2).filter((s) => !data.isLegendary(s)).map((s) => s.id);
    // c : 5 espèces, la dernière à T+5.
    for (let i = 0; i < 5; i++) await addOwned("c", dex[i], IN(i + 1));
    // a : 4 espèces à T+4 au plus (un doublon n'y change rien) et un légendaire, qui ne compte pas.
    for (let i = 0; i < 4; i++) await addOwned("a", dex[i], IN(i + 1));
    await addOwned("a", dex[0], IN(50));
    await addOwned("a", id("Mewtwo"), IN(3));
    // b : 4 espèces comme a, mais la dernière arrive plus tard.
    for (let i = 0; i < 3; i++) await addOwned("b", dex[i], IN(i + 1));
    await addOwned("b", dex[3], IN(10));
    // e : 4 espèces plus tard que les autres, et une cinquième exactement à la fin de la saison :
    // elle appartient à la suivante. Comptée, e passerait deuxième.
    for (let i = 0; i < 4; i++) await addOwned("e", dex[i], IN(20 + i));
    await addOwned("e", dex[4], W2.end);
    const { champions } = (await compute()).trainers;
    assert.deepEqual(champions.entries.map((entry) => [entry.user, entry.owned]), [["c", 5], ["a", 4], ["b", 4]], "à nombre égal, le plus rapide devant");
    assert.equal(champions.total, charms.charmSpecies(1).length + charms.charmSpecies(2).length);
    assert.equal(fieldsOf(message(await compute()))["Les champions de la saison"].split("\n")[0], `🥇 <@c> — 5/${champions.total} espèces`);
  });

  // Les espèces du Pokédex de la saison 2 hors légendaires, dans l'ordre : de quoi n'en nommer aucune.
  const dex = () => data.allSpecies(2).filter((s) => !data.isLegendary(s)).map((s) => s.id);
  // Un Pokémon capturé : l'évènement d'acquisition (la capture) et la ligne de la collection.
  const caught = async (user, speciesId, at) => {
    await addSpawn(speciesId, { at, status: "CAUGHT", by: user });
    await addOwned(user, speciesId, at);
  };
  // Un Pokémon obtenu en évoluant : la ligne garde la date de l'ancienne espèce (restoreDuplicates
  // réinsère l'individu tel quel), l'évènement est l'évolution.
  const evolvedInto = async (user, speciesId, { oldAt, at }) => {
    await addOwned(user, speciesId, oldAt);
    await dbRun(points, "INSERT INTO pokemon_fusions (user_id, from_species_id, to_species_id, duplicates_spent, points_spent, created_at) VALUES (?, 1, ?, 1, 1500, ?)", [user, speciesId, at]);
  };
  const summaryOf = (champions) => champions.entries.map((entry) => [entry.user, entry.owned, entry.reachedAt]);

  it("une espèce obtenue en évoluant date de l'évolution, pas de la capture de l'espèce d'avant : à égalité, B passe devant A", async () => {
    const species = dex();
    for (let index = 0; index < 4; index++) await caught("b", species[index], IN(index + 1));
    for (let index = 0; index < 3; index++) await caught("a", species[index], IN(index + 1));
    // La quatrième espèce d'A vient d'une évolution tardive, sur une ligne restée datée de IN(1).
    await evolvedInto("a", species[3], { oldAt: IN(1), at: IN(10) });
    const { champions } = (await compute()).trainers;
    assert.deepEqual(summaryOf(champions), [["b", 4, IN(4)], ["a", 4, IN(10)]], "avec la date de la ligne, A serait arrivé à IN(3) et gagnerait");
  });

  it("une évolution faite après la fin de la saison n'y compte pas, même sur une ligne plus ancienne (bilan publié en retard)", async () => {
    const species = dex();
    for (let index = 0; index < 4; index++) await caught("c", species[index], IN(index + 1));
    await evolvedInto("c", species[4], { oldAt: IN(1), at: W2.end + HOUR });
    for (let index = 0; index < 3; index++) await caught("d", species[index], IN(index + 1));
    const { champions } = (await compute()).trainers;
    assert.deepEqual(summaryOf(champions), [["c", 4, IN(4)], ["d", 3, IN(3)]], "cinq avec la date de la ligne");
    // L'évolution faite à l'instant de la fin appartient déjà à la saison suivante ; juste avant, à celle-ci.
    await dbRun(points, "UPDATE pokemon_fusions SET created_at = ?", [W2.end]);
    assert.equal((await compute()).trainers.champions.entries[0].owned, 4);
    await dbRun(points, "UPDATE pokemon_fusions SET created_at = ?", [W2.end - 1]);
    assert.deepEqual(summaryOf((await compute()).trainers.champions)[0], ["c", 5, W2.end - 1]);
  });

  it("chaque façon d'obtenir une espèce date par son évènement : capture au parc, éclosion, starter, échange reçu (des deux côtés)", async () => {
    configure({ podiumSize: 10 });
    const roucool = id("Roucool");
    const trade = (from, to, offered, requested, at) =>
      dbRun(points, "INSERT INTO pokemon_trades (from_user_id, to_user_id, offer_species_id, request_species_id, status, created_at, expires_at, resolved_at) VALUES (?, ?, ?, ?, 'ACCEPTED', 1, 2, ?)", [from, to, offered, requested, at]);
    const sources = {
      safari: async (user, at) => addSafariCatch((await addSession(user, { at })).lastID, roucool, { at }),
      oeuf: (user, at) => dbRun(points, "INSERT INTO pokemon_eggs (user_id, species_id, father_species_id, mother_species_id, status, hatch_messages, laid_at, hatch_at, hatched_at) VALUES (?, ?, 1, 1, 'HATCHED', 200, 1, 1, ?)", [user, roucool, at]),
      starter: (user, at) => dbRun(points, "INSERT INTO pokemon_starters (user_id, generation, species_id, chosen_at) VALUES (?, 2, ?, ?)", [user, roucool, at]),
      "échange reçu (côté offert)": (user, at) => trade("ailleurs", user, roucool, 0, at),
      "échange reçu (côté demandé)": (user, at) => trade(user, "ailleurs", 0, roucool, at),
    };
    for (const [source, give] of Object.entries(sources)) {
      await dbRun(points, "DELETE FROM pokemon_owned");
      for (const table of ["pokemon_safari_sessions", "pokemon_safari_catches", "pokemon_eggs", "pokemon_starters", "pokemon_trades"]) await dbRun(points, `DELETE FROM ${table}`);
      // Les deux lignes datent de IN(1) : seul l'évènement les départage.
      await addOwned("dedans", roucool, IN(1));
      await addOwned("dehors", roucool, IN(1));
      await give("dedans", IN(5));
      await give("dehors", W2.end);
      const { champions } = (await compute()).trainers;
      assert.deepEqual(summaryOf(champions), [["dedans", 1, IN(5)]], source);
    }
  });

  it("une espèce qu'on n'a plus ne compte pas, même capturée dans la saison ; sans évènement, la date de la ligne fait foi", async () => {
    const species = dex();
    await addSpawn(species[0], { at: IN(1), status: "CAUGHT", by: "parti" });
    await addOwned("don", species[1], IN(2));
    const { champions } = (await compute()).trainers;
    assert.deepEqual(summaryOf(champions), [["don", 1, IN(2)]]);
  });

  it("la saison 1 prend le Pokédex de la 1re génération, la 2e étant ouverte", async () => {
    await addOwned("a", id("Roucool"), 5);
    await addOwned("a", id("Germignon"), 6);
    await addOwned("b", id("Germignon"), 7);
    const { champions } = (await compute(W1, 1)).trainers;
    assert.deepEqual(champions.entries.map((entry) => [entry.user, entry.owned]), [["a", 1]], "une espèce de la 2e génération n'est pas de la saison 1");
    assert.equal(champions.total, charms.charmSpecies(1).length);
  });

  it("la taille du podium suit le réglage", async () => {
    for (const user of ["a", "b", "c", "d"]) await addOwned(user, id("Roucool"), IN());
    assert.equal((await compute()).trainers.champions.entries.length, 3);
    configure({ podiumSize: 2 });
    assert.equal((await compute()).trainers.champions.entries.length, 2);
  });
});

describe("la chance à la capture", () => {
  const seed = async () => {
    await addThrows("u1", { count: 40, catches: 28 });
    await addThrows("u8", { count: 40, catches: 24 });
    // Pile ce qu'annonçaient les probabilités : ni chanceux ni malchanceux.
    await addThrows("u2", { count: 40, catches: 20 });
    await addThrows("u3", { count: 40, catches: 10 });
    await addThrows("u5", { count: 30, catches: 3 });
    // Trop peu de lancers : 29, tous gagnants, le meilleur rapport de la base.
    await addThrows("u4", { count: 29, catches: 29 });
    // 40 lancers, mais 10 remboursés et 10 sans probabilité : il n'en reste que 20.
    await addThrows("u6", { count: 20, catches: 20 });
    await addThrows("u6", { count: 10, catches: 0, result: "VOID" });
    await addThrows("u6", { count: 10, catches: 0, p: null });
    await addThrows("u7", { count: 40, catches: 40, at: BEFORE });
  };

  it("les plus chanceux sont au-dessus de ×1, les moins chanceux en dessous, avec un minimum de lancers", async () => {
    await seed();
    const { lucky, unlucky } = (await compute()).trainers;
    assert.deepEqual(lucky.map((p) => p.user), ["u1", "u8"], "u2, pile à ×1, n'est d'aucun podium");
    assert.deepEqual(unlucky.map((p) => p.user), ["u5", "u3"], "30 lancers suffisent, 29 non ; le pire d'abord");
    assert.equal(lucky[0].ratio, 1.4);
    assert.equal(lucky[0].catches, 28);
    assert.equal(lucky[0].expected, 20);
    const text = fieldsOf(message(await compute()));
    assert.equal(text["Les plus chanceux"].split("\n")[0], "🥇 <@u1> — ×1,40 (28 captures pour 20 attendues)");
    assert.equal(text["Les moins chanceux"].split("\n")[0], "🥇 <@u5> — ×0,20 (3 captures pour 15 attendues)");
  });

  it("jamais un dresseur dans les deux podiums, ni un « chanceux » sous ×1, ni un « malchanceux » au-dessus", async () => {
    // 30 lancers à 50 % : 15 captures sont attendues, donc de 12 à 20 captures, de ×0,80 à ×1,33.
    for (let count = 1; count <= 9; count++) {
      await dbRun(points, "DELETE FROM pokemon_throws");
      for (let user = 0; user < count; user++) await addThrows(`p${user}`, { count: 30, catches: 12 + user });
      const trainers = (await compute()).trainers;
      // Un podium sans personne est absent (null), pas une liste vide.
      const lucky = trainers.lucky ?? [];
      const unlucky = trainers.unlucky ?? [];
      assert.deepEqual(lucky.filter((player) => unlucky.some((other) => other.user === player.user)), [], `${count} dresseur(s)`);
      assert.ok(lucky.every((player) => player.ratio > 1) && unlucky.every((player) => player.ratio < 1), `${count} dresseur(s)`);
      // 12, 13, 14 captures sont sous ×1 ; 15, pile ; 16 à 20 au-dessus. Trois places par podium.
      assert.equal(unlucky.length, Math.min(count, 3), `${count} dresseur(s)`);
      assert.equal(lucky.length, Math.min(Math.max(count - 4, 0), 3), `${count} dresseur(s)`);
    }
  });

  it("pas de partage en deux : un seul dresseur qualifié ne remplit qu'un podium, et l'autre est omis", async () => {
    await addThrows("u1", { count: 30, catches: 12 });
    let payload = await compute();
    assert.deepEqual(payload.trainers.unlucky.map((p) => p.user), ["u1"]);
    assert.equal(payload.trainers.lucky, null);
    let fields = fieldsOf(message(payload));
    assert.ok(fields["Les moins chanceux"]);
    assert.equal(fields["Les plus chanceux"], undefined);

    await dbRun(points, "DELETE FROM pokemon_throws");
    await addThrows("u1", { count: 30, catches: 18 });
    payload = await compute();
    assert.deepEqual(payload.trainers.lucky.map((p) => p.user), ["u1"]);
    assert.equal(payload.trainers.unlucky, null);
    fields = fieldsOf(message(payload));
    assert.ok(fields["Les plus chanceux"]);
    assert.equal(fields["Les moins chanceux"], undefined);
  });

  it("pile ce qui était attendu : ni l'un ni l'autre", async () => {
    await addThrows("u1", { count: 30, catches: 15 });
    const payload = await compute();
    assert.deepEqual([payload.trainers.lucky, payload.trainers.unlucky], [null, null]);
  });

  it("le minimum de lancers se règle", async () => {
    await addThrows("u1", { count: 12, catches: 9 });
    assert.equal((await compute()).trainers.lucky, null);
    configure({ minThrowsForLuck: 10 });
    assert.equal((await compute()).trainers.lucky[0].user, "u1");
  });
});

describe("la chance aux objets", () => {
  // La rareté d'un objet : le poids total de sa table sur son poids, pour la génération de la saison.
  const catalogue = (generation) =>
    Object.entries(getPokemonConfig().items).filter(([, item]) => (item.rod ? getPokemonConfig().fishing.generation : (item.generation ?? 1)) <= generation);
  const rarity = (key, generation, field = "dropWeight") => {
    const weight = (item) => item[field] ?? item.dropWeight ?? 0;
    return catalogue(generation).reduce((sum, [, item]) => sum + weight(item), 0) / weight(getPokemonConfig().items[key]);
  };
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

  it("la rareté d'un objet est le poids de sa table sur le sien : la Master Ball vaut bien plus qu'une Poké Ball", () => {
    assert.ok(rarity("ball_master", 1) > 100 * rarity("ball_poke", 1));
  });

  it("score = somme des raretés des objets obtenus par capture, au sol et à la loterie, vente automatique comprise", async () => {
    await addLog("a", "ball_poke", 3, "capture:1", T1);
    await addLog("a", "pepite", 1, "sol:5", T1);
    await addLog("a", "ball_poke", 2, "loterie", T1);
    await addLog("b", "ball_master", 0, "vente-auto:capture:7", T1);
    const { itemLuck } = (await compute(W1, 1)).trainers;
    assert.deepEqual(itemLuck.map((p) => p.user), ["b", "a"]);
    near(itemLuck[0].score, rarity("ball_master", 1));
    assert.equal(itemLuck[0].items, 1);
    assert.deepEqual(itemLuck[0].rarest.item, "ball_master");
    near(itemLuck[1].score, 3 * rarity("ball_poke", 1) + rarity("pepite", 1) + 2 * rarity("ball_poke", 1, "lotteryWeight"));
    assert.equal(itemLuck[1].items, 6);
    assert.equal(itemLuck[1].rarest.item, "pepite");
    const line = fieldsOf(message(await compute(W1, 1)))["Les plus chanceux en objets"].split("\n")[0];
    assert.match(line, /^🥇 <@b> — 1 objet, score \d+ · le plus rare : .*Master Ball.* \(1 sur \d+\)$/);
  });

  it("la loterie a sa propre table : un même objet n'y vaut pas la même rareté que sur un Pokémon", async () => {
    await addLog("a", "ball_poke", 1, "loterie", T1);
    await addLog("b", "ball_poke", 1, "capture:1", T1);
    const { itemLuck } = (await compute(W1, 1)).trainers;
    const score = Object.fromEntries(itemLuck.map((p) => [p.user, p.score]));
    near(score.a, rarity("ball_poke", 1, "lotteryWeight"));
    near(score.b, rarity("ball_poke", 1));
    assert.notEqual(score.a, score.b);
  });

  it("ce qui ne tient pas à la chance n'y compte pas : échanges, dons, boutique, plafond de détention, hors saison", async () => {
    await addLog("c", "pepite", 1, "echange");
    await addLog("c", "pepite", 5, "admin");
    await addLog("c", "pepite", 1, "pokedex:1");
    await addLog("c", "pepite", -2, "vente-auto:plafond-detention");
    await addLog("c", "pepite", 0, "vente-auto:vente");
    await addLog("d", "pepite", 1, "capture:9", BEFORE);
    await addLog("d", "pepite", 1, "sol:9", AFTER);
    await addLog("e", "pepite", -1, "capture:3");
    assert.equal((await compute()).trainers.itemLuck, null);
  });

  it("les poids sont ceux de la génération de la saison : un objet de la 2e n'a pas pu tomber en saison 1", async () => {
    await addLog("a", "pierre_soleil", 1, "capture:1", T1);
    await addLog("a", "pepite", 1, "capture:2", T1);
    const first = (await compute(W1, 1)).trainers.itemLuck;
    assert.equal(first[0].items, 1, "la Pierre Soleil, fermée, n'est pas comptée");
    near(first[0].score, rarity("pepite", 1));
    await dbRun(points, "UPDATE pokemon_item_log SET created_at = ?", [IN()]);
    const second = (await compute()).trainers.itemLuck;
    assert.equal(second[0].items, 2);
    near(second[0].score, rarity("pierre_soleil", 2) + rarity("pepite", 2));
  });
});

describe("la loterie", () => {
  const drawsLog = (user, count, wins, at) =>
    bulk("pokemon_lottery_draws", ["user_id", "won", "drawn_at"], Array.from({ length: count }, (_, i) => [user, i < wins ? 1 : 0, at]));
  const summary = (lottery) => lottery.map((p) => [p.user, p.wins, p.draws]);

  it("la saison 1 lit les compteurs cumulés de pokemon_lottery, pas le journal", async () => {
    // Taux de la saison : 21 victoires sur 45 tirages, 47 %. u4 (75 %) et u5 (jamais perdu) sont au-dessus.
    await bulk("pokemon_lottery", ["user_id", "draws", "wins"], [["u1", 10, 3], ["u2", 5, 0], ["u3", 4, 0], ["u4", 20, 15], ["u5", 6, 6]]);
    await drawsLog("u6", 6, 0, T1);
    const { lottery } = (await compute(W1, 1)).trainers;
    assert.deepEqual(summary(lottery), [["u2", 0, 5], ["u1", 3, 10]], "u3 n'a pas assez de tirages ; u6 n'est que dans le journal");
    assert.equal(fieldsOf(message(await compute(W1, 1)))["Les moins chanceux à la loterie"].split("\n")[0], "🥇 <@u2> — 0/5 tirages gagnés");
  });

  it("un bilan publié en retard ne compte pas les tirages d'après la fin de la saison 1", async () => {
    await bulk("pokemon_lottery", ["user_id", "draws", "wins"], [["u1", 10, 3], ["u2", 8, 8]]);
    // 4 tirages de u1 à la fin de la saison ou après, dont 3 gagnants : ils sont dans les compteurs, pas dans la saison.
    await drawsLog("u1", 4, 3, OPEN2);
    // Un tirage d'avant la fin, gagnant, reste compté.
    await drawsLog("u1", 1, 1, OPEN2 - 1);
    const { lottery } = (await compute(W1, 1)).trainers;
    assert.deepEqual(summary(lottery), [["u1", 0, 6]], "10 − 4 tirages, 3 − 3 victoires");
    // Sans tirage tardif, les compteurs se lisent tels quels.
    await dbRun(points, "DELETE FROM pokemon_lottery_draws");
    assert.deepEqual(summary((await compute(W1, 1)).trainers.lottery), [["u1", 3, 10]]);
  });

  it("les saisons suivantes lisent le journal des tirages de leur fenêtre", async () => {
    await bulk("pokemon_lottery", ["user_id", "draws", "wins"], [["u7", 50, 0]]);
    // Taux de la saison : 9 victoires sur 25 tirages, 36 %. u3 (4 tirages) compte dans ce taux sans être classé.
    await drawsLog("u1", 6, 1, IN());
    await drawsLog("u2", 5, 0, IN());
    await drawsLog("u3", 4, 0, IN());
    await drawsLog("u8", 10, 8, IN());
    await drawsLog("u4", 10, 0, BEFORE);
    await drawsLog("u4", 3, 3, AFTER);
    const { lottery } = (await compute()).trainers;
    assert.deepEqual(summary(lottery), [["u2", 0, 5], ["u1", 1, 6]], "ni les cumuls, ni le passé, ni l'avenir, ni u8 au-dessus du taux de la saison");
  });

  it("à taux égal, celui qui a le plus tiré passe devant ; le minimum se règle", async () => {
    await bulk("pokemon_lottery", ["user_id", "draws", "wins"], [["u1", 6, 0], ["u2", 9, 0], ["u3", 20, 20]]);
    assert.deepEqual((await compute(W1, 1)).trainers.lottery.map((p) => p.user), ["u2", "u1"]);
    configure({ minLotteryDraws: 8 });
    assert.deepEqual((await compute(W1, 1)).trainers.lottery.map((p) => p.user), ["u2"]);
  });

  it("qui n'a jamais perdu n'y figure jamais, et sans personne sous le taux de la saison la section n'existe pas", async () => {
    await bulk("pokemon_lottery", ["user_id", "draws", "wins"], [["u1", 6, 6], ["u2", 5, 5]]);
    assert.equal((await compute(W1, 1)).trainers.lottery, null);
    // Tout le monde perd autant : personne n'est plus malchanceux que les autres.
    await dbRun(points, "UPDATE pokemon_lottery SET wins = 0");
    assert.equal((await compute(W1, 1)).trainers.lottery, null);
    assert.equal(fieldsOf(message(await compute(W1, 1)))["Les moins chanceux à la loterie"], undefined);
  });
});

describe("les podiums d'activité", () => {
  it("les meilleurs nettoyeurs : les objets ramassés dans la saison", async () => {
    const drop = (user, status, at) => dbRun(points, "INSERT INTO pokemon_drops (item_key, status, dropped_at, claimed_by, claimed_at) VALUES ('pepite', ?, 1, ?, ?)", [status, user, at]);
    for (const at of [IN(1), IN(2), IN(3), BEFORE]) await drop("a", "CLAIMED", at);
    for (const at of [IN(1), IN(2)]) await drop("b", "CLAIMED", at);
    await drop(null, "LOST", null);
    await dbRun(points, "INSERT INTO pokemon_drops (item_key, status, dropped_at) VALUES ('pepite', 'OPEN', 1)");
    const { cleaners } = (await compute()).trainers;
    assert.deepEqual(cleaners, [{ user: "a", count: 3 }, { user: "b", count: 2 }]);
    assert.equal(fieldsOf(message(await compute()))["Les meilleurs nettoyeurs"].split("\n")[0], "🥇 <@a> — 3 objets ramassés");
  });

  it("les plus gros visiteurs du safari : les visites commencées dans la saison, avec leurs captures", async () => {
    await addSession("a", { catches: 3 });
    await addSession("a", { at: IN(9), catches: 4 });
    await addSession("b", { catches: 1 });
    await addSession("b", { at: IN(9), catches: 0 });
    await addSession("c", { at: BEFORE, catches: 9 });
    await addSession("c", { at: AFTER, catches: 9 });
    const { safari } = (await compute()).trainers;
    assert.deepEqual(safari.map((p) => [p.user, p.count, p.catches]), [["a", 2, 7], ["b", 2, 1]]);
    assert.equal(fieldsOf(message(await compute()))["Les plus gros visiteurs du safari"].split("\n")[0], "🥇 <@a> — 2 visites, 7 captures");
  });

  it("le meilleur pêcheur : les captures de pêche seulement", async () => {
    await addSpawns(id("Magicarpe"), 3, { status: "CAUGHT", by: "a", fished: 1 });
    await addSpawns(id("Magicarpe"), 1, { status: "CAUGHT", by: "b", fished: 1 });
    await addSpawns(id("Magicarpe"), 4, { status: "FLED", fished: 1 });
    await addSpawns(id("Roucool"), 5, { status: "CAUGHT", by: "c" });
    await addSpawns(id("Magicarpe"), 5, { status: "CAUGHT", by: "a", fished: 1, at: BEFORE });
    const { fishers } = (await compute()).trainers;
    assert.deepEqual(fishers, [{ user: "a", count: 3 }, { user: "b", count: 1 }]);
  });

  it("le plus gros échangeur : les échanges conclus de la saison, des deux côtés", async () => {
    const trade = (from, to, status, at) =>
      dbRun(points, "INSERT INTO pokemon_trades (from_user_id, to_user_id, offer_species_id, request_species_id, status, created_at, expires_at, resolved_at) VALUES (?, ?, 0, 0, ?, 1, 2, ?)", [from, to, status, at]);
    await trade("a", "b", "ACCEPTED", IN());
    await trade("a", "c", "ACCEPTED", IN(5));
    await trade("b", "a", "ACCEPTED", IN(9));
    await trade("c", "a", "DECLINED", IN());
    await trade("a", "c", "PENDING", null);
    await trade("a", "b", "ACCEPTED", BEFORE);
    await trade("a", "b", "ACCEPTED", AFTER);
    const { traders } = (await compute()).trainers;
    assert.deepEqual(traders, [{ user: "a", count: 3 }, { user: "b", count: 2 }, { user: "c", count: 1 }]);
  });
});

// ====================== LA MISE EN FORME ======================

describe("le message", () => {
  it("deux embeds, « Les Pokémon » et « Les dresseurs », et le titre du bilan en tête", async () => {
    await addSpawn(id("Roucool"));
    await addOwned("a", id("Roucool"), IN());
    const built = season.buildSeasonMessage(await compute());
    assert.deepEqual(built.embeds.map((embed) => embed.toJSON().title), ["Les Pokémon", "Les dresseurs"]);
    assert.match(built.content, /^📊 \*\*Bilan de la saison 2\*\*\nDu <t:\d+:D> au <t:\d+:D>\.$/);
    const first = season.buildSeasonMessage(await compute(W1, 1));
    assert.match(first.content, /Bilan de la saison 1\*\*\nDepuis le début, jusqu'au <t:\d+:D>\./);
  });

  it("aucun titre ne porte d'emoji de serveur ni de mention : Discord ne les y rend pas", async () => {
    await addSpawn(id("Roucool"));
    await addOwned("a", id("Roucool"), IN());
    for (const embed of season.buildSeasonMessage(await compute()).embeds) {
      assert.doesNotMatch(embed.toJSON().title, /<[@:#a]/);
    }
  });

  it("une section sans donnée est omise : ni podium vide ni zéro trompeur", async () => {
    await addThrow(await addSpawn(id("Roucool")), "u1", { cost: 100 });
    const built = season.buildSeasonMessage(await compute());
    assert.deepEqual(Object.keys(fieldsOf(built)), ["Apparitions", "Lancers", "Points dépensés", "Les plus apparus", "Les plus timides", "La malchance de la saison", "La plus longue résistance", "La ball préférée du serveur"]);
    assert.deepEqual(built.embeds.map((embed) => embed.toJSON().title), ["Les Pokémon"], "pas un seul dresseur à montrer : pas d'embed « Les dresseurs »");
    for (const value of Object.values(fieldsOf(built))) assert.ok(value.trim().length > 0);
  });

  it("une base vide ne donne aucun embed : il n'y a rien à publier", async () => {
    assert.deepEqual(season.buildSeasonMessage(await compute()).embeds, []);
    assert.deepEqual(season.buildSeasonMessage(await compute(W1, 1)).embeds, []);
  });

  it("une lecture qui échoue omet la section au lieu d'afficher un zéro", async () => {
    await addSpawn(id("Roucool"));
    await addThrow(await addSpawn(id("Roucool")), "u1");
    await bulk("pokemon_sales", ["user_id", "species_id", "quantity", "points", "sold_at"], [["u1", id("Roucool"), 2, 500, IN()]]);
    await dbRun(points, "ALTER TABLE pokemon_sales RENAME TO pokemon_sales_off");
    try {
      const { result: payload, errors } = await quiet(() => compute());
      assert.equal(payload.pokemon.mostSold, null);
      assert.deepEqual(payload.failures, ["plus vendus"], "l'échec est rapporté à qui publie");
      assert.ok(errors.some((line) => line.includes("plus vendus")), "l'échec est journalisé");
      const fields = fieldsOf(message(payload));
      assert.equal(fields["Les plus vendus"], undefined);
      assert.ok(fields.Apparitions && fields.Lancers, "les autres sections ne sont pas emportées");
    } finally {
      await dbRun(points, "ALTER TABLE pokemon_sales_off RENAME TO pokemon_sales");
    }
  });

  it("des lancers illisibles retirent aussi les points dépensés : leur total serait faux", async () => {
    await addSpawn(id("Roucool"));
    await dbRun(points, "ALTER TABLE pokemon_throws RENAME TO pokemon_throws_off");
    try {
      const { result: payload } = await quiet(() => compute());
      const fields = fieldsOf(message(payload));
      assert.equal(fields.Lancers, undefined);
      assert.equal(fields["Points dépensés"], undefined);
      assert.ok(fields.Apparitions);
    } finally {
      await dbRun(points, "ALTER TABLE pokemon_throws_off RENAME TO pokemon_throws");
    }
  });

  it("de grosses données restent dans les limites de Discord : 25 champs, 1 024 caractères, 6 000 au total", async () => {
    configure({ topSize: 10, podiumSize: 10, minThrowsForLuck: 30, minLotteryDraws: 5 });
    const everyone = data.allSpecies(2);
    const users = Array.from({ length: 60 }, (_, index) => `${1_000_000_000_000_000_000n + BigInt(index)}`);
    // Des apparitions, des fuites, des captures et des ventes de toutes les espèces.
    const spawnRows = everyone.flatMap((s, index) => Array.from({ length: 1 + (index % 7) }, (_, k) => [s.id, k % 2 ? "FLED" : "CAUGHT", IN(k), IN(k), users[index % users.length], 45]));
    await bulk("pokemon_spawns", ["species_id", "status", "spawned_at", "caught_at", "caught_by", "catch_rate"], spawnRows);
    await bulk("pokemon_sales", ["user_id", "species_id", "quantity", "points", "sold_at"], everyone.map((s, index) => [users[0], s.id, 1 + (index % 9), 1, IN()]));
    // Chaque légendaire attrapé, par un dresseur différent, certains shiny.
    const legendaries = everyone.filter(data.isLegendary);
    await bulk("pokemon_spawns", ["species_id", "status", "spawned_at", "caught_at", "caught_by", "catch_rate", "is_shiny"], legendaries.map((s, index) => [s.id, "CAUGHT", IN(), IN(), users[index], 3, index % 2]));
    for (const [index, user] of users.entries()) {
      await addThrows(user, { count: 30 + index, catches: 5 + (index % 20), p: 0.3 });
      await bulk("pokemon_lottery_draws", ["user_id", "won", "drawn_at"], Array.from({ length: 6 }, (_, k) => [user, k < index % 5 ? 1 : 0, IN()]));
      await addOwned(user, everyone[index].id, IN(index));
      await addLog(user, index % 2 ? "ball_master" : "pepite", 1 + (index % 3), "capture:1");
      await addSession(user, { catches: index });
      await dbRun(points, "INSERT INTO pokemon_drops (item_key, status, dropped_at, claimed_by, claimed_at) VALUES ('pepite', 'CLAIMED', 1, ?, ?)", [user, IN(index)]);
      await dbRun(points, "INSERT INTO pokemon_trades (from_user_id, to_user_id, offer_species_id, request_species_id, status, created_at, expires_at, resolved_at) VALUES (?, ?, 0, 0, 'ACCEPTED', 1, 2, ?)", [user, users[(index + 1) % users.length], IN(index)]);
    }
    await addSpawns(id("Magicarpe"), 25, { status: "CAUGHT", by: users[3], fished: 1 });
    const built = season.buildSeasonMessage(await compute());
    assert.equal(built.embeds.length, 2);
    let total = 0;
    let lists = 0;
    for (const embed of built.embeds.map((e) => e.toJSON())) {
      assert.ok(embed.fields.length <= 25);
      assert.ok((embed.description?.length ?? 0) <= 4096);
      total += embed.title.length + (embed.description?.length ?? 0) + embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
      for (const field of embed.fields) {
        assert.ok(field.value.length > 0 && field.value.length <= 1024, `${field.name} : ${field.value.length}`);
        if (field.value.split("\n").length > 1) lists++;
      }
    }
    assert.ok(total <= 6000, `${total} caractères pour l'ensemble des embeds`);
    assert.ok(lists >= 8, "les classements sont bien là, écourtés mais présents");
    const fields = fieldsOf(built);
    assert.match(fields["Les champions de la saison"].split("\n")[0], /^🥇 <@1000000000000000/, "le haut d'un classement est ce qui reste");
  });
});

// ====================== LA PUBLICATION ======================

describe("publier le bilan", () => {
  const AT = OPEN2 + HOUR;

  // Un client dont le salon note ce qu'on y publie ; `failures` : les envois qui échouent d'abord.
  function discord({ failures = 0 } = {}) {
    const sent = [];
    let attempts = 0;
    const channel = {
      id: "123",
      send: async (payload) => {
        attempts++;
        if (attempts <= failures) throw new Error("salon fermé");
        sent.push(payload);
        return { id: `msg-${sent.length}` };
      },
    };
    return { sent, attempts: () => attempts, client: { channels: { fetch: async () => channel } } };
  }
  const rows = () => dbAll(points, "SELECT * FROM pokemon_season_recaps ORDER BY season");
  const seedSeason1 = async () => {
    await addSpawn(id("Roucool"), { at: OPEN2 - HOUR });
    await addThrow(await addSpawn(id("Rattata"), { at: OPEN2 - HOUR }), "u1", { at: OPEN2 - HOUR });
    // Un événement de la saison 2 : le bilan de la 1 ne le montre pas.
    await addSpawn(id("Roucool"), { at: OPEN2 + 1 });
  };

  it("part une seule fois, même avec dix passages simultanés, sans réveiller personne", async () => {
    await seedSeason1();
    const { client, sent } = discord();
    await Promise.all(Array.from({ length: 10 }, () => season.publishSeasonRecaps(client, { now: AT })));
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].allowedMentions, { parse: [] }, "les mentions des podiums ne notifient personne");
    assert.match(sent[0].content, /Bilan de la saison 1/);
    assert.deepEqual(sent[0].embeds.map((embed) => embed.toJSON().title), ["Les Pokémon"]);
    const [row] = await rows();
    assert.deepEqual([row.season, row.started_at, row.ended_at, row.channel_id, row.message_id], [1, 0, OPEN2, "123", "msg-1"]);
    assert.equal(row.posted_at, AT);
    assert.equal(row.attempts, 1);
    // Plus tard, rien ne repart.
    await season.publishSeasonRecaps(client, { now: AT + 5 * MINUTE });
    await season.publishSeasonRecaps(client, { now: AT + DAY });
    assert.equal(sent.length, 1);
  });

  it("enregistre le résultat calculé, sur la fenêtre de la saison seulement", async () => {
    await seedSeason1();
    const { client } = discord();
    await season.publishSeasonRecaps(client, { now: AT });
    const payload = JSON.parse((await rows())[0].payload);
    assert.deepEqual([payload.version, payload.season, payload.start, payload.end], [1, 1, 0, OPEN2]);
    assert.equal(payload.pokemon.spawns, 2, "l'apparition de la saison 2 n'y est pas");
    assert.deepEqual(payload.pokemon.throws, { total: 1, safari: 0 });
  });

  it("pas de bilan tant que la génération suivante n'est pas ouverte", async () => {
    await seedSeason1();
    const { client, sent } = discord();
    await season.publishSeasonRecaps(client, { now: OPEN2 - 1 });
    assert.equal(sent.length, 0);
    assert.deepEqual(await rows(), [], "pas même une ligne de revendication");
    await season.publishSeasonRecaps(client, { now: OPEN2 });
    assert.equal(sent.length, 1, "à l'instant d'ouverture, il part");
  });

  it("un salon qui refuse : l'échec est journalisé, puis le bilan est retenté après une attente qui grandit", async () => {
    await seedSeason1();
    const { client, sent, attempts } = discord({ failures: 2 });
    const first = await quiet(() => season.publishSeasonRecaps(client, { now: AT }));
    assert.ok(first.errors.some((line) => line.includes("Bilan de la saison 1") && line.includes("salon fermé")));
    let [row] = await rows();
    assert.deepEqual([row.posted_at, row.attempts, row.claimed_at], [null, 1, AT]);

    // Trop tôt : le prochain passage ne tente rien, et ne remplit pas le journal.
    const early = await quiet(() => season.publishSeasonRecaps(client, { now: AT + 9 * MINUTE }));
    assert.equal(attempts(), 1);
    assert.deepEqual(early.errors, []);

    // Dix minutes après le premier essai : deuxième essai, qui échoue aussi.
    await quiet(() => season.publishSeasonRecaps(client, { now: AT + 10 * MINUTE }));
    assert.equal(attempts(), 2);
    [row] = await rows();
    assert.equal(row.attempts, 2);

    // Le deuxième échec double l'attente : vingt minutes.
    await quiet(() => season.publishSeasonRecaps(client, { now: AT + 10 * MINUTE + 19 * MINUTE }));
    assert.equal(attempts(), 2);
    await season.publishSeasonRecaps(client, { now: AT + 10 * MINUTE + 20 * MINUTE });
    assert.equal(sent.length, 1, "publié au troisième essai");
    [row] = await rows();
    assert.deepEqual([row.attempts, row.posted_at, row.message_id], [3, AT + 30 * MINUTE, "msg-1"]);
    await season.publishSeasonRecaps(client, { now: AT + 2 * DAY });
    assert.equal(sent.length, 1);
  });

  it("l'attente après un échec se règle (pokemon.seasonRecap.retryMinutes)", async () => {
    await seedSeason1();
    configure({ retryMinutes: 3 });
    const { client, attempts } = discord({ failures: 1 });
    await quiet(() => season.publishSeasonRecaps(client, { now: AT }));
    await season.publishSeasonRecaps(client, { now: AT + 2 * MINUTE });
    assert.equal(attempts(), 1);
    await season.publishSeasonRecaps(client, { now: AT + 3 * MINUTE });
    assert.equal(attempts(), 2);
  });

  it("un envoi interrompu par un arrêt (bail pris, jamais conclu) est retenté quand le bail a expiré", async () => {
    await seedSeason1();
    await dbRun(points, "INSERT INTO pokemon_season_recaps (season, started_at, ended_at, claimed_at, attempts) VALUES (1, 0, ?, ?, 1)", [OPEN2, AT - 4 * MINUTE]);
    const { client, sent } = discord();
    await season.publishSeasonRecaps(client, { now: AT });
    assert.equal(sent.length, 0, "le bail est encore valable : un autre passage est peut-être en train d'envoyer");
    await season.publishSeasonRecaps(client, { now: AT + 6 * MINUTE });
    assert.equal(sent.length, 1);
  });

  it("une lecture en échec n'est ni un bilan amputé ni une saison vide : rien ne part, la saison reste ouverte, puis il est retenté", async () => {
    await seedSeason1();
    await bulk("pokemon_sales", ["user_id", "species_id", "quantity", "points", "sold_at"], [["u1", id("Roucool"), 2, 500, OPEN2 - HOUR]]);
    const { client, sent } = discord();
    await dbRun(points, "ALTER TABLE pokemon_sales RENAME TO pokemon_sales_off");
    try {
      const failed = await quiet(() => season.publishSeasonRecaps(client, { now: AT }));
      assert.ok(failed.errors.some((line) => line.includes("lecture impossible (plus vendus)")), "la panne est journalisée");
      assert.equal(sent.length, 0, "pas de bilan sans « Les plus vendus »");
      const [row] = await rows();
      assert.deepEqual([row.posted_at, row.skipped_at, row.attempts], [null, null, 1]);
    } finally {
      await dbRun(points, "ALTER TABLE pokemon_sales_off RENAME TO pokemon_sales");
    }
    // Avec l'attente habituelle : trop tôt rien, puis il part, complet.
    await season.publishSeasonRecaps(client, { now: AT + 9 * MINUTE });
    assert.equal(sent.length, 0);
    await season.publishSeasonRecaps(client, { now: AT + 10 * MINUTE });
    assert.equal(sent.length, 1);
    assert.ok(sent[0].embeds[0].toJSON().fields.some((field) => field.name === "Les plus vendus"));
    const [row] = await rows();
    assert.deepEqual(JSON.parse(row.payload).failures, []);
  });

  it("une saison sans donnée mais dont une lecture a échoué n'est pas close « rien à raconter » : seule une saison vraiment vide l'est", async () => {
    const { client, sent } = discord();
    await dbRun(points, "ALTER TABLE pokemon_sales RENAME TO pokemon_sales_off");
    try {
      await quiet(() => season.publishSeasonRecaps(client, { now: AT }));
    } finally {
      await dbRun(points, "ALTER TABLE pokemon_sales_off RENAME TO pokemon_sales");
    }
    assert.equal((await rows())[0].skipped_at, null, "elle sera relue");
    await season.publishSeasonRecaps(client, { now: AT + 10 * MINUTE });
    const [row] = await rows();
    assert.deepEqual([row.posted_at, row.skipped_at], [null, AT + 10 * MINUTE], "lue sans panne, elle est vide : close");
    assert.equal(sent.length, 0);
  });

  // Une panne de l'écriture « posté », au bord du pilote : les `times` premières écritures de
  // posted_at échouent. Un déclencheur ne saurait compter ses échecs, il annulerait aussi son compteur.
  function failPostedWrites(times) {
    const original = points.run;
    const state = { calls: 0 };
    points.run = function (sql, ...args) {
      if (/SET\s+posted_at/.test(sql)) {
        state.calls++;
        if (state.calls <= times) {
          const callback = args.at(-1);
          return queueMicrotask(() => callback.call({ changes: 0 }, new Error("panne")));
        }
      }
      return original.call(this, sql, ...args);
    };
    return { state, restore: () => (points.run = original) };
  }

  it("un message parti dont l'écriture « posté » échoue : elle est retentée, et le bilan ne repart pas", async () => {
    await seedSeason1();
    configure({ recordRetries: 3, recordRetryDelayMs: 1 });
    const { client, sent } = discord();
    const fault = failPostedWrites(2);
    try {
      await season.publishSeasonRecaps(client, { now: AT });
    } finally {
      fault.restore();
    }
    assert.equal(fault.state.calls, 3, "deux échecs, puis l'écriture passe");
    assert.equal(sent.length, 1);
    const [row] = await rows();
    assert.deepEqual([row.posted_at, row.message_id], [AT, "msg-1"]);
    // Plus tard, le bail ne ramène rien : la saison est close.
    await season.publishSeasonRecaps(client, { now: AT + DAY });
    assert.equal(sent.length, 1);
  });

  it("au bout des retentatives l'écriture « posté » est abandonnée avec un message sans détour, sans relire le salon", async () => {
    await seedSeason1();
    configure({ recordRetries: 2, recordRetryDelayMs: 1 });
    const { client, sent } = discord();
    const fault = failPostedWrites(Infinity);
    let result;
    try {
      result = await quiet(() => season.publishSeasonRecaps(client, { now: AT }));
    } finally {
      fault.restore();
    }
    assert.equal(fault.state.calls, 3, "un essai et deux retentatives, pas plus");
    assert.ok(result.errors.some((line) => line.includes("publié mais non enregistré (3 essai(s))") && line.includes("panne")));
    assert.equal(sent.length, 1);
    assert.equal((await rows())[0].posted_at, null);
    // Le faux salon n'a pas d'historique à lire : s'il était relu, ce test planterait.
  });

  it("zéro retentative : une seule écriture", async () => {
    await seedSeason1();
    configure({ recordRetries: 0 });
    const { client } = discord();
    const fault = failPostedWrites(Infinity);
    try {
      await quiet(() => season.publishSeasonRecaps(client, { now: AT }));
    } finally {
      fault.restore();
    }
    assert.equal(fault.state.calls, 1);
  });

  it("une saison finie depuis plus de publishWithinHours est sautée, sans un mot dans le salon", async () => {
    await seedSeason1();
    const { client, sent } = discord();
    await season.publishSeasonRecaps(client, { now: OPEN2 + 168 * HOUR + 1 });
    assert.equal(sent.length, 0);
    const [row] = await rows();
    assert.deepEqual([row.posted_at, row.skipped_at, row.attempts], [null, OPEN2 + 168 * HOUR + 1, 0]);
    // Plus tard, ou si l'on rallonge la durée, elle reste sautée : c'est une décision prise.
    configure({ publishWithinHours: 100000 });
    await season.publishSeasonRecaps(client, { now: OPEN2 + 169 * HOUR });
    assert.equal(sent.length, 0);
  });

  it("la limite est incluse : à publishWithinHours pile, le bilan part encore ; et elle se règle", async () => {
    await seedSeason1();
    const { client, sent } = discord();
    await season.publishSeasonRecaps(client, { now: OPEN2 + 168 * HOUR });
    assert.equal(sent.length, 1);
    await dbRun(points, "DELETE FROM pokemon_season_recaps");
    configure({ publishWithinHours: 24 });
    await season.publishSeasonRecaps(client, { now: OPEN2 + 25 * HOUR });
    assert.equal(sent.length, 1, "25 h > 24 h : sautée");
    assert.equal((await rows())[0].skipped_at, OPEN2 + 25 * HOUR);
  });

  it("une base neuve avec de vieilles ouvertures reste muette", async () => {
    // Aucune donnée et une ouverture lointaine : rien ne part, la saison est close sans bruit.
    const { client, sent } = discord();
    await season.publishSeasonRecaps(client, { now: OPEN2 + 400 * DAY });
    assert.equal(sent.length, 0);
    assert.notEqual((await rows())[0].skipped_at, null);
  });

  it("une saison sans rien à raconter n'est pas publiée, ni retentée", async () => {
    const { client, sent, attempts } = discord();
    await season.publishSeasonRecaps(client, { now: AT });
    await season.publishSeasonRecaps(client, { now: AT + DAY });
    assert.equal(sent.length, 0);
    assert.equal(attempts(), 0);
    const [row] = await rows();
    assert.deepEqual([row.posted_at, row.skipped_at], [null, AT]);
  });

  it("désactivé par la configuration, ou sans salon : rien n'est revendiqué", async () => {
    await seedSeason1();
    const { client, sent } = discord();
    configure({ enabled: false });
    await season.publishSeasonRecaps(client, { now: AT });
    sandbox.writeConfig({ pokemon: { ...BASE.pokemon, enabled: false } });
    await season.publishSeasonRecaps(client, { now: AT });
    sandbox.writeConfig(BASE);
    const channelId = process.env.POKEMON_CHANNEL_ID;
    delete process.env.POKEMON_CHANNEL_ID;
    try {
      await season.publishSeasonRecaps(client, { now: AT });
    } finally {
      process.env.POKEMON_CHANNEL_ID = channelId;
    }
    assert.equal(sent.length, 0);
    assert.deepEqual(await rows(), []);
    await season.publishSeasonRecaps(client, { now: AT });
    assert.equal(sent.length, 1, "la configuration rétablie, il part");
  });

  it("les bornes sont figées à la première tentative : retoucher la date ensuite ne déplace rien", async () => {
    await seedSeason1();
    const { client } = discord({ failures: 1 });
    await quiet(() => season.publishSeasonRecaps(client, { now: AT }));
    sandbox.writeConfig({ pokemon: { generationOpenings: { 2: new Date(OPEN2 - DAY).toISOString() } } });
    await season.publishSeasonRecaps(client, { now: AT + 10 * MINUTE });
    const [row] = await rows();
    assert.equal(row.ended_at, OPEN2);
    assert.equal(JSON.parse(row.payload).end, OPEN2);
  });

  it("une génération ouverte avant l'heure (réglage `generation`) publie sur l'instant de son annonce", async () => {
    const announced = OPEN2 + 3 * DAY;
    sandbox.writeConfig({ pokemon: { generation: 2, generationOpenings: { 2: "2999-01-01T00:00:00Z" } } });
    await dbRun(points, "INSERT INTO pokemon_generations (generation, announced_at) VALUES (2, ?)", [announced]);
    await addSpawn(id("Roucool"), { at: announced - HOUR });
    await addSpawn(id("Roucool"), { at: announced + HOUR });
    const { client, sent } = discord();
    await season.publishSeasonRecaps(client, { now: announced + MINUTE });
    assert.equal(sent.length, 1);
    const [row] = await rows();
    assert.equal(row.ended_at, announced);
    assert.equal(JSON.parse(row.payload).pokemon.spawns, 1);
  });
});

describe("l'aperçu de la saison en cours", () => {
  it("de l'ouverture à maintenant, même mise en forme, sans rien écrire", async () => {
    const now = OPEN2 + 2 * DAY;
    await addSpawn(id("Roucool"), { at: OPEN2 + HOUR });
    await addSpawn(id("Roucool"), { at: OPEN2 - HOUR });
    await addSpawn(id("Roucool"), { at: now + HOUR });
    const preview = await season.previewSeason({ now });
    assert.equal(preview.ok, true);
    assert.equal(preview.season, 2);
    assert.match(preview.content, /Aperçu de la saison 2\*\* — rien n'est publié ni enregistré\.\nDu <t:\d+:D> à maintenant\./);
    assert.match(fieldsOf(preview).Apparitions, /\*\*1\*\* Pokémon est apparu/);
    assert.deepEqual(await dbAll(points, "SELECT * FROM pokemon_season_recaps"), []);
  });

  it("une rubrique illisible est signalée dans l'aperçu : elle n'est pas prise pour une rubrique vide", async () => {
    await addSpawn(id("Roucool"), { at: OPEN2 + HOUR });
    await dbRun(points, "ALTER TABLE pokemon_sales RENAME TO pokemon_sales_off");
    try {
      const { result: preview } = await quiet(() => season.previewSeason({ now: OPEN2 + DAY }));
      assert.match(preview.content, /\n⚠️ Lecture impossible, rubriques absentes : plus vendus\./);
      assert.ok(fieldsOf(preview).Apparitions, "le reste de l'aperçu est là");
    } finally {
      await dbRun(points, "ALTER TABLE pokemon_sales_off RENAME TO pokemon_sales");
    }
  });

  it("la saison 1 court depuis le début des données", async () => {
    sandbox.writeConfig({ pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00Z" } } });
    await addSpawn(id("Roucool"), { at: 5 });
    const preview = await season.previewSeason({ now: Date.now() });
    assert.equal(preview.season, 1);
    assert.match(preview.content, /Depuis le début, jusqu'à maintenant\./);
    assert.match(fieldsOf(preview).Apparitions, /\*\*1\*\*/);
  });

  it("sans rien à raconter, il le dit ; l'ouverture inconnue est un refus, pas une saison de 0 à maintenant", async () => {
    const empty = await season.previewSeason({ now: OPEN2 + DAY });
    assert.deepEqual(empty.embeds, []);
    assert.match(empty.content, /Rien à raconter pour l'instant/);
    sandbox.writeConfig({ pokemon: { generation: 2, generationOpenings: { 2: "2999-01-01T00:00:00Z" } } });
    const unknown = await season.previewSeason({ now: OPEN2 });
    assert.equal(unknown.ok, false);
    assert.match(unknown.reason, /ouverture de la 2e génération n'est pas encore enregistrée/);
  });
});
