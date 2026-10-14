// /pk pecher : lancer sa ligne, retrouver sa touche, les refus avec leurs chiffres.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { createSandbox, openDatabases, dbRun, dbAll, withRandom } from "./helpers.js";
import { runCommand, runAutocomplete, payloadOf, textOf } from "./fake-discord.js";

createSandbox({ config: { pokemon: { generationOpenings: { 2: "2000-01-01T00:00:00+01:00" } } } });
process.env.POKEMON_CHANNEL_ID = "123";
const { points } = await openDatabases();
const pk = (await import("../commands/pk.js")).default;
const { handlePokemonButton } = await import("../modules/pokemon/interactions.js");
const items = await import("../modules/pokemon/items.js");

const fish = (options = {}) => withRandom([0.5], () => runCommand(pk, { sub: "pecher", options }));
const setBalance = (amount) =>
  dbRun(points, "INSERT INTO points (user_id, balance) VALUES ('u1', ?) ON CONFLICT(user_id) DO UPDATE SET balance = ?", [amount, amount]);
const balance = async () => (await dbAll(points, "SELECT balance FROM points WHERE user_id = 'u1'"))[0]?.balance ?? 0;
const buttonIds = (payload) => payload.components.flatMap((row) => row.toJSON().components.map((button) => button.custom_id));

beforeEach(async () => {
  for (const table of ["points", "pokemon_inventory", "pokemon_item_log", "pokemon_spawns", "pokemon_throws", "pokemon_owned", "points_log"]) {
    await dbRun(points, `DELETE FROM ${table}`);
  }
});

describe("/pk pecher", () => {
  it("lancer la ligne : une touche privée avec l'embed et les balls du panneau, le prix de la canne débité", async () => {
    await setBalance(500);
    const reply = payloadOf(await fish({ canne: "canne" }), "reply");
    assert.equal(reply.flags, MessageFlags.Ephemeral, "personne d'autre ne la voit");
    assert.match(reply.content, /Ça mord ! \(\*\*-50\*\* points, Canne\)/);
    assert.match(reply.content, /Il s'enfuit dans \*\*\d+ s\*\*/);
    assert.match(textOf(reply), /sauvage apparaît/);
    const [row] = await dbAll(points, "SELECT id, status, reserved_for FROM pokemon_spawns");
    assert.deepEqual([row.status, row.reserved_for], ["FISHING", "u1"]);
    assert.deepEqual(buttonIds(reply).slice(0, 3), [`poke_rethrow|${row.id}|poke`, `poke_rethrow|${row.id}|super`, `poke_rethrow|${row.id}|hyper`]);
    assert.equal(await balance(), 450);
  });

  it("les balls du panneau lancent sur la touche, et seul le pêcheur le peut", async () => {
    await setBalance(5000);
    await fish({ canne: "canne" });
    const [{ id }] = await dbAll(points, "SELECT id FROM pokemon_spawns");
    await dbRun(points, "UPDATE pokemon_spawns SET catch_rate = 255 WHERE id = ?", [id]);
    const press = async (user) => {
      const calls = [];
      const interaction = {
        customId: `poke_rethrow|${id}|poke`,
        user: { id: user, username: user },
        webhook: { deleteMessage: async () => {} },
        client: { channels: { fetch: async () => { throw new Error("pas de Discord"); } } },
        deferUpdate: async () => {},
        update: async (payload) => calls.push(payload),
        editReply: async (payload) => calls.push(payload),
        reply: async (payload) => calls.push(payload),
      };
      await withRandom([0], () => handlePokemonButton(interaction));
      for (let waited = 0; waited < 3000 && !calls.length; waited += 15) await new Promise((resolve) => setTimeout(resolve, 15));
      return calls.at(-1);
    };
    assert.match((await press("u2")).content, /pas pour toi/);
    assert.match((await press("u1")).content, /Bravo/);
    assert.equal((await dbAll(points, "SELECT status FROM pokemon_spawns"))[0].status, "CAUGHT");
  });

  it("une touche déjà là est remise sous les yeux, sans nouveau débit", async () => {
    await setBalance(500);
    await fish({ canne: "canne" });
    const again = payloadOf(await fish({ canne: "canne" }), "reply");
    assert.match(again.content, /Tu as déjà une touche au bout de ta ligne/);
    assert.ok(buttonIds(again)[0].startsWith("poke_rethrow|"), "ses boutons sont là, elle ne se perd pas");
    assert.equal(await balance(), 450);
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_spawns")).length, 1);
  });

  it("les refus donnent les chiffres et ne débitent rien", async () => {
    await setBalance(30);
    assert.match(payloadOf(await fish({ canne: "canne" }), "reply").content, /La Canne pêche à 50 points, tu en as 30/);
    assert.match(payloadOf(await fish({ canne: "mega_canne" }), "reply").content, /Tu n'as pas de Méga Canne/);
    assert.match(payloadOf(await fish({ canne: "n'importe quoi" }), "reply").content, /Choisis une canne/);
    assert.equal(await balance(), 30);
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_spawns")).length, 0);
  });

  it("sans option : les cannes, ce qu'on possède, et le rappel d'une touche en cours", async () => {
    await setBalance(500);
    const list = payloadOf(await fish(), "reply");
    assert.match(list.content, /Canne.*50 points.*✅ tu l'as/s);
    assert.match(list.content, /Super Canne.*100 points.*🔒/s);
    assert.match(list.content, /Méga Canne.*200 points/s);
    assert.doesNotMatch(list.content, /Une touche t'attend/);
    await fish({ canne: "canne" });
    assert.match(payloadOf(await fish(), "reply").content, /Une touche t'attend/);
  });

  it("l'autocomplétion ne propose que les cannes qu'on a, avec leur prix", async () => {
    const own = payloadOf(await runAutocomplete(pk, { sub: "pecher", focused: { name: "canne", value: "" } }), "respond");
    assert.deepEqual(own.map((choice) => choice.value), ["canne"]);
    assert.match(own[0].name, /Canne — 50 points/);
    await items.grantItem("u1", "super_canne", 1, { source: "test" }, () => {});
    await new Promise((resolve) => setTimeout(resolve, 80));
    const more = payloadOf(await runAutocomplete(pk, { sub: "pecher", focused: { name: "canne", value: "" } }), "respond");
    assert.deepEqual(more.map((choice) => choice.value), ["canne", "super_canne"]);
    const none = payloadOf(await runAutocomplete(pk, { sub: "pecher", focused: { name: "canne", value: "zzz" } }), "respond");
    assert.match(none[0].name, /Aucune canne ne correspond/);
  });
});
