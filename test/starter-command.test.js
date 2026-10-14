// /pk starter : le statut, l'autocomplétion, la confirmation, et le bouton qui
// donne le starter. Ce que font le choix et les paliers est dans starters.test.js.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { createSandbox, openDatabases, dbRun, dbAll, eventually } from "./helpers.js";
import { runCommand, runAutocomplete, payloadOf } from "./fake-discord.js";

createSandbox({ config: { pokemon: { generationOpenings: { 2: "2000-01-01T00:00:00+01:00" } } } });
process.env.POKEMON_CHANNEL_ID = "123";
const { points } = await openDatabases();
const pk = (await import("../commands/pk.js")).default;
const { handlePokemonButton } = await import("../modules/pokemon/interactions.js");
const { buildGenerationEmbed } = await import("../modules/pokemon/generations.js");

const EPHEMERAL = MessageFlags.Ephemeral;
const starter = (options = {}) => runCommand(pk, { sub: "starter", options });
const owned = (user = "u1") => dbAll(points, "SELECT species_id, origin FROM pokemon_owned WHERE user_id = ?", [user]);

async function press(customId, user = "u1") {
  const calls = [];
  const interaction = {
    customId,
    user: { id: user, username: user },
    update: async (payload) => calls.push(payload),
    reply: async (payload) => calls.push(payload),
  };
  await handlePokemonButton(interaction);
  await eventually(() => assert.ok(calls.length > 0, "le bouton répond"));
  return calls;
}

beforeEach(async () => {
  for (const table of ["pokemon_owned", "pokemon_starters", "pokemon_starter_rewards"]) await dbRun(points, `DELETE FROM ${table}`);
});

describe("/pk starter", () => {
  it("sans option : les trois starters à choisir, en privé", async () => {
    const reply = payloadOf(await starter(), "reply");
    assert.equal(reply.flags, EPHEMERAL);
    assert.match(reply.content, /2e génération.*à choisir : \*\*Germignon\*\*, \*\*Héricendre\*\*, \*\*Kaiminus\*\*/s);
    assert.match(reply.content, /le choix est définitif/);
  });

  it("avec un starter : une confirmation, sans rien donner avant le clic", async () => {
    const reply = payloadOf(await starter({ pokemon: "155" }), "reply");
    assert.match(reply.content, /Tu choisis \*\*Héricendre\*\* comme starter de la 2e génération.*définitif/s);
    const ids = reply.components[0].toJSON().components.map((button) => button.custom_id);
    assert.deepEqual(ids, ["poke_starter_ok|155", "poke_starter_no"]);
    assert.deepEqual(await owned(), []);
  });

  it("le bouton donne le starter et le dit ; un second clic est refusé avec le choix déjà fait", async () => {
    const [done] = await press("poke_starter_ok|155");
    assert.match(done.content, /✅ \*\*Héricendre\*\* rejoint ta boîte/);
    assert.deepEqual(done.components, []);
    assert.deepEqual(await owned(), [{ species_id: 155, origin: "starter" }]);
    const [again] = await press("poke_starter_ok|158");
    assert.match(again.content, /Tu as déjà choisi \*\*Héricendre\*\*/);
    assert.equal((await owned()).length, 1);
  });

  it("annuler ne donne rien et laisse le choix ouvert", async () => {
    const [cancelled] = await press("poke_starter_no");
    assert.match(cancelled.content, /Choix annulé/);
    assert.deepEqual(await owned(), []);
  });

  it("une valeur tapée à la main ou un starter déjà choisi est refusé en privé", async () => {
    const typed = payloadOf(await starter({ pokemon: "25" }), "reply");
    assert.match(typed.content, /Choisis un starter dans la liste d'autocomplétion/);
    assert.equal(typed.flags, EPHEMERAL);
    await press("poke_starter_ok|152");
    const chosen = payloadOf(await starter({ pokemon: "158" }), "reply");
    assert.match(chosen.content, /Tu as déjà choisi \*\*Germignon\*\*.*définitif/s);
    assert.deepEqual((await press("poke_starter_ok|25"))[0].content, "❌ Ce starter n'est plus proposé.");
  });

  it("après le choix : le statut montre la progression et les paliers", async () => {
    await press("poke_starter_ok|152");
    const reply = payloadOf(await starter(), "reply");
    assert.match(reply.content, /ton starter : \*\*Germignon\*\*/);
    assert.match(reply.content, /Pokédex de la génération, hors légendaires/);
    assert.match(reply.content, /\*\*33 %\*\* : Macronium/);
    assert.match(reply.content, /\*\*66 %\*\* : Méganium/);
    assert.match(reply.content, /\*\*100 %\*\* : Germignon ✨/);
  });

  it("l'autocomplétion propose les starters pas encore choisis, et le dit quand il n'y en a plus", async () => {
    const all = payloadOf(await runAutocomplete(pk, { sub: "starter", focused: { name: "pokemon", value: "" } }), "respond");
    assert.deepEqual(all.map((choice) => choice.value), ["152", "155", "158"]);
    assert.match(all[0].name, /Germignon — 2e génération/);
    const some = payloadOf(await runAutocomplete(pk, { sub: "starter", focused: { name: "pokemon", value: "kai" } }), "respond");
    assert.deepEqual(some.map((choice) => choice.value), ["158"]);
    await press("poke_starter_ok|152");
    const none = payloadOf(await runAutocomplete(pk, { sub: "starter", focused: { name: "pokemon", value: "" } }), "respond");
    assert.match(none[0].name, /Aucun starter à choisir/);
  });

  it("l'annonce de la génération 2 présente le choix", () => {
    const text = buildGenerationEmbed(2).toJSON().description;
    assert.match(text, /\/pk starter/);
    assert.match(text, /Germignon, Héricendre et Kaiminus/);
    assert.doesNotMatch(buildGenerationEmbed(1).toJSON().description ?? "", /\/pk starter/);
  });
});
