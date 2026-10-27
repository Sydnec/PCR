// Les filtres de /pk pokedex : les mêmes que ceux du site, choisis dans la réponse (menus
// et bascules) et portés par le customId, sans rien garder en mémoire.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, eventually, untilQuiet, speciesByName } from "./helpers.js";
import { payloadOf, runCommand } from "./fake-discord.js";

const GEN1 = { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } };
const GEN2 = { pokemon: { generation: 2 } };
const sandbox = createSandbox({ config: GEN2 });
const { points } = await openDatabases();
const pk = (await import("../commands/pk.js")).default;
const { handlePokemonButton, handlePokemonSelect } = await import("../modules/pokemon/interactions.js");
const dex = await import("../modules/pokemon/dex-filter.js");
const data = await import("../modules/pokemon/data.js");
const { getCollection } = await import("../modules/pokemon/collection.js");
const { buildDexComponents, collectionStats } = await import("../modules/pokemon/embeds.js");

const species = (name) => speciesByName(data.allSpecies, name);
const own = (name, { user = "u1", shiny = 0 } = {}) =>
  dbRun(points, "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at) VALUES (?, ?, ?, 'M', 'test', 1)", [user, species(name).id, shiny]);
const rowsOf = (user = "u1") => new Promise((resolve, reject) => getCollection(user, (err, rows) => (err ? reject(err) : resolve(rows))));
const ownedOf = async (user = "u1") => collectionStats(await rowsOf(user)).owned;
const idsOf = (list) => list.map((entry) => entry.id);

async function click(customId, { values, run = handlePokemonButton } = {}) {
  const calls = [];
  const interaction = {
    customId,
    values,
    user: { id: "u1", username: "user-u1" },
    client: { users: { fetch: async (id) => ({ id, username: `user-${id}` }) } },
    update: async (payload) => calls.push({ method: "update", payload }),
    reply: async (payload) => calls.push({ method: "reply", payload }),
  };
  await run(interaction);
  // Le Pokédex relit la collection avant de répondre : sous charge, c'est plus long que
  // le court silence qu'attend untilQuiet avant sa première réponse.
  await eventually(() => assert.ok(calls.length > 0, `${customId} n'a pas répondu`));
  await untilQuiet(calls);
  return payloadOf(calls, "update");
}
const select = (customId, value) => click(customId, { values: [value], run: handlePokemonSelect });
const flat = (payload) => payload.components.flatMap((row) => row.toJSON().components);
const embedText = (payload) => JSON.stringify(payload.embeds[0].toJSON());

beforeEach(async () => {
  sandbox.writeConfig(GEN2);
  await dbRun(points, "DELETE FROM pokemon_owned");
});

describe("les filtres (filterDexSpecies)", () => {
  it("rareté, génération, type et obtention se lisent avec les fonctions du site", async () => {
    const all = data.allSpecies();
    const owned = await ownedOf();
    assert.deepEqual(idsOf(dex.filterDexSpecies({ r: "LEGENDAIRE" }, owned)), idsOf(all.filter((entry) => data.rarityOf(entry) === "LEGENDAIRE")));
    assert.deepEqual(idsOf(dex.filterDexSpecies({ g: "2" }, owned)), idsOf(all.filter((entry) => entry.generation === 2)));
    assert.deepEqual(idsOf(dex.filterDexSpecies({ t: "Feu", g: "1" }, owned)), idsOf(all.filter((entry) => entry.types.includes("Feu") && entry.generation === 1)));
    assert.deepEqual(idsOf(dex.filterDexSpecies({ o: "egg" }, owned)), idsOf(all.filter((entry) => data.obtentionOf(entry) === "egg")));
    assert.ok(dex.filterDexSpecies({ o: "egg" }, owned).length > 0, "la 2ᵉ génération a des bébés");
  });

  it("possédées, manquantes et shiny d'après la collection", async () => {
    await own("Rattata");
    await own("Roucool", { shiny: 1 });
    const owned = await ownedOf();
    assert.deepEqual(idsOf(dex.filterDexSpecies({ v: "owned" }, owned)), [species("Roucool").id, species("Rattata").id].sort((a, b) => a - b));
    assert.equal(dex.filterDexSpecies({ v: "missing" }, owned).length, data.allSpecies().length - 2);
    assert.deepEqual(idsOf(dex.filterDexSpecies({ s: "1" }, owned)), [species("Roucool").id]);
    assert.ok(!idsOf(dex.filterDexSpecies({ s: "0", v: "owned" }, owned)).includes(species("Roucool").id));
  });

  it("un code abîmé ou périmé ne filtre pas ce qu'il ne connaît pas", () => {
    assert.deepEqual(dex.decodeDexFilters("r:FAUX,g:9,t:Feu,x:1,o"), { t: "Feu" });
    assert.deepEqual(dex.decodeDexFilters(dex.encodeDexFilters({ r: "RARE", g: "2", s: "0" })), { r: "RARE", g: "2", s: "0" });
    sandbox.writeConfig(GEN1);
    assert.deepEqual(dex.decodeDexFilters("g:2,r:RARE"), { r: "RARE" }, "une génération refermée ne filtre plus");
  });
});

describe("la réponse de /pk pokedex", () => {
  it("porte les menus de filtres : rareté, génération, type, obtention, et deux bascules", async () => {
    const reply = payloadOf(await runCommand(pk, { sub: "pokedex" }), "editReply");
    assert.equal(reply.components.length, 5);
    const ids = flat(reply).map((component) => component.custom_id.split("|")[0]);
    assert.deepEqual(ids, ["poke_dexf", "poke_dex_noop", "poke_dexf", "poke_dext", "poke_dext", "poke_dexs", "poke_dexs", "poke_dexs", "poke_dexs"]);
    sandbox.writeConfig(GEN1);
    const gen1 = payloadOf(await runCommand(pk, { sub: "pokedex" }), "editReply");
    assert.equal(gen1.components.length, 4, "une seule génération ouverte : pas de menu de génération");
  });

  it("aucun customId ne dépasse les 100 caractères de Discord, même tous filtres posés", () => {
    const filters = { r: "PEU_COMMUN", g: "2", t: "Électrik", o: "evolution", v: "missing", s: "0" };
    const longest = Math.max(...buildDexComponents("1".repeat(20), [], 99, filters).flatMap((row) => row.toJSON().components).map((component) => component.custom_id.length));
    assert.ok(longest <= 100, String(longest));
  });

  it("un menu filtre et revient à la première page ; les boutons de page gardent le filtre", async () => {
    await own("Rattata");
    const legend = await select("poke_dexs|u1|g:2|r", "LEGENDAIRE");
    const count = dex.filterDexSpecies({ r: "LEGENDAIRE", g: "2" }, await ownedOf()).length;
    assert.match(embedText(legend), new RegExp(`🔎 Légendaire · 2ᵉ génération : \\*\\*${count}\\*\\* espèces, dont \\*\\*0\\*\\* possédée`));
    const [prev] = flat(legend);
    assert.equal(prev.custom_id, "poke_dexf|u1|r:LEGENDAIRE,g:2|0|prev");
    const rarity = legend.components[1].toJSON().components[0];
    assert.equal(rarity.options.find((option) => option.default).value, "LEGENDAIRE");
    const cleared = await select("poke_dexs|u1|r:LEGENDAIRE,g:2|r", "all");
    assert.match(flat(cleared)[0].custom_id, /^poke_dexf\|u1\|g:2\|\d+\|prev$/);
    assert.match(flat(cleared)[1].label, /^1\//, "de retour à la première page");
  });

  it("la bascule passe de « toutes » à possédées, à manquantes, puis revient", async () => {
    await own("Rattata");
    const owned = await click("poke_dext|u1||v");
    assert.match(embedText(owned), /Possédées : \*\*1\*\* espèce, dont \*\*1\*\* possédée/);
    assert.equal(flat(owned)[3].label, "Possédées");
    const missing = await click(flat(owned)[3].custom_id);
    assert.equal(flat(missing)[3].label, "Manquantes");
    const back = await click(flat(missing)[3].custom_id);
    assert.equal(flat(back)[3].label, "Possédées ou non");
    assert.doesNotMatch(embedText(back), /🔎/);
  });

  it("rien ne correspond : la page le dit ; une page trop loin revient dans les bornes", async () => {
    const empty = await click("poke_dexf|u1|v:owned|0|next");
    assert.match(embedText(empty), /Aucune espèce ne correspond à ces filtres/);
    const far = await click("poke_dexf|u1|g:2|99|next");
    const label = flat(far)[1].label;
    const [current, pages] = label.split("/").map(Number);
    assert.equal(current, pages, "ramenée à la dernière page");
  });
});
