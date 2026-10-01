// Les œufs, de la ponte à l'éclosion. Génération 2 ouverte : c'est elle qui apporte
// les bébés. Trois règles tiennent l'économie — chaque parent ne pond qu'une fois,
// un seul œuf en couvaison par dresseur, l'éclosion au premier des deux seuils
// (les heures ou les messages) — et chacune doit tenir sous des clics simultanés.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbAll, dbGet, sleep, withRandom, speciesByName } from "./helpers.js";

const GEN2 = { pokemon: { generation: 2 } };
const sandbox = createSandbox({ config: GEN2 });
process.env.POKEMON_CHANNEL_ID = "123";
const { points } = await openDatabases();
const eggs = await import("../modules/pokemon/eggs.js");
const collection = await import("../modules/pokemon/collection.js");
const data = await import("../modules/pokemon/data.js");
const items = await import("../modules/pokemon/items.js");
const { getPokemonConfig } = await import("../modules/pokemon/config.js");

const species = (name) => speciesByName(data.allSpecies, name);
const call = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value))));
const HOUR = 3_600_000;

async function own(name, { user = "u1", sex = "M", shiny = 0, sterile = 0, obtained = 1 } = {}) {
  const { lastID } = await dbRun(
    points,
    "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, sterile, obtained_at) VALUES (?, ?, ?, ?, 'test', ?, ?)",
    [user, species(name).id, shiny, sex, sterile, obtained]
  );
  return lastID;
}
// Un individu précis, résolu comme le font les commandes (resolveSelector) au nom
// de celui qui pond ; un groupe passe tel quel.
const parent = (id) => ({ __id: id });
const resolveParent = (value, user) => (value.__id === undefined ? value : call(collection.resolveSelector, user, `#${value.__id}`));
const group = (name, sex, shiny = false) => ({ speciesId: species(name).id, isShiny: shiny, sex });
const lay = async (first, second, user = "u1") =>
  call(eggs.layEgg, user, await resolveParent(first, user), await resolveParent(second, user));
const eggsOf = (user = "u1") => dbAll(points, "SELECT * FROM pokemon_eggs WHERE user_id = ? ORDER BY id", [user]);
const sterileOf = async (...ids) => (await Promise.all(ids.map((id) => dbGet(points, "SELECT sterile FROM pokemon_owned WHERE id = ?", [id])))).map((row) => row.sterile);
const babies = (name = "Pichu", user = "u1") => dbAll(points, "SELECT * FROM pokemon_owned WHERE user_id = ? AND species_id = ? AND origin = 'oeuf'", [user, species(name).id]);

// Un salon qui note les annonces d'éclosion.
function fakeClient({ sendFails = false } = {}) {
  const sent = [];
  const channel = {
    send: async (payload) => {
      if (sendFails) throw new Error("salon fermé");
      sent.push(payload);
    },
  };
  return { sent, channels: { fetch: async () => channel } };
}

beforeEach(async () => {
  await dbRun(points, "DROP TRIGGER IF EXISTS panne");
  for (const table of ["pokemon_eggs", "pokemon_owned", "pokemon_inventory", "pokemon_item_log"]) await dbRun(points, `DELETE FROM ${table}`);
  sandbox.writeConfig(GEN2);
});

describe("qui peut pondre (describeEgg)", () => {
  const side = (name, sex) => ({ species: species(name), sex });

  it("un mâle et une femelle de la même famille donnent le bébé de la famille", () => {
    const plan = eggs.describeEgg(side("Pikachu", "M"), side("Raichu", "F"));
    assert.equal(plan.baby.name, "Pichu");
    assert.equal(plan.father.species.name, "Pikachu");
    assert.equal(plan.mother.species.name, "Raichu");
    assert.equal(eggs.describeEgg(side("Pikachu", "F"), side("Pikachu", "M")).father.sex, "M", "l'ordre des arguments n'a pas d'importance");
  });

  it("Métamorph remplace l'un des deux, de n'importe quel sexe du partenaire — jamais les deux", () => {
    const withMale = eggs.describeEgg(side("Pikachu", "M"), side("Métamorph", null));
    assert.equal(withMale.baby.name, "Pichu");
    assert.equal(withMale.mother.species.name, "Métamorph", "il prend le rôle qui reste");
    const withFemale = eggs.describeEgg(side("Métamorph", null), side("Pikachu", "F"));
    assert.equal(withFemale.father.species.name, "Métamorph");
    assert.match(eggs.describeEgg(side("Métamorph", null), side("Métamorph", null)).error, /Deux Métamorph ne pondent rien/);
  });

  it("deux mâles, deux femelles, ou deux familles différentes : refus qui dit pourquoi", () => {
    assert.match(eggs.describeEgg(side("Pikachu", "M"), side("Pikachu", "M")).error, /Il faut un mâle et une femelle/);
    assert.match(eggs.describeEgg(side("Pikachu", "F"), side("Raichu", "F")).error, /Il faut un mâle et une femelle/);
    const mixed = eggs.describeEgg(side("Pikachu", "M"), side("Rondoudou", "F"));
    assert.match(mixed.error, /ne sont pas de la même famille\. Métamorph peut remplacer l'un des deux/);
  });

  it("un Pokémon sans bébé, ou un bébé lui-même, ne pond pas : le refus cite les familles qui pondent", () => {
    const none = eggs.describeEgg(side("Roucool", "M"), side("Pikachu", "F"));
    assert.match(none.error, /\*\*Roucool\*\* n'a pas de bébé, il ne pond pas\. Seules les familles de .*Pichu.* pondent/);
    assert.match(eggs.describeEgg(side("Pichu", "M"), side("Pikachu", "F")).error, /\*\*Pichu\*\* n'a pas de bébé/, "le bébé ne pond pas");
  });

  it("un parent inconnu est refusé", () => {
    assert.equal(eggs.describeEgg({ species: null }, side("Pikachu", "F")).error, "Parent inconnu.");
  });

  it("en génération 1, aucun bébé n'existe : le refus l'explique", () => {
    sandbox.writeConfig({ pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } });
    assert.deepEqual(eggs.babyFamilies(), []);
    assert.match(eggs.describeEgg(side("Pikachu", "M"), side("Pikachu", "F")).error, /les œufs arrivent avec la génération 2/);
  });
});

describe("pondre (layEgg)", () => {
  it("un œuf du bébé de la famille : couvé, avec ses échéances ; les deux parents deviennent stériles", async () => {
    const father = await own("Pikachu", { sex: "M" });
    const mother = await own("Raichu", { sex: "F" });
    const before = Date.now();
    const result = await lay(parent(father), parent(mother));
    assert.equal(result.ok, true);
    const [egg] = await eggsOf();
    assert.equal(egg.species_id, species("Pichu").id);
    assert.equal(egg.status, "INCUBATING");
    assert.equal(egg.father_id, father);
    assert.equal(egg.mother_id, mother);
    assert.equal(egg.father_species_id, species("Pikachu").id);
    assert.equal(egg.mother_species_id, species("Raichu").id);
    assert.equal(egg.hatch_messages, getPokemonConfig().eggs.hatchMessages);
    assert.ok(Math.abs(egg.hatch_at - (before + getPokemonConfig().eggs.hatchHours * HOUR)) < 5000, "le délai est celui du réglage");
    assert.equal(egg.shiny_parents, 0);
    assert.deepEqual(await sterileOf(father, mother), [1, 1]);
    assert.equal((await call(eggs.getIncubatingEgg, "u1")).id, egg.id);
  });

  it("les parents peuvent se désigner par groupe : le plus récent des fertiles part", async () => {
    await own("Pikachu", { sex: "M", obtained: 1 });
    const recentMale = await own("Pikachu", { sex: "M", obtained: 9 });
    const female = await own("Pikachu", { sex: "F", obtained: 2 });
    assert.equal((await lay(group("Pikachu", "M"), group("Pikachu", "F"))).ok, true);
    assert.deepEqual(await sterileOf(recentMale, female), [1, 1]);
  });

  it("un parent shiny est retenu à la ponte, même s'il part avant l'éclosion", async () => {
    const father = await own("Pikachu", { sex: "M", shiny: 1 });
    const mother = await own("Pikachu", { sex: "F", shiny: 1 });
    await lay(parent(father), parent(mother));
    assert.equal((await eggsOf())[0].shiny_parents, 2);
    await dbRun(points, "DELETE FROM pokemon_owned");
    assert.equal((await eggsOf())[0].shiny_parents, 2);
  });

  it("un seul œuf à la fois : le refus rend les parents du second couple fertiles", async () => {
    const [m1, f1] = [await own("Pikachu", { sex: "M" }), await own("Pikachu", { sex: "F", obtained: 2 })];
    const [m2, f2] = [await own("Pikachu", { sex: "M", obtained: 3 }), await own("Pikachu", { sex: "F", obtained: 4 })];
    assert.equal((await lay(parent(m1), parent(f1))).ok, true);
    const second = await lay(parent(m2), parent(f2));
    assert.equal(second.ok, false);
    assert.match(second.reason, /Tu couves déjà un œuf/);
    assert.deepEqual(await sterileOf(m2, f2), [0, 0]);
    assert.equal((await eggsOf()).length, 1);
  });

  it("chaque parent ne pond qu'une fois : un stérile est refusé, avec son numéro", async () => {
    const father = await own("Pikachu", { sex: "M", sterile: 1 });
    const mother = await own("Pikachu", { sex: "F" });
    const refused = await lay(parent(father), parent(mother));
    assert.equal(refused.ok, false);
    assert.match(refused.reason, new RegExp(`Le Pokémon #${father} ne peut plus pondre : chaque Pokémon ne pond qu'une fois dans sa vie`));
    assert.deepEqual(await sterileOf(mother), [0], "la mère n'a pas été prise");
    assert.deepEqual(await eggsOf(), []);
  });

  it("un seul parent disponible : celui qui a été pris est rendu fertile", async () => {
    const father = await own("Pikachu", { sex: "M" });
    const refused = await lay(parent(father), group("Pikachu", "F"));
    assert.equal(refused.ok, false);
    assert.deepEqual(await sterileOf(father), [0], "compensation en cascade");
  });

  it("le Pokémon d'un autre n'est pas un parent possible", async () => {
    const father = await own("Pikachu", { sex: "M" });
    const stranger = await own("Pikachu", { sex: "F", user: "u2" });
    const refused = await lay(parent(father), parent(stranger));
    assert.equal(refused.ok, false);
    assert.deepEqual(await sterileOf(father, stranger), [0, 0]);
  });

  it("deux pontes simultanées avec les mêmes parents : un seul œuf, une seule fois", async () => {
    const father = await own("Pikachu", { sex: "M" });
    const mother = await own("Pikachu", { sex: "F" });
    const results = await Promise.all([lay(parent(father), parent(mother)), lay(parent(father), parent(mother))]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal((await eggsOf()).length, 1);
  });

  it("les œufs désactivés par la configuration ne se pondent pas", async () => {
    sandbox.writeConfig({ pokemon: { generation: 2, eggs: { enabled: false } } });
    const father = await own("Pikachu", { sex: "M" });
    const mother = await own("Pikachu", { sex: "F" });
    const result = await lay(parent(father), parent(mother));
    assert.deepEqual(result, { ok: false, reason: "Les œufs sont désactivés." });
    assert.deepEqual(await sterileOf(father, mother), [0, 0]);
  });

  it("une panne à l'écriture de l'œuf rend les deux parents", async () => {
    const father = await own("Pikachu", { sex: "M" });
    const mother = await own("Pikachu", { sex: "F" });
    await dbRun(points, "CREATE TRIGGER panne BEFORE INSERT ON pokemon_eggs BEGIN SELECT RAISE(ABORT, 'panne'); END");
    await assert.rejects(() => lay(parent(father), parent(mother)), /panne/);
    assert.deepEqual(await sterileOf(father, mother), [0, 0]);
  });

  it("Métamorph est un parent comme les autres : stérile ensuite, lui aussi", async () => {
    const pikachu = await own("Pikachu", { sex: "M" });
    const ditto = await own("Métamorph", { sex: null });
    assert.equal((await lay(parent(pikachu), parent(ditto))).ok, true);
    assert.deepEqual(await sterileOf(pikachu, ditto), [1, 1]);
    assert.equal((await eggsOf())[0].species_id, species("Pichu").id);
  });
});

describe("le facteur de shiny d'un œuf", () => {
  it("×2 par parent shiny : ×1, ×2, ×4", () => {
    assert.deepEqual([0, 1, 2].map((count) => eggs.eggShinyFactor(count)), [1, 2, 4]);
    assert.equal(eggs.eggShinyFactor(undefined), 1);
    assert.equal(eggs.eggShinyFactor(-3), 1);
  });

  it("le multiplicateur se règle, et un réglage absurde vaut 1", () => {
    sandbox.writeConfig({ pokemon: { generation: 2, eggs: { shinyParentMultiplier: 3 } } });
    assert.equal(eggs.eggShinyFactor(2), 9);
  });

  it("le Charme Chroma de la génération du bébé s'y ajoute, celui d'une autre non", async () => {
    const egg = { user_id: "u1", species_id: species("Pichu").id };
    assert.equal(await new Promise((resolve) => eggs.eggCharmFactor(egg, resolve)), 1);
    await call(items.grantItem, "u1", "charme_chroma_1", 1, { source: "test" });
    assert.equal(await new Promise((resolve) => eggs.eggCharmFactor(egg, resolve)), 1, "Pichu est de la 2e génération");
    await call(items.grantItem, "u1", "charme_chroma_2", 1, { source: "test" });
    assert.equal(await new Promise((resolve) => eggs.eggCharmFactor(egg, resolve)), getPokemonConfig().shinyCharm.multiplier);
  });
});

describe("l'éclosion (hatchEgg)", () => {
  async function incubate({ shinyParents = 0, user = "u1" } = {}) {
    const father = await own("Pikachu", { sex: "M", user, shiny: shinyParents > 0 ? 1 : 0 });
    const mother = await own("Pikachu", { sex: "F", user, shiny: shinyParents > 1 ? 1 : 0 });
    await lay(parent(father), parent(mother), user);
    return (await eggsOf(user)).at(-1);
  }

  it("le bébé naît dans la boîte du dresseur, l'œuf passe à « éclos » et pointe vers lui", async () => {
    const egg = await incubate();
    const result = await withRandom(0.999, () => call(eggs.hatchEgg, egg.id));
    assert.equal(result.species.name, "Pichu");
    assert.equal(result.isShiny, false);
    const [born] = await babies();
    assert.ok(born, "un Pichu est dans la boîte");
    assert.equal(born.user_id, "u1");
    await sleep(40);
    const row = (await eggsOf())[0];
    assert.equal(row.status, "HATCHED");
    assert.equal(row.pokemon_id, born.id);
    assert.ok(row.hatched_at > 0);
  });

  it("la revendication est gardée : deux éclosions simultanées font un seul bébé", async () => {
    const egg = await incubate();
    const results = await withRandom(0.999, () => Promise.all([call(eggs.hatchEgg, egg.id), call(eggs.hatchEgg, egg.id)]));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await babies()).length, 1);
  });

  it("un œuf déjà éclos, ou inconnu, ne donne rien", async () => {
    const egg = await incubate();
    await call(eggs.hatchEgg, egg.id);
    assert.equal(await call(eggs.hatchEgg, egg.id), null);
    assert.equal(await call(eggs.hatchEgg, 99999), null);
  });

  it("le tirage de shiny suit les chances d'une apparition sauvage, multipliées par les parents", async () => {
    const odds = getPokemonConfig().spawn.shinyOdds;
    const plain = await incubate();
    const noLuck = await withRandom(1.5 / odds, () => call(eggs.hatchEgg, plain.id));
    assert.equal(noLuck.isShiny, false, "1,5 chance sur « odds » : raté sans parent shiny");

    await dbRun(points, "DELETE FROM pokemon_owned");
    const lucky = await incubate({ shinyParents: 1 });
    const withOne = await withRandom(1.5 / odds, () => call(eggs.hatchEgg, lucky.id));
    assert.equal(withOne.isShiny, true, "×2 avec un parent shiny : ce même tirage passe");

    await dbRun(points, "DELETE FROM pokemon_owned");
    const both = await incubate({ shinyParents: 2 });
    const withTwo = await withRandom(3.5 / odds, () => call(eggs.hatchEgg, both.id));
    assert.equal(withTwo.isShiny, true, "×4 avec deux parents shiny");
    assert.equal((await dbGet(points, "SELECT is_shiny FROM pokemon_owned WHERE origin = 'oeuf' AND is_shiny = 1")).is_shiny, 1);
  });

  it("un shiny qui naît est verrouillé d'office, un normal non", async () => {
    const egg = await incubate({ shinyParents: 2 });
    await withRandom(0, () => call(eggs.hatchEgg, egg.id));
    assert.equal((await babies())[0].locked, 1);
  });

  it("un crédit qui échoue remet l'œuf à couver : il éclora au prochain passage, rien n'est perdu", async () => {
    const egg = await incubate();
    await dbRun(points, `CREATE TRIGGER panne BEFORE INSERT ON pokemon_owned WHEN NEW.origin = 'oeuf' BEGIN SELECT RAISE(ABORT, 'panne'); END`);
    await assert.rejects(() => call(eggs.hatchEgg, egg.id), /panne/);
    await dbRun(points, "DROP TRIGGER panne");
    assert.equal((await eggsOf())[0].status, "INCUBATING");
    assert.equal((await babies()).length, 0);
    assert.ok(await call(eggs.hatchEgg, egg.id), "le passage suivant le fait naître");
    assert.equal((await babies()).length, 1);
  });
});

describe("le compteur de messages et le balayage", () => {
  const incubating = async (user = "u1") => {
    const father = await own("Pikachu", { sex: "M", user });
    const mother = await own("Pikachu", { sex: "F", user });
    await lay(parent(father), parent(mother), user);
    return (await eggsOf(user))[0];
  };

  it("chaque message de son propriétaire compte ; le dernier fait éclore, et l'annonce mentionne le dresseur", async () => {
    sandbox.writeConfig({ pokemon: { generation: 2, eggs: { hatchMessages: 3 } } });
    const egg = await incubating();
    const client = fakeClient();
    eggs.countEggMessage(client, "u1");
    eggs.countEggMessage(client, "u1");
    await sleep(80);
    assert.equal((await eggsOf())[0].messages, 2);
    assert.equal((await eggsOf())[0].status, "INCUBATING");
    eggs.countEggMessage(client, "u1");
    await sleep(200);
    assert.equal((await eggsOf())[0].status, "HATCHED");
    assert.equal((await babies()).length, 1);
    assert.equal(client.sent.length, 1);
    assert.equal(client.sent[0].content, "<@u1>");
    assert.match(JSON.stringify(client.sent[0].embeds[0].toJSON()), new RegExp(`<@u1> accueille \\*\\*Pichu`));
    assert.equal(egg.status, "INCUBATING");
  });

  it("les messages de quelqu'un qui ne couve pas ne touchent rien", async () => {
    await incubating();
    eggs.countEggMessage(fakeClient(), "u2");
    await sleep(60);
    assert.equal((await eggsOf())[0].messages, 0);
  });

  it("un œuf dont le délai est passé éclot au premier message, même loin du seuil", async () => {
    const egg = await incubating();
    await dbRun(points, "UPDATE pokemon_eggs SET hatch_at = ? WHERE id = ?", [Date.now() - 1, egg.id]);
    const client = fakeClient();
    eggs.countEggMessage(client, "u1");
    await sleep(200);
    assert.equal((await eggsOf())[0].status, "HATCHED");
  });

  it("des messages simultanés au seuil : un seul bébé", async () => {
    sandbox.writeConfig({ pokemon: { generation: 2, eggs: { hatchMessages: 1 } } });
    await incubating();
    const client = fakeClient();
    for (let index = 0; index < 5; index++) eggs.countEggMessage(client, "u1");
    await sleep(300);
    assert.equal((await babies()).length, 1);
    assert.equal(client.sent.length, 1);
  });

  it("le balayage fait éclore les œufs dont l'échéance est passée, et seulement eux", async () => {
    const due = await incubating("u1");
    await incubating("u2");
    await dbRun(points, "UPDATE pokemon_eggs SET hatch_at = ? WHERE id = ?", [Date.now() - 1000, due.id]);
    const client = fakeClient();
    eggs.hatchDueEggs(client);
    await sleep(300);
    assert.equal((await eggsOf("u1"))[0].status, "HATCHED");
    assert.equal((await eggsOf("u2"))[0].status, "INCUBATING");
    assert.equal(client.sent.length, 1);
  });

  it("un salon qui refuse l'annonce n'empêche pas le bébé de naître", async () => {
    const egg = await incubating();
    await dbRun(points, "UPDATE pokemon_eggs SET hatch_at = ? WHERE id = ?", [Date.now() - 1, egg.id]);
    const original = console.error;
    console.error = () => {};
    try {
      eggs.hatchDueEggs(fakeClient({ sendFails: true }));
      await sleep(300);
    } finally {
      console.error = original;
    }
    assert.equal((await babies()).length, 1);
  });
});

describe("l'affichage de l'œuf (buildEggEmbed)", () => {
  const egg = (extra = {}) => ({
    species_id: species("Pichu").id,
    father_species_id: species("Pikachu").id,
    mother_species_id: species("Raichu").id,
    messages: 150,
    hatch_messages: 200,
    hatch_at: Date.now() + 24 * HOUR,
    shiny_parents: 0,
    ...extra,
  });
  const text = (embed) => JSON.stringify(embed.toJSON());

  it("dit le bébé, les parents, l'échéance et les messages qui restent, au pluriel quand il faut", () => {
    const description = eggs.buildEggEmbed(egg()).toJSON().description;
    assert.match(description, /Un œuf de \*\*Pichu\*\*, pondu par \*\*Pikachu ♂\*\* et \*\*Raichu ♀\*\*/);
    assert.match(description, /<t:\d+:R>, ou dans \*\*50\*\* messages de ta part/);
    assert.match(eggs.buildEggEmbed(egg({ messages: 199 })).toJSON().description, /dans \*\*1\*\* message de ta part/);
    assert.match(eggs.buildEggEmbed(egg({ messages: 500 })).toJSON().description, /dans \*\*0\*\* message de ta part/, "jamais un nombre négatif");
  });

  it("annonce les chances de shiny des parents et du charme", () => {
    assert.match(text(eggs.buildEggEmbed(egg({ shiny_parents: 1 }))), /Un parent shiny : chances de shiny ×2/);
    assert.match(text(eggs.buildEggEmbed(egg({ shiny_parents: 2 }))), /Ses deux parents sont shiny : chances de shiny ×4/);
    assert.match(text(eggs.buildEggEmbed(egg(), { charm: 2 })), /Ton Charme Chroma : chances de shiny ×2\./);
    assert.match(text(eggs.buildEggEmbed(egg({ shiny_parents: 2 }), { charm: 2 })), /×2, ×8 en tout/);
    assert.doesNotMatch(text(eggs.buildEggEmbed(egg())), /shiny/);
  });

  it("un Métamorph parent s'affiche sans symbole de sexe", () => {
    const description = eggs.buildEggEmbed(egg({ mother_species_id: species("Métamorph").id })).toJSON().description;
    assert.match(description, /\*\*Métamorph\*\*/);
    assert.doesNotMatch(description, /Métamorph ♀/);
  });

  it("l'embed d'éclosion félicite le dresseur, et signale un shiny", () => {
    const normal = eggs.buildHatchEmbed({ egg: { user_id: "u1" }, species: species("Pichu"), isShiny: false, sex: "F" }).toJSON();
    assert.equal(normal.title, "🐣 Un œuf a éclos !");
    assert.match(normal.description, /<@u1> accueille \*\*Pichu ♀\*\* !$/);
    const shiny = eggs.buildHatchEmbed({ egg: { user_id: "u1" }, species: species("Pichu"), isShiny: true, sex: "M" }).toJSON();
    assert.match(shiny.description, /Et il brille… ✨/);
  });
});
