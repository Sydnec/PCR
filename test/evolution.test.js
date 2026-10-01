// L'évolution : ce qu'elle coûte (describeEvolution) et comment elle se paie
// (evolve). Chaque évolution retire des sacrifices, un objet et des points, puis
// rend l'individu sous sa nouvelle forme — et si une étape échoue, tout ce qui a
// été pris revient, à l'identique : rien ne se perd, rien ne se crée.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbAll, speciesByName, withRandom } from "./helpers.js";

// Génération 1 seule : le coût d'Évoli et les objets d'évolution sont ceux du jeu
// d'origine, sans les formes que la génération 2 y ajoute.
const sandbox = createSandbox({ config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } } });
const { points } = await openDatabases();
const collection = await import("../modules/pokemon/collection.js");
const economy = await import("../modules/economy.js");
const items = await import("../modules/pokemon/items.js");
const data = await import("../modules/pokemon/data.js");
const { getPokemonConfig } = await import("../modules/pokemon/config.js");

const call = (fn, ...args) =>
  new Promise((resolve, reject) =>
    fn(...args, (error, ...rest) => (error ? reject(error) : resolve(rest.length > 1 ? rest : rest[0])))
  );
const species = (name) => speciesByName(data.allSpecies, name);
const evolution = () => getPokemonConfig().evolution;
const balance = (user = "u1") => call(economy.getBalance, user);
const setBalance = (amount, user = "u1") =>
  dbRun(points, "INSERT INTO points (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = ?", [user, amount, amount]);
const stock = (key, user = "u1") => call(items.getItemCount, user, key);
const grant = (key, quantity, user = "u1") => call(items.grantItem, user, key, quantity, { source: "test" });

async function give(name, { shiny = 0, sex = "M", obtained = 1, sterile = 0, locked = 0, user = "u1" } = {}) {
  const { lastID } = await dbRun(
    points,
    `INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, sterile, obtained_at, locked)
     VALUES (?, ?, ?, ?, 'test', ?, ?, ?)`,
    [user, species(name).id, shiny, sex, sterile, obtained, locked]
  );
  return lastID;
}
const giveMany = async (name, quantity, options = {}) => {
  const ids = [];
  for (let index = 0; index < quantity; index++) ids.push(await give(name, { obtained: index + 1, ...options }));
  return ids;
};
const rows = (user = "u1") => dbAll(points, "SELECT id, species_id, is_shiny, locked, sex FROM pokemon_owned WHERE user_id = ? ORDER BY id", [user]);
const ofSpecies = async (name, user = "u1") => (await rows(user)).filter((row) => row.species_id === species(name).id);
const fusions = () => dbAll(points, "SELECT * FROM pokemon_fusions ORDER BY id");

const evolve = (group, chosen = null, helper = null, user = "u1") => call(collection.evolve, user, group, chosen, helper);
const byId = (name, id, extra = {}) => ({ speciesId: species(name).id, isShiny: null, pokemonId: id, ...extra });

beforeEach(async () => {
  await dbRun(points, "DROP TRIGGER IF EXISTS panne");
  for (const table of ["points", "pokemon_owned", "pokemon_inventory", "pokemon_item_log", "pokemon_fusions", "points_log"]) {
    await dbRun(points, `DELETE FROM ${table}`);
  }
  sandbox.removeConfig();
  sandbox.writeConfig({ pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } });
});

describe("ce que coûte une évolution (describeEvolution)", () => {
  it("une première évolution coûte le tarif du stade 2 : un sacrifice, et un exemplaire qui reste", () => {
    const plan = collection.describeEvolution(species("Rattata").id);
    assert.equal(plan.target.name, "Rattatac");
    assert.equal(plan.points, evolution()[2].points);
    assert.equal(plan.sacrifices, evolution()[2].duplicates - 1, "l'individu qui évolue compte parmi les duplicates");
    assert.equal(plan.required, plan.sacrifices + 2, "celui qui évolue, ses sacrifices, et un qui reste");
    assert.equal(plan.branching, false);
    assert.equal(plan.helper, null);
  });

  it("une seconde évolution coûte le tarif du stade 3", () => {
    const plan = collection.describeEvolution(species("Reptincel").id);
    assert.equal(plan.target.name, "Dracaufeu");
    assert.equal(plan.points, evolution()[3].points);
  });

  it("une espèce inconnue, sans évolution ou déjà au bout refuse, en disant pourquoi", () => {
    assert.equal(collection.describeEvolution(99999).error, "Espèce inconnue.");
    assert.match(collection.describeEvolution(species("Dracaufeu").id).error, /Dracaufeu n'a pas d'évolution/);
    assert.match(collection.describeEvolution(species("Mewtwo").id).error, /n'a pas d'évolution/);
  });

  it("une lignée à embranchement tire au sort au tarif du stade, et choisir coûte plus cher", () => {
    const random = collection.describeEvolution(species("Évoli").id);
    assert.equal(random.branching, true);
    assert.equal(random.target, null, "la cible se tire à l'évolution, pas avant");
    assert.deepEqual(random.targets.map((target) => target.name).sort(), ["Aquali", "Pyroli", "Voltali"]);
    assert.equal(random.points, evolution()[2].points);

    const chosen = collection.describeEvolution(species("Évoli").id, species("Voltali").id);
    assert.equal(chosen.target.name, "Voltali");
    assert.equal(chosen.points, evolution().branchChoicePoints);
    assert.ok(chosen.points > random.points);
  });

  it("choisir une forme qui n'est pas dans la lignée refuse", () => {
    const plan = collection.describeEvolution(species("Évoli").id, species("Dracaufeu").id);
    assert.match(plan.error, /ne peut pas évoluer en cette forme/);
  });

  it("choisir sur une lignée sans embranchement ne coûte pas le supplément", () => {
    const plan = collection.describeEvolution(species("Rattata").id, species("Rattatac").id);
    assert.equal(plan.points, evolution()[2].points);
  });

  it("le Super Bonbon tient lieu d'un sacrifice, trois par trois, sans changer les points", () => {
    const plain = collection.describeEvolution(species("Rattata").id);
    const candy = collection.describeEvolution(species("Rattata").id, null, "super_bonbon");
    assert.equal(candy.sacrifices, plain.sacrifices - 1);
    assert.equal(candy.points, plain.points);
    assert.equal(candy.helper.quantity, 3);
    assert.equal(candy.required, 2);
  });

  it("un objet trop généreux ne rend jamais une évolution négative", () => {
    sandbox.writeConfig({
      pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" }, evolution: { 2: { duplicates: 1, points: 1500 } } },
    });
    const plan = collection.describeEvolution(species("Rattata").id, null, "super_bonbon");
    assert.equal(plan.sacrifices, 0);
    assert.equal(plan.required, 2);
  });

  it("l'Évolyte laisse choisir la forme, sans supplément et sans points", () => {
    const plan = collection.describeEvolution(species("Évoli").id, species("Pyroli").id, "evolyte");
    assert.equal(plan.target.name, "Pyroli");
    assert.equal(plan.points, 0);
    assert.equal(plan.helper.choose, true);
  });

  it("un objet refuse une espèce hors de sa lignée, et un objet sans évolution est refusé", () => {
    const wrong = collection.describeEvolution(species("Rattata").id, null, "evolyte");
    assert.match(wrong.error, /Évolyte.*ne s'utilise que sur Évoli/);
    assert.match(collection.describeEvolution(species("Rattata").id, null, "ball_super").error, /ne sert pas aux évolutions/);
    assert.match(collection.describeEvolution(species("Rattata").id, null, "n_importe_quoi").error, /ne sert pas aux évolutions/);
  });

  it("un objet mal configuré est refusé plutôt que de produire un coût absurde", () => {
    sandbox.writeConfig({
      pokemon: {
        generationOpenings: { 2: "2999-01-01T00:00:00+01:00" },
        items: { super_bonbon: { evolution: { copies: 1, quantity: 0 } } },
      },
    });
    assert.match(collection.describeHelper("super_bonbon", species("Rattata").id).error, /mal configuré/);
  });

  it("les objets proposés pour une espèce sont ceux de sa lignée et ceux qui servent à toutes", () => {
    const keys = (name) => collection.evolutionHelpers(species(name).id).map((item) => item.key);
    assert.ok(keys("Rattata").includes("super_bonbon"));
    assert.ok(!keys("Rattata").includes("evolyte"));
    assert.ok(keys("Évoli").includes("evolyte"));
    assert.ok(keys("Évoli").includes("super_bonbon"));
    assert.deepEqual(collection.evolutionHelpers(99999), []);
  });

  it("l'échange, pas l'évolution, ne devient jamais une source : Mackogneur n'évolue plus", () => {
    assert.match(collection.describeEvolution(species("Mackogneur").id).error, /évoluer|évolution/);
  });
});

describe("qui paie les sacrifices (sacrificeFill)", () => {
  it("des exemplaires tant qu'il en reste un en plus de celui qui évolue, puis Métamorph", () => {
    assert.deepEqual(collection.sacrificeFill({ sacrifices: 2 }, { total: 5, free: 5 }), { real: 2, missing: 0, dittos: 0 });
    assert.deepEqual(collection.sacrificeFill({ sacrifices: 2 }, { total: 3, free: 3 }), { real: 1, missing: 1, dittos: 1 });
  });

  it("un verrouillé ne se sacrifie pas : seul un libre compte", () => {
    assert.deepEqual(collection.sacrificeFill({ sacrifices: 1 }, { total: 4, free: 0 }), { real: 0, missing: 1, dittos: 1 });
  });

  it("le tarif de Métamorph se règle : deux par sacrifice manquant", () => {
    sandbox.writeConfig({
      pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" }, evolution: { dittosPerCopy: 2 } },
    });
    assert.deepEqual(collection.sacrificeFill({ sacrifices: 2 }, { total: 3, free: 3 }), { real: 1, missing: 1, dittos: 2 });
  });
});

describe("le refus d'une évolution (evolutionShortage)", () => {
  const plan = () => collection.describeEvolution(species("Rattata").id);

  it("dit combien il en faut et combien on en a", () => {
    const text = collection.evolutionShortage(plan(), { total: 2, free: 2 });
    assert.match(text, /Il te faut \*\*3\*\* Rattata/);
    assert.match(text, /1 sacrifice non verrouillé/);
    assert.match(text, /Tu en as \*\*2\*\*\./);
    assert.doesNotMatch(text, /verrouillé[s]? 🛡️/);
  });

  it("nomme les verrouillés quand ce sont eux qui manquent", () => {
    assert.match(collection.evolutionShortage(plan(), { total: 3, free: 1 }), /dont \*\*2\*\* verrouillés 🛡️/);
    assert.match(collection.evolutionShortage(plan(), { total: 2, free: 1 }), /dont \*\*1\*\* verrouillé 🛡️/);
  });

  it("omet les chiffres plutôt que d'en inventer quand la lecture a échoué", () => {
    assert.doesNotMatch(collection.evolutionShortage(plan(), null), /Tu en as/);
  });
});

describe("faire évoluer (evolve)", () => {
  it("l'individu change d'espèce en restant lui-même, le sacrifice part, un exemplaire reste", async () => {
    const [first, second, third] = await giveMany("Rattata", 3);
    await setBalance(2000);

    const result = await evolve(byId("Rattata", third));
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.target.name, "Rattatac");
    assert.deepEqual(result.spent, { sacrifices: 1, dittos: 0, shinies: 0 });
    assert.equal(result.evolved.id, third, "même identifiant : c'est le même Pokémon");

    assert.equal(await balance(), 2000 - evolution()[2].points);
    const evolved = await ofSpecies("Rattatac");
    assert.deepEqual(evolved.map((row) => row.id), [third]);
    const left = await ofSpecies("Rattata");
    assert.equal(left.length, 1, "un exemplaire reste : l'entrée du Pokédex n'est jamais perdue");
    assert.ok([first, second].includes(left[0].id));
  });

  it("le journal garde la trace de l'évolution", async () => {
    const [, , third] = await giveMany("Rattata", 3);
    await setBalance(2000);
    await evolve(byId("Rattata", third));
    const [log] = await fusions();
    assert.equal(log.user_id, "u1");
    assert.equal(log.from_species_id, species("Rattata").id);
    assert.equal(log.to_species_id, species("Rattatac").id);
    assert.equal(log.duplicates_spent, 1);
    assert.equal(log.points_spent, evolution()[2].points);
  });

  it("un exemplaire de moins que le tarif : refus chiffré, rien ne bouge", async () => {
    const ids = await giveMany("Rattata", 2);
    await setBalance(5000);
    const result = await evolve(byId("Rattata", ids[1]));
    assert.equal(result.ok, false);
    assert.match(result.reason, /Il te faut \*\*3\*\* Rattata/);
    assert.match(result.reason, /Tu en as \*\*2\*\*/);
    assert.deepEqual((await ofSpecies("Rattata")).map((row) => row.id), ids);
    assert.equal(await balance(), 5000);
    assert.deepEqual(await fusions(), []);
  });

  it("un seul exemplaire : il est le dernier de son espèce, il ne peut pas évoluer seul", async () => {
    const [only] = await giveMany("Rattata", 1);
    await setBalance(5000);
    const result = await evolve(byId("Rattata", only));
    assert.equal(result.ok, false);
    assert.equal((await ofSpecies("Rattata")).length, 1);
    assert.equal((await ofSpecies("Rattatac")).length, 0);
  });

  it("les verrouillés ne se sacrifient pas, et le refus dit combien le sont", async () => {
    const [evolver] = await giveMany("Rattata", 1);
    await give("Rattata", { locked: 1, obtained: 5 });
    await give("Rattata", { locked: 1, obtained: 6 });
    await setBalance(5000);
    const result = await evolve(byId("Rattata", evolver));
    assert.equal(result.ok, false);
    assert.match(result.reason, /dont \*\*2\*\* verrouillés 🛡️/);
    assert.equal((await ofSpecies("Rattata")).length, 3);
  });

  it("des points qui manquent rendent les sacrifices à l'identique", async () => {
    const ids = await giveMany("Rattata", 3);
    await setBalance(100);
    const before = await rows();
    const result = await evolve(byId("Rattata", ids[2]));
    assert.equal(result.ok, false);
    assert.match(result.reason, new RegExp(`Solde insuffisant : cette évolution coûte \\*\\*${evolution()[2].points}\\*\\* points`));
    assert.deepEqual(await rows(), before, "mêmes identifiants, même espèce, rien en moins");
    assert.equal(await balance(), 100);
    assert.deepEqual(await fusions(), []);
  });

  it("un dresseur sans solde du tout est refusé sans rien perdre", async () => {
    const ids = await giveMany("Rattata", 3);
    const before = await rows();
    const result = await evolve(byId("Rattata", ids[2]));
    assert.equal(result.ok, false);
    assert.deepEqual(await rows(), before);
  });

  it("un second clic sur un Pokémon qui vient d'évoluer est refusé", async () => {
    const ids = await giveMany("Rattata", 4);
    await setBalance(5000);
    assert.equal((await evolve(byId("Rattata", ids[3]))).ok, true);
    const again = await evolve(byId("Rattata", ids[3]));
    assert.equal(again.ok, false);
    assert.match(again.reason, new RegExp(`#${ids[3]} ne peut pas évoluer : ce n'est plus un de tes Rattata`));
    assert.equal(await balance(), 5000 - evolution()[2].points, "payé une seule fois");
  });

  it("désigner le Pokémon d'un autre est refusé", async () => {
    const stranger = await give("Rattata", { user: "u2" });
    const result = await evolve({ pokemonId: stranger }, null, null, "u1");
    assert.equal(result.ok, false);
    assert.match(result.reason, /n'est pas dans cette boîte/);
    assert.equal((await ofSpecies("Rattata", "u2")).length, 1);
  });

  it("un individu verrouillé demande confirmation, puis évolue sans quitter la boîte", async () => {
    const [, , locked] = [await give("Rattata", { obtained: 1 }), await give("Rattata", { obtained: 2 }), await give("Rattata", { locked: 1, obtained: 3 })];
    await setBalance(5000);

    const asked = await evolve(byId("Rattata", locked));
    assert.equal(asked.ok, false);
    assert.equal(asked.locked, true);
    assert.match(asked.reason, /est verrouillé 🛡️/);
    assert.equal((await ofSpecies("Rattata")).length, 3, "rien n'a bougé");
    assert.equal(await balance(), 5000);

    const confirmed = await evolve(byId("Rattata", locked, { confirmLocked: true }));
    assert.equal(confirmed.ok, true, confirmed.reason);
    const [evolved] = await ofSpecies("Rattatac");
    assert.equal(evolved.id, locked);
    assert.equal(evolved.locked, 1, "il reste verrouillé sous sa nouvelle forme");
  });

  it("l'espèce attendue protège d'un bouton périmé : un autre Pokémon ne prend pas sa place", async () => {
    const [rattata, ...others] = await giveMany("Rattata", 3);
    await give("Roucool");
    await setBalance(5000);
    const result = await evolve({ speciesId: species("Roucool").id, isShiny: null, pokemonId: rattata });
    assert.equal(result.ok, false);
    assert.equal((await ofSpecies("Rattata")).length, 1 + others.length);
  });

  it("le tirage d'un embranchement suit le hasard, et chaque forme est atteignable", async () => {
    const outcomes = new Set();
    for (const value of [0, 0.5, 0.99]) {
      await dbRun(points, "DELETE FROM pokemon_owned");
      await setBalance(5000);
      const ids = await giveMany("Évoli", 3);
      const result = await withRandom(value, async () => evolve(byId("Évoli", ids[2])));
      assert.equal(result.ok, true, result.reason);
      assert.equal(result.plan.points, evolution()[2].points, "un tirage ne paie pas le supplément du choix");
      outcomes.add(result.target.name);
    }
    assert.deepEqual([...outcomes].sort(), ["Aquali", "Pyroli", "Voltali"]);
  });

  it("choisir sa forme coûte le supplément", async () => {
    const ids = await giveMany("Évoli", 3);
    await setBalance(10000);
    const result = await evolve(byId("Évoli", ids[2]), species("Aquali").id);
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.target.name, "Aquali");
    assert.equal(await balance(), 10000 - evolution().branchChoicePoints);
  });

  it("deux évolutions simultanées du même individu : une seule passe, payée une seule fois", async () => {
    const ids = await giveMany("Rattata", 3);
    await setBalance(10000);
    const results = await Promise.all([evolve(byId("Rattata", ids[2])), evolve(byId("Rattata", ids[2]))]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(await balance(), 10000 - evolution()[2].points);
    assert.equal((await ofSpecies("Rattatac")).length, 1);
    assert.equal((await fusions()).length, 1);
  });
});

describe("l'évolution d'échange d'un Pokémon reçu en échange", () => {
  // Reçu en échange : l'origine « echange », que pose acceptTrade.
  const traded = async (name, options = {}) => {
    const id = await give(name, options);
    await dbRun(points, "UPDATE pokemon_owned SET origin = 'echange' WHERE id = ?", [id]);
    return id;
  };

  it("est gratuite : ni points ni sacrifice, et un exemplaire reste derrière lui", async () => {
    const [kept, id] = [await give("Machopeur"), await traded("Machopeur", { obtained: 2 })];
    await setBalance(0);
    const result = await evolve(byId("Machopeur", id));
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.target.name, "Mackogneur");
    assert.deepEqual(result.spent, { sacrifices: 0, dittos: 0, shinies: 0 });
    assert.equal(await balance(), 0);
    assert.deepEqual((await ofSpecies("Mackogneur")).map((row) => row.id), [id]);
    assert.deepEqual((await ofSpecies("Machopeur")).map((row) => row.id), [kept], "l'entrée du Pokédex reste");
    assert.equal((await fusions())[0].points_spent, 0);
  });

  it("refuse le seul Machopeur : il faut un exemplaire restant, comme pour toute évolution", async () => {
    const id = await traded("Machopeur");
    const result = await evolve(byId("Machopeur", id));
    assert.equal(result.ok, false);
    assert.match(result.reason, /dernier|2/);
    assert.deepEqual((await ofSpecies("Machopeur")).map((row) => row.id), [id], "rien n'a bougé");
  });

  it("s'applique aux quatre espèces qui évoluent à l'échange", async () => {
    for (const [from, to] of [["Kadabra", "Alakazam"], ["Gravalanch", "Grolem"], ["Spectrum", "Ectoplasma"]]) {
      await give(from);
      const id = await traded(from, { obtained: 2 });
      const result = await evolve(byId(from, id));
      assert.equal(result.ok, true, `${from} : ${result.reason}`);
      assert.equal(result.target.name, to);
    }
  });

  it("ne vaut pas pour un Machopeur qui n'a jamais été échangé : l'évolution reste payante, et le dernier ne part pas", async () => {
    const [first, second] = await giveMany("Machopeur", 2);
    await setBalance(0);
    const broke = await evolve(byId("Machopeur", second));
    assert.equal(broke.ok, false);
    assert.equal(broke.ok, false, "Mackogneur se paie, échangé ou non");
    const lone = await give("Machopeur", { user: "u2" });
    const refused = await evolve(byId("Machopeur", lone), null, null, "u2");
    assert.equal(refused.ok, false);
    assert.ok(first);
  });

  it("ne rend pas gratuite une autre évolution : un Rattata échangé paie comme avant", async () => {
    const [first, , third] = [await traded("Rattata"), await traded("Rattata", { obtained: 2 }), await traded("Rattata", { obtained: 3 })];
    await setBalance(0);
    const result = await evolve(byId("Rattata", third));
    assert.equal(result.ok, false, "Rattatac coûte des points, échangé ou non");
    assert.ok(first);
  });

  it("le plan le dit : gratuit, deux exemplaires requis, `traded` pour l'écran", () => {
    const plan = collection.describeEvolution(species("Machopeur").id, null, null, { traded: true });
    assert.deepEqual([plan.points, plan.sacrifices, plan.required, plan.traded], [0, 0, 2, true]);
    const normal = collection.describeEvolution(species("Machopeur").id);
    assert.equal(normal.traded, undefined);
    assert.ok(normal.points > 0);
  });
});

describe("évoluer sans désigner d'individu", () => {
  it("le bot sacrifie les moins précieux et garde le shiny : normaux d'abord, puis les plus récents", async () => {
    const old = await give("Rattata", { obtained: 1 });
    const recent = await give("Rattata", { obtained: 9 });
    const shiny = await give("Rattata", { shiny: 1, obtained: 5, locked: 0 });
    await setBalance(5000);

    const result = await evolve({ speciesId: species("Rattata").id, isShiny: null });
    assert.equal(result.ok, true, result.reason);
    // Le plus récent des normaux est sacrifié, le suivant évolue : le shiny reste.
    const left = (await rows()).map((row) => row.id).sort((a, b) => a - b);
    assert.equal(left.length, 2);
    assert.ok(left.includes(shiny), "le shiny n'est ni sacrifié ni choisi pour évoluer tant qu'il y a mieux");
    assert.ok(!left.includes(recent), "le plus récent des normaux est le sacrifice");
    assert.equal(result.evolved.id, old);
  });

  it("le bot ne fait jamais évoluer un verrouillé de lui-même", async () => {
    await giveMany("Rattata", 3, { locked: 1 });
    await setBalance(5000);
    const result = await evolve({ speciesId: species("Rattata").id, isShiny: null });
    assert.equal(result.ok, false);
    assert.match(result.reason, /Le bot ne fait jamais évoluer un verrouillé/);
    assert.equal((await ofSpecies("Rattata")).length, 3);
  });

  it("deux verrouillés pour un libre : celui qui évolue manque de sacrifice, refus chiffré", async () => {
    await give("Rattata");
    await give("Rattata", { locked: 1, obtained: 2 });
    await give("Rattata", { locked: 1, obtained: 3 });
    await setBalance(5000);
    const result = await evolve({ speciesId: species("Rattata").id, isShiny: null });
    assert.equal(result.ok, false);
    assert.match(result.reason, /Il te faut \*\*3\*\* Rattata/);
    assert.match(result.reason, /Tu en as \*\*3\*\*, dont \*\*2\*\* verrouillés/);
    assert.equal((await ofSpecies("Rattata")).length, 3);
    assert.equal(await balance(), 5000);
  });

  it("un verrouillé peut être l'exemplaire qui reste : deux libres suffisent pour évoluer et se sacrifier", async () => {
    await give("Rattata");
    await give("Rattata", { obtained: 2 });
    const kept = await give("Rattata", { locked: 1, obtained: 3 });
    await setBalance(5000);
    const result = await evolve({ speciesId: species("Rattata").id, isShiny: null });
    assert.equal(result.ok, true, result.reason);
    assert.deepEqual((await ofSpecies("Rattata")).map((row) => row.id), [kept]);
  });

  it("la variante demandée ne choisit que celui qui évolue : les sacrifices, eux, partent normaux d'abord", async () => {
    const normal = await give("Rattata", { obtained: 1 });
    await give("Rattata", { shiny: 1, obtained: 2 });
    await give("Rattata", { shiny: 1, obtained: 3 });
    const newest = await give("Rattata", { shiny: 1, obtained: 4 });
    await setBalance(5000);
    const result = await evolve({ speciesId: species("Rattata").id, isShiny: true });
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.isShiny, true);
    assert.equal(result.evolved.id, newest, "le shiny le plus récent évolue");
    assert.equal(result.spent.shinies, 0, "un shiny n'est sacrifié que faute de normal");
    const left = await ofSpecies("Rattata");
    assert.ok(!left.some((row) => row.id === normal), "le normal est parti en sacrifice");
    assert.equal(left.filter((row) => row.is_shiny).length, 2);
  });

  it("sans normal, c'est un shiny qui se sacrifie, et le message le dira", async () => {
    await give("Rattata", { shiny: 1, obtained: 1 });
    await give("Rattata", { shiny: 1, obtained: 2 });
    await give("Rattata", { shiny: 1, obtained: 3 });
    await setBalance(5000);
    const result = await evolve({ speciesId: species("Rattata").id, isShiny: null });
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.spent.sacrifices, 1);
    assert.equal(result.spent.shinies, 1, "un shiny sacrifié ne se rattrape pas : le résultat le compte pour que le message le dise");
  });
});

describe("évoluer avec un objet", () => {
  it("trois Super Bonbons tiennent lieu du sacrifice : seul l'individu évolue, les bonbons sont consommés", async () => {
    const [first, second] = await giveMany("Rattata", 2);
    await grant("super_bonbon", 4);
    await setBalance(5000);

    const result = await evolve(byId("Rattata", second), null, "super_bonbon");
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.spent.sacrifices, 0);
    assert.equal(await stock("super_bonbon"), 1, "trois consommés sur quatre");
    assert.deepEqual((await ofSpecies("Rattata")).map((row) => row.id), [first], "personne n'est sacrifié");
    assert.equal(await balance(), 5000 - evolution()[2].points, "l'objet ne remplace pas les points");
  });

  it("deux bonbons ne suffisent pas : refus, et l'individu revient tel quel", async () => {
    const ids = await giveMany("Rattata", 2);
    await grant("super_bonbon", 2);
    await setBalance(5000);
    const before = await rows();
    const result = await evolve(byId("Rattata", ids[1]), null, "super_bonbon");
    assert.equal(result.ok, false);
    assert.match(result.reason, /Il te faut \*\*3\*\* 🍬 Super Bonbon/);
    assert.deepEqual(await rows(), before);
    assert.equal(await stock("super_bonbon"), 2);
    assert.equal(await balance(), 5000);
  });

  it("des points qui manquent rendent aussi les bonbons : compensation en cascade", async () => {
    const ids = await giveMany("Rattata", 2);
    await grant("super_bonbon", 3);
    await setBalance(10);
    const before = await rows();
    const result = await evolve(byId("Rattata", ids[1]), null, "super_bonbon");
    assert.equal(result.ok, false);
    assert.match(result.reason, /Solde insuffisant/);
    assert.equal(await stock("super_bonbon"), 3, "les trois bonbons reviennent");
    assert.deepEqual(await rows(), before);
    assert.equal(await balance(), 10);
  });

  it("l'Évolyte fait évoluer un Évoli dans la forme choisie, sans points", async () => {
    const ids = await giveMany("Évoli", 2);
    await grant("evolyte", 1);
    const result = await evolve(byId("Évoli", ids[1]), species("Voltali").id, "evolyte");
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.target.name, "Voltali");
    assert.equal(result.plan.points, 0);
    assert.equal(await stock("evolyte"), 0);
    assert.equal(await balance(), 0, "aucun point n'est débité, même sans solde");
    assert.equal((await fusions())[0].points_spent, 0);
  });

  it("un objet qui n'est pas dans le sac : refus chiffré", async () => {
    const ids = await giveMany("Évoli", 2);
    const before = await rows();
    const result = await evolve(byId("Évoli", ids[1]), species("Voltali").id, "evolyte");
    assert.equal(result.ok, false);
    assert.match(result.reason, /Il te faut \*\*1\*\* 🔮 Évolyte/);
    assert.deepEqual(await rows(), before);
  });

  it("un objet qui ne sert pas à cette espèce est refusé avant tout retrait", async () => {
    const ids = await giveMany("Rattata", 3);
    await grant("evolyte", 1);
    const before = await rows();
    const result = await evolve(byId("Rattata", ids[2]), null, "evolyte");
    assert.equal(result.ok, false);
    assert.match(result.reason, /ne s'utilise que sur Évoli/);
    assert.deepEqual(await rows(), before);
    assert.equal(await stock("evolyte"), 1);
  });
});

describe("Métamorph, joker des évolutions", () => {
  const ditto = () => collection.DITTO_HELPER;

  it("tient lieu du sacrifice manquant, et il en reste un", async () => {
    const ids = await giveMany("Rattata", 2);
    const dittos = await giveMany("Métamorph", 2);
    await setBalance(5000);
    const result = await evolve(byId("Rattata", ids[1]), null, ditto());
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.spent.dittos, 1);
    assert.equal(result.spent.sacrifices, 0);
    assert.equal((await ofSpecies("Métamorph")).length, dittos.length - 1, "un Métamorph reste");
    assert.equal((await ofSpecies("Rattata")).length, 1);
    assert.equal((await ofSpecies("Rattatac")).length, 1);
  });

  it("sans le demander, il ne sert pas : le refus est celui des exemplaires", async () => {
    const ids = await giveMany("Rattata", 2);
    await giveMany("Métamorph", 3);
    await setBalance(5000);
    const result = await evolve(byId("Rattata", ids[1]));
    assert.equal(result.ok, false);
    assert.match(result.reason, /Il te faut \*\*3\*\* Rattata/);
    assert.equal((await ofSpecies("Métamorph")).length, 3);
  });

  it("trop peu de Métamorph : refus chiffré, l'individu et ses sacrifices reviennent", async () => {
    const ids = await giveMany("Rattata", 2);
    await giveMany("Métamorph", 1);
    await setBalance(5000);
    const before = await rows();
    const result = await evolve(byId("Rattata", ids[1]), null, ditto());
    assert.equal(result.ok, false);
    assert.match(result.reason, /Il te faut \*\*2\*\* Métamorph/);
    assert.match(result.reason, /Tu en as \*\*1\*\*/);
    assert.deepEqual(await rows(), before);
    assert.equal(await balance(), 5000);
  });

  it("des points qui manquent rendent les Métamorph aussi", async () => {
    const ids = await giveMany("Rattata", 2);
    await giveMany("Métamorph", 2);
    await setBalance(1);
    const before = await rows();
    const result = await evolve(byId("Rattata", ids[1]), null, ditto());
    assert.equal(result.ok, false);
    assert.match(result.reason, /Solde insuffisant/);
    assert.deepEqual(await rows(), before);
  });
});

describe("une panne en cours de route rend tout", () => {
  it("l'arrivée de la nouvelle forme échoue : points, bonbons, sacrifices et individu reviennent", async () => {
    const ids = await giveMany("Rattata", 2);
    await grant("super_bonbon", 3);
    await setBalance(5000);
    const before = await rows();
    // Seule l'arrivée d'un Rattatac échoue : la compensation, elle, remet des Rattata.
    await dbRun(
      points,
      `CREATE TRIGGER panne BEFORE INSERT ON pokemon_owned WHEN NEW.species_id = ${species("Rattatac").id}
       BEGIN SELECT RAISE(ABORT, 'panne'); END`
    );
    await assert.rejects(() => evolve(byId("Rattata", ids[1]), null, "super_bonbon"), /panne/);
    await dbRun(points, "DROP TRIGGER panne");

    assert.deepEqual(await rows(), before, "chaque individu est revenu, identifiants compris");
    assert.equal(await balance(), 5000, "les points ont été rendus");
    assert.equal(await stock("super_bonbon"), 3, "les bonbons ont été rendus");
    assert.deepEqual(await fusions(), []);
  });

  it("même chose avec des sacrifices réels : tout revient dans l'ordre", async () => {
    const ids = await giveMany("Rattata", 3);
    await setBalance(5000);
    const before = await rows();
    await dbRun(
      points,
      `CREATE TRIGGER panne BEFORE INSERT ON pokemon_owned WHEN NEW.species_id = ${species("Rattatac").id}
       BEGIN SELECT RAISE(ABORT, 'panne'); END`
    );
    await assert.rejects(() => evolve(byId("Rattata", ids[2])), /panne/);
    await dbRun(points, "DROP TRIGGER panne");
    assert.deepEqual(await rows(), before);
    assert.equal(await balance(), 5000);
  });
});
