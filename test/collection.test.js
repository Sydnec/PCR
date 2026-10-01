// La collection d'un dresseur : ce qu'il possède, ce qu'il peut céder, ce qu'il
// verrouille, et les échanges. Une entrée de Pokédex est une espèce : il en reste
// toujours un, quoi qu'on retire — c'est l'invariant que ces tests surveillent.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbAll, dbGet, speciesByName } from "./helpers.js";

createSandbox({ config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } } });
const { points } = await openDatabases();
const collection = await import("../modules/pokemon/collection.js");
const data = await import("../modules/pokemon/data.js");
const { getPokemonConfig } = await import("../modules/pokemon/config.js");

const call = (fn, ...args) =>
  new Promise((resolve, reject) =>
    fn(...args, (error, ...rest) => (error ? reject(error) : resolve(rest.length > 1 ? rest : rest[0])))
  );
const species = (name) => speciesByName(data.allSpecies, name);

async function give(name, { user = "u1", shiny = 0, sex = "M", obtained = 1, sterile = 0, locked = 0, form = null, showcase = null, nickname = null, pc = null } = {}) {
  const { lastID } = await dbRun(
    points,
    `INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, sterile, obtained_at, locked, form, showcase_pos, nickname, pc_pos)
     VALUES (?, ?, ?, ?, 'test', ?, ?, ?, ?, ?, ?, ?)`,
    [user, species(name).id, shiny, sex, sterile, obtained, locked, form, showcase, nickname, pc]
  );
  return lastID;
}
const giveMany = async (name, quantity, options = {}) => {
  const ids = [];
  for (let index = 0; index < quantity; index++) ids.push(await give(name, { obtained: index + 1, ...options }));
  return ids;
};
const owned = (user = "u1") => dbAll(points, "SELECT * FROM pokemon_owned WHERE user_id = ? ORDER BY id", [user]);
const ofSpecies = async (name, user = "u1") => (await owned(user)).filter((row) => row.species_id === species(name).id);

beforeEach(async () => {
  await dbRun(points, "DROP TRIGGER IF EXISTS panne");
  for (const table of ["pokemon_owned", "pokemon_trades", "pokemon_inventory", "points"]) await dbRun(points, `DELETE FROM ${table}`);
});

describe("désigner un Pokémon", () => {
  it("un groupe et un individu s'encodent sans se confondre", () => {
    assert.equal(collection.encodeIndividual(42), "#42");
    assert.equal(collection.parseIndividual("#42"), 42);
    assert.equal(collection.parseIndividual(" 42 "), 42, "un nombre tapé sans dièse vaut identifiant");
    assert.equal(collection.parseIndividual("25:1"), null, "un groupe contient toujours « : »");
    assert.equal(collection.parseIndividual(""), null);
    assert.equal(collection.parseIndividual(undefined), null);
    assert.equal(collection.parseIndividual("#abc"), null);
  });

  it("un groupe fait l'aller-retour, avec sexe et fertilité facultatifs", () => {
    assert.equal(collection.encodeEntry(25, false), "25:0");
    assert.equal(collection.encodeEntry(25, true, "F"), "25:1:F");
    assert.equal(collection.encodeEntry(25, true, null, false), "25:1::0");
    assert.deepEqual(collection.decodeEntry("25:1:F:1"), { speciesId: 25, isShiny: true, sex: "F", fertile: true });
    assert.deepEqual(collection.decodeEntry("25:0"), { speciesId: 25, isShiny: false, sex: null, fertile: null });
    assert.deepEqual(collection.decodeEntry("25:1::0"), { speciesId: 25, isShiny: true, sex: null, fertile: false });
    assert.deepEqual(collection.decodeEntry("#7"), { pokemonId: 7 });
    assert.equal(collection.decodeEntry("25:0:X").sex, null, "un sexe inconnu n'est pas un sexe");
  });

  it("un groupe se résout sans base, un identifiant se résout en base et doit être à soi", async () => {
    const mine = await give("Rattata");
    const theirs = await give("Rattata", { user: "u2" });

    const group = await call(collection.resolveSelector, "u1", collection.encodeEntry(species("Rattata").id, false));
    assert.equal(group.pokemonId, null);
    assert.equal(group.speciesId, species("Rattata").id);

    const own = await call(collection.resolveSelector, "u1", collection.encodeIndividual(mine));
    assert.equal(own.pokemonId, mine);
    assert.equal(own.speciesId, species("Rattata").id);
    assert.equal(own.row.id, mine);

    const stolen = await call(collection.resolveSelector, "u1", collection.encodeIndividual(theirs));
    assert.match(stolen.error, new RegExp(`#${theirs} n'est pas dans cette boîte`));
    const missing = await call(collection.resolveSelector, "u1", "#99999");
    assert.match(missing.error, /n'est pas dans cette boîte/);
  });

  it("une valeur d'autocomplétion est revalidée : espèce périmée, individu mal tapé, mauvaise espèce", async () => {
    const rattata = await give("Rattata");
    assert.deepEqual(collection.resolveSpecies(species("Rattata").id), { species: species("Rattata") });
    assert.match(collection.resolveSpecies("pas un nombre").error, /autocomplétion/);
    assert.match(collection.resolveSpecies(99999).error, /autocomplétion/);

    assert.match((await call(collection.resolveIndividual, "u1", 99999, `#${rattata}`)).error, /autocomplétion/);
    assert.match((await call(collection.resolveIndividual, "u1", species("Rattata").id, "n'importe quoi")).error, /Choisis le Rattata/);
    assert.match(
      (await call(collection.resolveIndividual, "u1", species("Roucool").id, `#${rattata}`)).error,
      new RegExp(`#${rattata} n'est pas un Roucool`)
    );
    const ok = await call(collection.resolveIndividual, "u1", species("Rattata").id, `#${rattata}`);
    assert.equal(ok.pokemonId, rattata);
  });
});

describe("lire la collection", () => {
  it("une ligne par espèce et variante, avec le nombre et la première capture", async () => {
    await give("Rattata", { obtained: 50 });
    await give("Rattata", { obtained: 10 });
    await give("Rattata", { shiny: 1, obtained: 70 });
    await give("Roucool", { obtained: 5, user: "u2" });
    const rows = await call(collection.getCollection, "u1");
    assert.deepEqual(
      rows.map((row) => ({ species: row.species_id, shiny: row.is_shiny, count: row.count, first: row.first_caught_at })),
      [
        { species: species("Rattata").id, shiny: 0, count: 2, first: 10 },
        { species: species("Rattata").id, shiny: 1, count: 1, first: 70 },
      ]
    );
  });

  it("les individus disent lequel est le dernier de son espèce, shiny compris", async () => {
    const [a, b] = await giveMany("Rattata", 2);
    const lone = await give("Roucool");
    const shinyOnly = await give("Rattata", { shiny: 1, obtained: 9 });
    const rows = await call(collection.getIndividuals, "u1");
    const last = Object.fromEntries(rows.map((row) => [row.id, row.last]));
    assert.equal(last[a], 0);
    assert.equal(last[b], 0);
    assert.equal(last[shinyOnly], 0, "le shiny compte dans l'espèce : un Rattata normal reste à côté");
    assert.equal(last[lone], 1);
    assert.deepEqual(await call(collection.getIndividuals, "inconnu"), []);
  });

  it("un individu seul se lit avec son `last`, ou null", async () => {
    const id = await give("Rattata");
    assert.equal((await call(collection.getIndividual, id)).last, 1);
    assert.equal(await call(collection.getIndividual, 99999), null);
  });

  it("compte par espèce ce qu'on peut céder : tout sauf un, jamais un verrouillé", async () => {
    await giveMany("Rattata", 3);
    await give("Rattata", { shiny: 1, obtained: 4, locked: 1 });
    await give("Roucool", { locked: 1 });
    await give("Roucool", { locked: 1, obtained: 2 });
    const counts = collection.countBySpecies(await owned());
    const rattata = counts.get(species("Rattata").id);
    assert.deepEqual(
      { total: rattata.total, normal: rattata.normal, shiny: rattata.shiny, free: rattata.free, freeNormal: rattata.freeNormal, spare: rattata.spare },
      { total: 4, normal: 3, shiny: 1, free: 3, freeNormal: 3, spare: 3 }
    );
    assert.equal(counts.get(species("Roucool").id).spare, 0, "tous verrouillés : rien à céder");
  });

  it("des groupes d'une même espèce se partagent la marge, sans la dépasser", async () => {
    await giveMany("Rattata", 2);
    await give("Rattata", { shiny: 1, obtained: 3 });
    const groups = collection.groupIndividuals(await owned());
    assert.equal(groups.length, 2);
    for (const group of groups) assert.ok(group.spare <= 2, "au plus total - 1");
    const normal = groups.find((group) => !group.isShiny);
    assert.equal(normal.count, 2);
    assert.equal(normal.spare, 2);
  });

  it("par sexe et par fertilité quand on le demande", async () => {
    await give("Rattata", { sex: "M", obtained: 1 });
    await give("Rattata", { sex: "F", obtained: 2 });
    await give("Rattata", { sex: "F", sterile: 1, obtained: 3 });
    const rows = await owned();
    assert.equal(collection.groupIndividuals(rows).length, 1);
    const bySex = collection.groupIndividuals(rows, { bySex: true });
    assert.deepEqual(bySex.map((group) => [group.sex, group.count]).sort(), [["F", 2], ["M", 1]]);
    const full = collection.groupIndividuals(rows, { bySex: true, byFertility: true });
    assert.equal(full.length, 3);
    assert.equal(full.find((group) => group.sex === "F" && group.fertile === false).count, 1);
  });

  it("combien en possède-t-on, combien verrouillés, combien cédables", async () => {
    await giveMany("Rattata", 3);
    await give("Rattata", { locked: 1, obtained: 4 });
    const group = { speciesId: species("Rattata").id, isShiny: false };
    assert.deepEqual(await call(collection.countGroup, "u1", group), { owned: 4, locked: 1, spare: 3 });
    assert.deepEqual(await call(collection.countGroup, "u1", { speciesId: species("Roucool").id, isShiny: null }), { owned: 0, locked: 0, spare: 0 });
    assert.deepEqual(await call(collection.countSpecies, "u1", species("Rattata").id), { total: 4, free: 3 });
    assert.deepEqual(await call(collection.countSpecies, "u1", species("Roucool").id), { total: 0, free: 0 });
  });

  it("un groupe se filtre par sexe, fertilité et individu", async () => {
    const male = await give("Rattata", { sex: "M" });
    await give("Rattata", { sex: "F", obtained: 2 });
    await give("Rattata", { sex: "F", sterile: 1, obtained: 3 });
    const base = { speciesId: species("Rattata").id, isShiny: null };
    assert.equal((await call(collection.countGroup, "u1", { ...base, sex: "F" })).owned, 2);
    assert.equal((await call(collection.countGroup, "u1", { ...base, sex: "F", fertile: true })).owned, 1);
    assert.equal((await call(collection.countGroup, "u1", { ...base, fertile: false })).owned, 1);
    assert.equal((await call(collection.countGroup, "u1", { ...base, pokemonId: male })).owned, 1);
  });

  it("les variantes d'une espèce, une entrée par identifiant demandé même à zéro", async () => {
    await giveMany("Rattata", 2);
    await give("Rattata", { shiny: 1, obtained: 5 });
    assert.deepEqual(await call(collection.getOwnedVariants, "u1", species("Rattata").id), { normal: 2, shiny: 1 });
    assert.deepEqual(await call(collection.getOwnedVariants, "u1", species("Roucool").id), { normal: 0, shiny: 0 });
    const many = await call(collection.getOwnedVariantsFor, "u1", [species("Rattata").id, species("Roucool").id, "pas un id", species("Rattata").id]);
    assert.equal(many.size, 2, "les doublons et les valeurs absurdes sont écartés");
    assert.deepEqual(many.get(species("Roucool").id), { normal: 0, shiny: 0 });
    assert.equal((await call(collection.getOwnedVariantsFor, "u1", [])).size, 0);
  });

  it("les formes possédées d'une espèce à formes, lues sans filtre de génération", async () => {
    const unown = data.allSpeciesData().find((entry) => entry.name === "Zarbi");
    for (const key of ["a", "b", "a"]) {
      await dbRun(points, "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at, form) VALUES ('u1', ?, 0, NULL, 'test', 1, ?)", [unown.id, key]);
    }
    await dbRun(points, "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at) VALUES ('u1', ?, 0, 'M', 'test', 1)", [species("Rattata").id]);
    assert.deepEqual([...(await call(collection.getOwnedForms, "u1", unown.id))].sort(), ["a", "b"]);
    assert.equal((await call(collection.getOwnedForms, "u1", species("Rattata").id)).size, 0, "pas de forme : un ensemble vide");
  });

  it("la fiche d'une espèce lit toute sa lignée, et n'a rien à dire des formes d'une espèce qui n'en a pas", async () => {
    await give("Rattata");
    await give("Rattatac", { shiny: 1 });
    const sheet = await call(collection.getSpeciesOwnership, "u1", species("Rattata"));
    assert.equal(sheet.forms, null);
    assert.deepEqual(sheet.owned.get(species("Rattata").id), { normal: 1, shiny: 0 });
    assert.deepEqual(sheet.owned.get(species("Rattatac").id), { normal: 0, shiny: 1 });
  });

  it("le classement ordonne par Pokédex, puis shiny, puis total", async () => {
    await giveMany("Rattata", 3, { user: "gros" });
    await give("Roucool", { user: "dex" });
    await give("Rattata", { user: "dex" });
    await give("Roucool", { user: "chroma", shiny: 1 });
    await give("Rattata", { user: "chroma" });
    const board = await call(collection.getLeaderboard, 10);
    assert.deepEqual(board.map((row) => row.user_id), ["chroma", "dex", "gros"]);
    assert.deepEqual(board.map((row) => [row.dex, row.shinies, row.total]), [[2, 1, 2], [2, 0, 2], [1, 0, 3]]);
    assert.equal((await call(collection.getLeaderboard, 1)).length, 1);
  });
});

describe("les doublons qu'on peut céder", () => {
  it("n'en propose que lorsqu'il en reste un en plus qui ne soit pas verrouillé, et dit combien", async () => {
    await giveMany("Rattata", 3);
    await give("Roucool", { locked: 1 });
    await give("Roucool", { locked: 1, obtained: 2 });
    const list = collection.listDuplicates(await owned());
    assert.deepEqual(list.map((entry) => [entry.speciesId, entry.spare]), [[species("Rattata").id, 2]]);
  });

  it("met de côté ce qu'il faut pour les évolutions qui manquent au Pokédex", async () => {
    await giveMany("Rattata", 3);
    const plain = collection.listDuplicates(await owned());
    const reserved = collection.listDuplicates(await owned(), { reserve: true });
    assert.equal(plain[0].spare, 2);
    assert.deepEqual(reserved, [], "il manque Rattatac : un Rattata évolue, un se sacrifie, un reste");

    await give("Rattatac", { obtained: 9 });
    const complete = collection.listDuplicates(await owned(), { reserve: true });
    assert.equal(complete.find((entry) => entry.speciesId === species("Rattata").id).spare, 2, "Rattatac déjà au Pokédex : rien à garder");
  });

  it("une cible par échange n'exige rien : en recevoir le premier stade suffit", async () => {
    await giveMany("Machopeur", 3);
    const reserve = collection.evolutionReserve(collection.countBySpecies(await owned()));
    assert.deepEqual(reserve.get(species("Machopeur").id), { evolutions: 0, sacrifices: 0 });
  });

  it("une lignée à deux étapes se paie en évolutions d'évolutions", async () => {
    await giveMany("Salamèche", 6);
    const reserve = collection.evolutionReserve(collection.countBySpecies(await owned()));
    const need = reserve.get(species("Salamèche").id);
    assert.ok(need.evolutions >= 1 && need.sacrifices >= need.evolutions, "Reptincel manque, et Dracaufeu derrière lui");
  });

  it("qui peut céder une espèce : ceux qui en ont le plus d'abord, à égalité par identifiant", async () => {
    await giveMany("Rattata", 5, { user: "u-b" });
    await giveMany("Rattata", 3, { user: "u-a" });
    await giveMany("Rattata", 3, { user: "u-c" });
    await give("Rattata", { user: "u-seul" });
    const list = await call(collection.getSpeciesDuplicates, species("Rattata").id, {});
    assert.deepEqual(list.map((entry) => [entry.userId, entry.spare]), [["u-b", 4], ["u-a", 2], ["u-c", 2]]);
  });

  it("avec la réserve, les descendants du dresseur sont lus aussi", async () => {
    await giveMany("Rattata", 3, { user: "u-a" });
    await giveMany("Rattata", 3, { user: "u-b" });
    await give("Rattatac", { user: "u-b" });
    const list = await call(collection.getSpeciesDuplicates, species("Rattata").id, { reserve: true });
    assert.deepEqual(list.map((entry) => entry.userId), ["u-b"], "u-a doit garder ses Rattata pour compléter son Pokédex");
  });
});

describe("verrouiller", () => {
  it("seul le propriétaire verrouille, et dit s'il l'a fait", async () => {
    const id = await give("Rattata");
    assert.equal(await call(collection.setLock, "u2", id, true), false);
    assert.equal((await owned())[0].locked, 0);
    assert.equal(await call(collection.setLock, "u1", id, true), true);
    assert.equal((await owned())[0].locked, 1);
    assert.equal(await call(collection.setLock, "u1", id, false), true);
    assert.equal((await owned())[0].locked, 0);
  });

  it("la bascule rend l'état obtenu, ou null si le Pokémon n'est pas à soi", async () => {
    const id = await give("Rattata");
    assert.equal(await call(collection.toggleLock, "u1", id), true);
    assert.equal(await call(collection.toggleLock, "u1", id), false);
    assert.equal(await call(collection.toggleLock, "u2", id), null);
    assert.equal(await call(collection.toggleLock, "u1", 99999), null);
  });

  it("deux bascules simultanées s'appliquent l'une après l'autre : on retombe sur l'état de départ", async () => {
    const id = await give("Rattata");
    const results = await Promise.all([call(collection.toggleLock, "u1", id), call(collection.toggleLock, "u1", id)]);
    assert.deepEqual(results.sort(), [false, true]);
    assert.equal((await owned())[0].locked, 0);
  });

  it("ce qui arrive en boîte est verrouillé d'office s'il est shiny ou légendaire", async () => {
    const shiny = await call(collection.creditSpecies, "u1", species("Rattata").id, true, { origin: "test" });
    const legend = await call(collection.creditSpecies, "u1", species("Mewtwo").id, false, { origin: "test" });
    const plain = await call(collection.creditSpecies, "u1", species("Rattata").id, false, { origin: "test" });
    const lockOf = async (created) => (await dbGet(points, "SELECT locked FROM pokemon_owned WHERE id = ?", [created.id])).locked;
    assert.equal(await lockOf(shiny), 1);
    assert.equal(await lockOf(legend), 1);
    assert.equal(await lockOf(plain), 0);
  });
});

describe("retirer des individus (reserveDuplicates / restoreDuplicates)", () => {
  const reserve = (group, quantity, user = "u1") => call(collection.reserveDuplicates, user, group, quantity);
  const rattata = () => ({ speciesId: species("Rattata").id, isShiny: null });

  it("refuse une quantité absurde", async () => {
    await assert.rejects(() => reserve(rattata(), 0), /Quantité invalide/);
    await assert.rejects(() => reserve(rattata(), -1), /Quantité invalide/);
    await assert.rejects(() => reserve(rattata(), 1.5), /Quantité invalide/);
  });

  it("ne retire jamais le dernier de l'espèce, shiny compris", async () => {
    await give("Rattata");
    await give("Rattata", { shiny: 1, obtained: 2 });
    assert.equal((await reserve(rattata(), 2)).length, 0, "il en faut un de plus que ce qu'on retire");
    assert.equal((await reserve(rattata(), 1)).length, 1);
    assert.equal((await owned()).length, 1);
  });

  it("tout ou rien : trop demander ne retire personne", async () => {
    await giveMany("Rattata", 3);
    assert.equal((await reserve(rattata(), 3)).length, 0);
    assert.equal((await owned()).length, 3);
  });

  it("les moins précieux partent d'abord : hors vitrine, normaux, stériles, plus récents", async () => {
    const showcased = await give("Rattata", { obtained: 9, showcase: 1 });
    const shiny = await give("Rattata", { shiny: 1, obtained: 8 });
    const fertile = await give("Rattata", { obtained: 7 });
    const sterile = await give("Rattata", { obtained: 6, sterile: 1 });
    const oldest = await give("Rattata", { obtained: 1, sterile: 1 });
    const taken = await reserve(rattata(), 4);
    // RETURNING ne promet pas d'ordre : on compare les ensembles.
    assert.deepEqual(taken.map((row) => row.id).sort((x, y) => x - y), [sterile, oldest, fertile, shiny].sort((x, y) => x - y));
    assert.ok(!taken.some((row) => row.id === showcased), "celui de la vitrine part après tous les autres");
  });

  it("un verrouillé ne part qu'avec `withLocked`, et même alors après les ouverts", async () => {
    const locked = await give("Rattata", { locked: 1, obtained: 9 });
    const older = await give("Rattata", { obtained: 1 });
    const newer = await give("Rattata", { obtained: 2 });
    assert.deepEqual((await reserve(rattata(), 1)).map((row) => row.id), [newer], "parmi les ouverts, le plus récent");
    assert.deepEqual((await reserve({ ...rattata(), withLocked: true }, 1)).map((row) => row.id), [older], "un ouvert passe avant lui");
    await call(collection.restoreDuplicates, [{ ...(await owned())[0], id: 1000 }]);
    const [taken] = await reserve({ ...rattata(), withLocked: true, pokemonId: locked }, 1);
    assert.equal(taken.id, locked, "désigné et confirmé, il part");
  });

  it("rend l'individu retiré tel quel : ligne complète, surnom et place PC compris", async () => {
    const id = await give("Rattata", { nickname: "Ratou", pc: 12, form: null, locked: 0 });
    await give("Rattata", { obtained: 2 });
    const before = (await owned()).find((row) => row.id === id);
    const [taken] = await reserve({ ...rattata(), pokemonId: id }, 1);
    assert.deepEqual(taken, before);
    assert.equal((await owned()).some((row) => row.id === id), false);
    await call(collection.restoreDuplicates, [taken]);
    assert.deepEqual((await owned()).find((row) => row.id === id), before);
  });

  it("une restitution qui échoue le dit, sans avaler l'erreur", async () => {
    const id = await give("Rattata");
    await give("Rattata", { obtained: 2 });
    const [taken] = await reserve({ ...rattata(), pokemonId: id }, 1);
    await dbRun(points, "CREATE TRIGGER panne BEFORE INSERT ON pokemon_owned BEGIN SELECT RAISE(ABORT, 'panne'); END");
    await assert.rejects(() => call(collection.restoreDuplicates, [taken]), /panne/);
    await dbRun(points, "DROP TRIGGER panne");
  });
});

describe("échanger (createTrade / acceptTrade)", () => {
  const offer = (overrides = {}) => ({
    fromUserId: "u1",
    toUserId: "u2",
    offerSpeciesId: species("Rattata").id,
    requestSpeciesId: species("Roucool").id,
    channelId: "salon",
    ...overrides,
  });
  const open = async (overrides = {}) => call(collection.createTrade, offer(overrides));
  const accept = (id) => call(collection.acceptTrade, id);
  const status = async (id) => (await dbGet(points, "SELECT status FROM pokemon_trades WHERE id = ?", [id])).status;

  it("une offre vit le temps réglé, puis n'est plus acceptable", async () => {
    const id = await open();
    const trade = await call(collection.getTrade, id);
    assert.equal(trade.status, "PENDING");
    assert.equal(trade.expires_at - trade.created_at, getPokemonConfig().trade.expiryHours * 3600 * 1000);
    await dbRun(points, "UPDATE pokemon_trades SET expires_at = ? WHERE id = ?", [Date.now() - 1, id]);
    const late = await accept(id);
    assert.equal(late.ok, false);
    assert.match(late.reason, /expiré ou a déjà été traitée/);
  });

  it("chacun reçoit le Pokémon de l'autre, avec son identifiant, sa ball et son surnom", async () => {
    const [give1] = await giveMany("Rattata", 2);
    await dbRun(points, "UPDATE pokemon_owned SET nickname = 'Ratou', ball = 'super', pc_pos = 4, showcase_pos = 2 WHERE id = ?", [give1]);
    const [give2] = await giveMany("Roucool", 2, { user: "u2" });
    const id = await open({ offerPokemonId: give1, requestPokemonId: give2 });

    const result = await accept(id);
    assert.equal(result.ok, true, result.reason);
    assert.equal(await status(id), "ACCEPTED");

    const received = (await owned("u2")).find((row) => row.id === give1);
    assert.ok(received, "u2 a reçu le Rattata de u1");
    assert.equal(received.nickname, "Ratou", "le surnom suit");
    assert.equal(received.ball, "super", "la ball suit");
    assert.equal(received.origin, "echange");
    assert.equal(received.pc_pos, null, "il prend la première place libre chez son nouveau dresseur");
    assert.equal(received.showcase_pos, null, "la vitrine de l'autre ne le suit pas");
    assert.ok((await owned("u1")).some((row) => row.id === give2), "u1 a reçu le Roucool de u2");
    assert.equal((await owned("u1")).length, 2);
    assert.equal((await owned("u2")).length, 2);
    assert.deepEqual(result.evolutions, []);
  });

  it("Machopeur évolue chez celui qui le reçoit, pas chez celui qui le donne", async () => {
    const [machop] = await giveMany("Machopeur", 2);
    const [roucool] = await giveMany("Roucool", 2, { user: "u2" });
    const id = await open({ offerSpeciesId: species("Machopeur").id, offerPokemonId: machop, requestPokemonId: roucool });
    const result = await accept(id);
    assert.equal(result.ok, true, result.reason);
    const arrived = (await owned("u2")).find((row) => row.id === machop);
    assert.equal(arrived.species_id, species("Mackogneur").id);
    assert.deepEqual(result.evolutions, [{ userId: "u2", from: species("Machopeur").id, to: species("Mackogneur").id, isShiny: 0 }]);
    assert.equal((await ofSpecies("Machopeur", "u1")).length, 1, "celui qui donne garde son autre Machopeur");
  });

  it("deux Machopeur échangés font deux Mackogneur, comme dans le jeu d'origine", async () => {
    const [mine] = await giveMany("Machopeur", 2);
    const [theirs] = await giveMany("Machopeur", 2, { user: "u2" });
    const id = await open({ offerSpeciesId: species("Machopeur").id, requestSpeciesId: species("Machopeur").id, offerPokemonId: mine, requestPokemonId: theirs });
    const result = await accept(id);
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.evolutions.length, 2);
    assert.equal((await owned("u1")).find((row) => row.id === theirs).species_id, species("Mackogneur").id);
    assert.equal((await owned("u2")).find((row) => row.id === mine).species_id, species("Mackogneur").id);
  });

  it("un shiny qui arrive est verrouillé d'office", async () => {
    const [shiny] = [await give("Rattata", { shiny: 1 }), await give("Rattata", { obtained: 2 })];
    const [roucool] = await giveMany("Roucool", 2, { user: "u2" });
    const id = await open({ offerPokemonId: shiny, offerIsShiny: true, requestPokemonId: roucool });
    assert.equal((await accept(id)).ok, true);
    assert.equal((await owned("u2")).find((row) => row.id === shiny).locked, 1);
  });

  it("une offre par groupe choisit l'individu à l'acceptation : jamais le dernier de l'espèce", async () => {
    await giveMany("Rattata", 2);
    await giveMany("Roucool", 2, { user: "u2" });
    const id = await open();
    const result = await accept(id);
    assert.equal(result.ok, true, result.reason);
    assert.equal((await ofSpecies("Rattata", "u1")).length, 1);
    assert.equal((await ofSpecies("Rattata", "u2")).length, 1);
    assert.equal((await ofSpecies("Roucool", "u1")).length, 1);
  });

  it("le dernier de son espèce ne part pas : l'offre échoue, rien ne bouge", async () => {
    await give("Rattata");
    await giveMany("Roucool", 2, { user: "u2" });
    const before = [await owned("u1"), await owned("u2")];
    const id = await open();
    const result = await accept(id);
    assert.equal(result.ok, false);
    assert.match(result.reason, /Le Pokémon proposé n'est plus disponible/);
    assert.equal(await status(id), "FAILED");
    assert.deepEqual([await owned("u1"), await owned("u2")], before);
  });

  it("si la cible ne peut plus donner le sien, l'initiateur récupère le sien à l'identique", async () => {
    const [mine] = await giveMany("Rattata", 2);
    await give("Roucool", { user: "u2" });
    const before = [await owned("u1"), await owned("u2")];
    const id = await open({ offerPokemonId: mine });
    const result = await accept(id);
    assert.equal(result.ok, false);
    assert.match(result.reason, /Le Pokémon demandé n'est plus disponible/);
    assert.equal(await status(id), "FAILED");
    assert.deepEqual([await owned("u1"), await owned("u2")], before);
  });

  it("un verrouillé ne s'échange pas", async () => {
    const [a, b] = await giveMany("Rattata", 2, { locked: 1 });
    await giveMany("Roucool", 2, { user: "u2" });
    const id = await open({ offerPokemonId: a });
    const result = await accept(id);
    assert.equal(result.ok, false);
    assert.equal((await owned("u1")).length, 2);
    assert.ok(b);
  });

  it("deux acceptations simultanées : une seule échange, la seconde est refusée", async () => {
    await giveMany("Rattata", 3);
    await giveMany("Roucool", 3, { user: "u2" });
    const id = await open();
    const results = await Promise.all([accept(id), accept(id)]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.match(results.find((result) => !result.ok).reason, /expiré ou a déjà été traitée/);
    assert.equal((await ofSpecies("Rattata", "u1")).length, 2, "un seul Pokémon a changé de main");
    assert.equal((await ofSpecies("Roucool", "u1")).length, 1);
  });

  it("une livraison qui échoue rend à chacun son Pokémon", async () => {
    const [mine] = await giveMany("Rattata", 2);
    const [theirs] = await giveMany("Roucool", 2, { user: "u2" });
    const before = [await owned("u1"), await owned("u2")];
    const id = await open({ offerPokemonId: mine, requestPokemonId: theirs });
    await dbRun(points, "CREATE TRIGGER panne BEFORE INSERT ON pokemon_owned WHEN NEW.origin = 'echange' BEGIN SELECT RAISE(ABORT, 'panne'); END");
    await assert.rejects(() => accept(id), /panne/);
    await dbRun(points, "DROP TRIGGER panne");
    assert.deepEqual([await owned("u1"), await owned("u2")], before, "personne n'a rien perdu, personne n'a rien gagné");
  });

  it("refuser ou annuler ne se fait qu'une fois, tant que l'offre est ouverte", async () => {
    const id = await open();
    assert.equal(await call(collection.resolveTradeAs, id, "u2", "DECLINED"), true);
    assert.equal(await call(collection.resolveTradeAs, id, "u2", "DECLINED"), false);
    assert.equal(await call(collection.resolveTradeAs, id, "u1", "CANCELLED"), false);
    assert.equal(await status(id), "DECLINED");
    assert.match((await accept(id)).reason, /déjà été traitée/);
  });

  it("le message de l'offre se retient pour pouvoir l'éditer plus tard", async () => {
    const id = await open();
    collection.setTradeMessage(id, "message-1");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal((await call(collection.getTrade, id)).message_id, "message-1");
  });

  it("une offre qui n'existe pas n'est pas acceptable", async () => {
    const result = await accept(99999);
    assert.equal(result.ok, false);
  });
});

describe("les échanges possibles entre deux dresseurs (tradeMatches)", () => {
  const matches = async (a = "u1", b = "u2", options) => collection.tradeMatches(await owned(a), await owned(b), options);
  const names = (list) => list.map((entry) => data.getSpecies(entry.speciesId).name);

  it("chacun donne ce que l'autre n'a pas : une espèce contre une espèce", async () => {
    await giveMany("Rattata", 2);
    await give("Roucool");
    await giveMany("Chenipan", 2, { user: "u2" });
    await give("Roucool", { user: "u2" });
    const { give: gifts, get: gets, swaps } = await matches();
    assert.deepEqual(names(gifts), ["Rattata"]);
    assert.deepEqual(names(gets), ["Chenipan"]);
    assert.equal(swaps, 1);
    assert.equal(gifts[0].spare, 1, "les chiffres de listDuplicates suivent chaque ligne");
    assert.equal(gifts[0].arrivalId, species("Rattata").id);
  });

  it("ce que l'autre a déjà ne compte pas, même en un seul exemplaire : le second ne comble rien", async () => {
    await giveMany("Rattata", 3);
    await give("Rattata", { user: "u2" });
    await giveMany("Chenipan", 2, { user: "u2" });
    const { give: gifts, swaps } = await matches();
    assert.deepEqual(gifts, []);
    assert.equal(swaps, 0, "rien à donner : pas d'échange, même si l'autre a de quoi donner");
  });

  it("jamais le dernier exemplaire, jamais un verrouillé : le verrouillé reste, c'est l'autre qui part", async () => {
    await give("Rattata");
    await giveMany("Chenipan", 2);
    await dbRun(points, "UPDATE pokemon_owned SET locked = 1 WHERE id = (SELECT MIN(id) FROM pokemon_owned WHERE species_id = ?)", [species("Chenipan").id]);
    await giveMany("Aspicot", 2, { locked: 1 });
    await giveMany("Piafabec", 3);
    await dbRun(points, "UPDATE pokemon_owned SET locked = 1 WHERE species_id = ? AND id != (SELECT MAX(id) FROM pokemon_owned WHERE species_id = ?)", [species("Piafabec").id, species("Piafabec").id]);
    await give("Roucool", { user: "u2" });
    const { give: gifts } = await matches();
    assert.deepEqual(names(gifts), ["Chenipan", "Piafabec"], "un seul exemplaire, ou que des verrouillés : rien à céder");
    assert.deepEqual(gifts.map((entry) => entry.spare), [1, 1], "le libre part, les verrouillés gardent l'entrée");
  });

  it("la réserve d'évolution met de côté, de chaque côté, ce qu'il faut pour compléter le Pokédex", async () => {
    await giveMany("Rattata", 3);
    await giveMany("Chenipan", 2, { user: "u2" });
    assert.deepEqual(names((await matches("u1", "u2")).give), ["Rattata"]);
    assert.deepEqual((await matches("u1", "u2", { reserve: true })).give, [], "il manque Rattatac : un Rattata évolue, un se sacrifie, un reste");
    await give("Rattatac", { obtained: 9 });
    assert.deepEqual(names((await matches("u1", "u2", { reserve: true })).give), ["Rattata"], "Rattatac au Pokédex : plus rien à garder");
  });

  it("ce qui compte est l'espèce qui ARRIVE : un Machopeur devient Mackogneur chez celui qui le reçoit", async () => {
    await giveMany("Machopeur", 2);
    await give("Mackogneur", { user: "u2" });
    await give("Roucool", { user: "u2" });
    assert.deepEqual((await matches()).give, [], "il a déjà un Mackogneur : son Machopeur ne lui apporterait rien, même s'il n'a jamais eu de Machopeur");

    await dbRun(points, "DELETE FROM pokemon_owned WHERE user_id = 'u2'");
    await give("Machopeur", { user: "u2" });
    const { give: gifts } = await matches();
    assert.deepEqual(names(gifts), ["Machopeur"], "il a un Machopeur mais pas de Mackogneur : celui qui arrive lui manque");
    assert.equal(gifts[0].arrivalId, species("Mackogneur").id);
  });

  it("deux espèces qui arrivent sous la même forme ne comblent qu'une case : on garde celle qui n'a pas à évoluer", async () => {
    await giveMany("Machopeur", 2);
    await giveMany("Mackogneur", 2);
    await give("Roucool", { user: "u2" });
    const { give: gifts, swaps } = await matches();
    assert.deepEqual(names(gifts), ["Mackogneur"]);
    assert.equal(gifts[0].arrivalId, species("Mackogneur").id);
    assert.equal(swaps, 0, "l'autre n'a rien en double à donner en retour");
  });

  it("les chiffres de chaque ligne disent combien de shiny peuvent partir, pour les signaler", async () => {
    await give("Rattata", { obtained: 1 });
    await give("Rattata", { obtained: 2, shiny: 1, locked: 0 });
    await give("Roucool", { obtained: 1 });
    await give("Roucool", { obtained: 2, shiny: 1, locked: 1 });
    const { give: gifts } = await matches("u1", "u2");
    const free = (name) => gifts.find((entry) => entry.speciesId === species(name).id);
    assert.equal(free("Rattata").free - free("Rattata").freeNormal, 1, "un shiny déverrouillé peut partir");
    assert.equal(free("Roucool").free - free("Roucool").freeNormal, 0, "un shiny verrouillé ne part pas");
  });

  it("la comparaison est symétrique : ce que l'un donne est ce que l'autre reçoit", async () => {
    await giveMany("Rattata", 3);
    await giveMany("Roucool", 2);
    await give("Chenipan");
    await giveMany("Chenipan", 3, { user: "u2" });
    await giveMany("Aspicot", 2, { user: "u2" });
    await give("Roucool", { user: "u2" });
    const forward = await matches("u1", "u2");
    const backward = await matches("u2", "u1");
    assert.deepEqual(forward.give, backward.get);
    assert.deepEqual(forward.get, backward.give);
    assert.equal(forward.swaps, backward.swaps);
    assert.equal(forward.swaps, Math.min(forward.give.length, forward.get.length));
  });

  it("deux dresseurs sans rien : une comparaison vide, sans planter", async () => {
    const result = await matches("rien-1", "rien-2");
    assert.deepEqual(result, { give: [], get: [], swaps: 0 });
  });

  it("lue en base, la comparaison est la même que sur les lignes", async () => {
    await giveMany("Rattata", 2);
    await giveMany("Chenipan", 2, { user: "u2" });
    const fromDb = await call(collection.getTradeMatches, "u1", "u2", { reserve: false });
    assert.deepEqual(fromDb, await matches());
  });
});

describe("avec qui échanger (getTradePartners)", () => {
  // La liste, et en second le nombre d'espèces que le dresseur peut offrir.
  const both = (user = "u1", options = {}) => call(collection.getTradePartners, user, options);
  const partners = async (user, options) => (await both(user, options))[0];
  const shape = (list) => list.map((entry) => [entry.userId, entry.swaps, entry.give, entry.get]);

  async function world() {
    await giveMany("Rattata", 3);
    await giveMany("Roucool", 2);
    // p-a et p-e : une espèce contre une espèce.
    for (const id of ["p-a", "p-e"]) {
      await giveMany("Chenipan", 2, { user: id });
      await give("Roucool", { user: id });
    }
    // p-b : peut donner trois espèces, n'en reçoit qu'une.
    for (const name of ["Chenipan", "Aspicot", "Piafabec"]) await giveMany(name, 2, { user: "p-b" });
    await give("Roucool", { user: "p-b" });
    // p-c a déjà un Rattata : rien à lui donner. p-d n'a rien en double : rien à recevoir.
    await give("Rattata", { user: "p-c" });
    await give("Roucool", { user: "p-c" });
    await giveMany("Chenipan", 2, { user: "p-c" });
    await give("Roucool", { user: "p-d" });
    // p-f : deux espèces contre deux.
    await giveMany("Chenipan", 2, { user: "p-f" });
    await giveMany("Aspicot", 2, { user: "p-f" });
  }

  it("ceux qui permettent le plus d'échanges d'abord, puis le volume, puis l'identifiant", async () => {
    await world();
    assert.deepEqual(shape(await partners()), [
      ["p-f", 2, 2, 2],
      ["p-b", 1, 1, 3],
      ["p-a", 1, 1, 1],
      ["p-e", 1, 1, 1],
    ]);
  });

  it("celui qui demande n'est jamais dans sa propre liste, et rien à offrir veut dire personne", async () => {
    await world();
    assert.ok(!(await partners()).some((entry) => entry.userId === "u1"));
    await giveMany("Salamèche", 1, { user: "seul" });
    assert.deepEqual(await both("seul"), [[], { offers: 0 }], "sans doublon à offrir, aucun échange n'est possible, et c'est lui qui n'a rien à donner");
    assert.deepEqual(await both("inconnu"), [[], { offers: 0 }], "un dresseur sans Pokémon non plus");
  });

  it("une lecture ratée est rendue telle quelle, sans résumé qui ferait dire « rien à offrir » à tort", async () => {
    await world();
    const original = points.all;
    points.all = function (sql, ...rest) {
      if (/FROM pokemon_owned/.test(sql) && !/WHERE/.test(sql)) return rest.at(-1)(new Error("panne de lecture"));
      return original.call(this, sql, ...rest);
    };
    try {
      const result = await new Promise((resolve) => collection.getTradePartners("u1", {}, (...args) => resolve(args)));
      assert.equal(result[0].message, "panne de lecture");
      assert.deepEqual(result.slice(1), [[]], "la liste est vide, et aucun résumé n'accompagne l'erreur");
    } finally {
      points.all = original;
    }
  });

  it("dit combien d'espèces le dresseur peut offrir, pour distinguer « rien à offrir » de « personne n'en veut »", async () => {
    await world();
    assert.deepEqual((await both())[1], { offers: 2 }, "Rattata et Roucool");
    await dbRun(points, "DELETE FROM pokemon_owned");
    await giveMany("Rattata", 2, { user: "x" });
    await give("Rattata", { user: "y" });
    await giveMany("Chenipan", 2, { user: "y" });
    assert.deepEqual(await both("x"), [[], { offers: 1 }], "x a de quoi offrir, mais y a déjà un Rattata : personne n'en veut");
  });

  it("la réserve d'évolution retire ceux dont l'échange ne tient qu'à ce qu'on garde pour évoluer", async () => {
    await giveMany("Rattata", 3);
    await giveMany("Chenipan", 2, { user: "p-a" });
    assert.equal((await partners("u1")).length, 1);
    assert.deepEqual(await partners("u1", { reserve: true }), [], "les trois Rattata servent à évoluer : rien à donner");
  });
});

describe("qui a besoin d'une espèce (getSpeciesNeeders)", () => {
  const needers = (speciesName, user = "u1", options = {}) => call(collection.getSpeciesNeeders, user, species(speciesName).id, options);

  it("ceux à qui elle manque, avec ce qu'ils offriraient en retour : l'échange avant le cadeau", async () => {
    await giveMany("Rattata", 3);
    await give("Roucool");
    await giveMany("Chenipan", 2, { user: "n-a" });
    await give("Roucool", { user: "n-b" });
    await give("Rattata", { user: "n-c" });
    await giveMany("Chenipan", 2, { user: "n-d" });
    await giveMany("Aspicot", 2, { user: "n-d" });
    const { offer, list } = await needers("Rattata");
    assert.equal(offer.speciesId, species("Rattata").id);
    assert.equal(offer.spare, 2);
    assert.deepEqual(list.map((entry) => [entry.userId, entry.back]), [["n-d", 2], ["n-a", 1], ["n-b", 0]], "n-c l'a déjà : il n'en a pas besoin");
  });

  it("une espèce qu'on ne peut pas céder ne donne rien : un seul exemplaire, ou inconnue", async () => {
    await give("Rattata");
    await giveMany("Chenipan", 2, { user: "n-a" });
    assert.deepEqual(await needers("Rattata"), { offer: null, list: [] });
    assert.deepEqual(await call(collection.getSpeciesNeeders, "u1", 99999, {}), { offer: null, list: [] });
  });

  it("une espèce qui change en arrivant : seuls ceux à qui manque la forme d'arrivée en ont besoin", async () => {
    await giveMany("Machopeur", 2);
    await give("Mackogneur", { user: "m-a" });
    await give("Machopeur", { user: "m-b" });
    const { offer, list } = await needers("Machopeur");
    assert.equal(offer.arrivalId, species("Mackogneur").id);
    assert.deepEqual(list.map((entry) => entry.userId), ["m-b"], "m-a a déjà un Mackogneur : le Machopeur n'y ajouterait rien");
  });
});

describe("l'individu que cède une offre qui n'en désigne pas (tradeCandidate)", () => {
  const rattata = species("Rattata").id;
  // Chaque situation est jouée deux fois, sur les mêmes lignes : l'individu choisi doit être
  // celui que reserveDuplicates retirerait en premier. Une règle écrite à deux endroits
  // finit par ne plus l'être qu'à un seul, et le test dit lequel a bougé.
  const situations = {
    "le plus récent d'abord": async () => giveMany("Rattata", 3),
    "un stérile avant un capable de pondre, même plus récent": async () => {
      await give("Rattata", { obtained: 5 });
      await give("Rattata", { obtained: 1, sterile: 1 });
      await give("Rattata", { obtained: 9 });
    },
    "un normal avant un shiny, même plus récent": async () => {
      await give("Rattata", { obtained: 1 });
      await give("Rattata", { obtained: 2 });
      await give("Rattata", { obtained: 9, shiny: 1 });
    },
    "un individu hors vitrine avant un exposé, même plus récent": async () => {
      await give("Rattata", { obtained: 9, showcase: 0 });
      await give("Rattata", { obtained: 1 });
      await give("Rattata", { obtained: 2 });
    },
    "un verrouillé n'est jamais cédé": async () => {
      await give("Rattata", { obtained: 9, locked: 1 });
      await give("Rattata", { obtained: 1 });
      await give("Rattata", { obtained: 2 });
    },
    "le dernier de l'espèce ne part pas": async () => give("Rattata"),
    "ni un groupe dont tout est verrouillé": async () => giveMany("Rattata", 2, { locked: 1 }),
    "ni une espèce qu'on n'a pas": async () => give("Roucool"),
  };

  for (const [name, setup] of Object.entries(situations)) {
    it(name, async () => {
      await setup();
      const chosen = await call(collection.tradeCandidate, "u1", rattata);
      const removed = await call(collection.reserveDuplicates, "u1", { speciesId: rattata }, 1);
      assert.equal(chosen?.id ?? null, removed[0]?.id ?? null);
      if (chosen) assert.equal(chosen.locked, 0);
    });
  }

  it("rend la ligne entière, prête à servir de sélecteur", async () => {
    const [id] = await giveMany("Rattata", 2, { sex: "F", sterile: 1 });
    const row = await call(collection.tradeCandidate, "u1", rattata);
    const selector = collection.selectorOf(row);
    assert.equal(selector.pokemonId, row.id);
    assert.equal(selector.speciesId, rattata);
    assert.equal(selector.sex, "F");
    assert.equal(selector.isShiny, false);
    assert.equal(selector.fertile, null);
    assert.equal(selector.row, row);
    assert.ok(id > 0);
  });
});

describe("proposer une offre (proposeTrade)", () => {
  async function sides() {
    await dbRun(points, "DELETE FROM pokemon_trades");
    const mine = await give("Rattata", { sterile: 1, sex: "F", form: null });
    await give("Rattata", { obtained: 2 });
    const theirs = await give("Roucool", { user: "u2", sex: "F" });
    await give("Roucool", { user: "u2", obtained: 2 });
    const row = async (user, id) => (await owned(user)).find((entry) => entry.id === id);
    return {
      mine,
      theirs,
      offer: collection.selectorOf(await row("u1", mine)),
      request: collection.selectorOf(await row("u2", theirs)),
    };
  }

  it("enregistre l'offre avec l'individu et la fertilité de chaque côté, et rend la ligne", async () => {
    const { mine, theirs, offer, request } = await sides();
    const trade = await call(collection.proposeTrade, { fromUserId: "u1", toUserId: "u2", offer, request, channelId: "salon" });
    assert.equal(trade.status, "PENDING");
    assert.equal(trade.from_user_id, "u1");
    assert.equal(trade.to_user_id, "u2");
    assert.equal(trade.offer_pokemon_id, mine);
    assert.equal(trade.request_pokemon_id, theirs);
    assert.equal(trade.offer_species_id, species("Rattata").id);
    assert.equal(trade.request_species_id, species("Roucool").id);
    assert.equal(trade.offer_fertile, 0, "le Rattata proposé est stérile : qui le reçoit le sait");
    assert.equal(trade.request_fertile, 1);
    assert.equal(trade.offer_sex, "F");
    assert.equal(trade.channel_id, "salon");
    assert.equal(trade.expires_at - trade.created_at, getPokemonConfig().trade.expiryHours * 3600 * 1000);
    assert.deepEqual(await call(collection.getTrade, trade.id), trade, "ce qui est rendu est la ligne enregistrée");
  });

  it("une offre qu'on ne peut pas relire est fermée plutôt que laissée ouverte jusqu'à son expiration", async () => {
    const { offer, request } = await sides();
    const original = points.get;
    points.get = function (sql, ...rest) {
      if (/FROM pokemon_trades WHERE id/.test(sql)) return rest.at(-1)(new Error("panne de lecture"));
      return original.call(this, sql, ...rest);
    };
    try {
      await assert.rejects(() => call(collection.proposeTrade, { fromUserId: "u1", toUserId: "u2", offer, request, channelId: "salon" }), /panne de lecture/);
    } finally {
      points.get = original;
    }
    const rows = await dbAll(points, "SELECT status FROM pokemon_trades");
    assert.deepEqual(rows.map((row) => row.status), ["CANCELLED"], "l'appelant répond à un échec : personne ne verra cette offre");
  });

  it("avec `unique`, une offre identique encore ouverte empêche d'en créer une seconde, qui se retire", async () => {
    const { offer, request } = await sides();
    const args = { fromUserId: "u1", toUserId: "u2", offer, request, channelId: "salon", unique: true };
    const propose = (overrides = {}) => call(collection.proposeTrade, { ...args, ...overrides });
    const [first] = [await propose()];
    assert.equal(first.status, "PENDING");
    const second = await new Promise((resolve) => collection.proposeTrade(args, (err, trade, info) => resolve({ err, trade, info })));
    assert.deepEqual([second.err, second.trade, second.info], [null, null, { duplicate: true }]);
    assert.deepEqual((await dbAll(points, "SELECT status FROM pokemon_trades ORDER BY id")).map((row) => row.status), ["PENDING", "CANCELLED"]);

    const without = await call(collection.proposeTrade, { ...args, unique: false });
    assert.equal(without.status, "PENDING", "sans `unique`, /pk echange garde son comportement : une offre de plus");
    await call(collection.resolveTradeAs, first.id, "u2", "DECLINED");
    await call(collection.resolveTradeAs, without.id, "u2", "DECLINED");
    assert.equal((await propose()).status, "PENDING", "une offre refusée ne bloque plus");
  });

  it("avec `unique`, une panne en vérifiant ferme l'offre plutôt que de la laisser ouverte sans personne pour la voir", async () => {
    const { offer, request } = await sides();
    const original = points.get;
    points.get = function (sql, ...rest) {
      if (/MIN\(id\) AS first/.test(sql)) return rest.at(-1)(new Error("panne de lecture"));
      return original.call(this, sql, ...rest);
    };
    try {
      await assert.rejects(() => call(collection.proposeTrade, { fromUserId: "u1", toUserId: "u2", offer, request, channelId: "salon", unique: true }), /panne de lecture/);
    } finally {
      points.get = original;
    }
    assert.deepEqual((await dbAll(points, "SELECT status FROM pokemon_trades")).map((row) => row.status), ["CANCELLED"]);
  });

  it("une panne d'écriture est rendue à l'appelant, sans offre à moitié créée", async () => {
    const { offer, request } = await sides();
    await dbRun(points, "CREATE TRIGGER panne BEFORE INSERT ON pokemon_trades BEGIN SELECT RAISE(ABORT, 'panne'); END");
    await assert.rejects(() => call(collection.proposeTrade, { fromUserId: "u1", toUserId: "u2", offer, request, channelId: "salon" }), /panne/);
    await dbRun(points, "DROP TRIGGER panne");
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_trades")).length, 0);
  });
});

describe("l'offre la plus ancienne de ses semblables (isOldestOpenOffer)", () => {
  const offer = (overrides = {}) => ({
    fromUserId: "u1", toUserId: "u2", offerSpeciesId: species("Rattata").id, requestSpeciesId: species("Roucool").id,
    offerPokemonId: 11, requestPokemonId: 22, channelId: "salon", ...overrides,
  });
  const open = async (overrides) => call(collection.getTrade, await call(collection.createTrade, offer(overrides)));
  const oldest = (trade) => call(collection.isOldestOpenOffer, trade);

  it("la première offre l'est, les suivantes identiques non", async () => {
    const first = await open();
    const second = await open();
    assert.equal(await oldest(first), true);
    assert.equal(await oldest(second), false);
    assert.equal(await oldest(first), true, "la première le reste");
  });

  it("une offre qui diffère par un Pokémon, un destinataire ou un auteur n'est pas un doublon", async () => {
    const first = await open();
    for (const other of [{ offerPokemonId: 12 }, { requestPokemonId: 23 }, { toUserId: "u3" }, { fromUserId: "u9" }]) {
      assert.equal(await oldest(await open(other)), true, JSON.stringify(other));
    }
    assert.equal(await oldest(first), true);
  });

  it("une offre fermée ou expirée ne compte plus : la suivante redevient la plus ancienne", async () => {
    const first = await open();
    const second = await open();
    await call(collection.resolveTradeAs, first.id, "u2", "DECLINED");
    assert.equal(await oldest(second), true);
    const third = await open();
    await dbRun(points, "UPDATE pokemon_trades SET expires_at = ? WHERE id = ?", [Date.now() - 1, second.id]);
    assert.equal(await oldest(third), true);
  });

  it("des offres anciennes, sans Pokémon désignés, se comparent par espèce : NULL vaut NULL, mais Rattata n'est pas Roucool", async () => {
    const group = { offerPokemonId: null, requestPokemonId: null };
    const first = await open(group);
    const second = await open(group);
    assert.equal(await oldest(first), true);
    assert.equal(await oldest(second), false, "mêmes espèces, mêmes variantes : un doublon");
    const other = await open({ ...group, offerSpeciesId: species("Aspicot").id });
    assert.equal(await oldest(other), true, "une autre espèce proposée n'est pas un doublon");
    const another = await open({ ...group, requestSpeciesId: species("Piafabec").id });
    assert.equal(await oldest(another), true, "ni une autre espèce demandée");
    const shiny = await open({ ...group, offerIsShiny: true });
    assert.equal(await oldest(shiny), true, "ni une autre variante");
  });
});
