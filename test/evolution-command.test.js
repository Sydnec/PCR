// /pk evolution : l'écran désigne l'individu reçu en échange quand il y en a un,
// et annonce l'évolution gratuite avant le clic.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, speciesByName } from "./helpers.js";
import { runCommand, payloadOf, textOf } from "./fake-discord.js";

createSandbox({ config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } } });
const { points } = await openDatabases();
const pk = (await import("../commands/pk.js")).default;
const data = await import("../modules/pokemon/data.js");
const machop = speciesByName(data.allSpecies, "Machopeur").id;
const evolution = (options = {}) => runCommand(pk, { sub: "evolution", options });
const give = async (origin, obtained) =>
  (await dbRun(
    points,
    `INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, sterile, obtained_at, locked)
     VALUES ('u1', ?, 0, 'M', ?, 0, ?, 0)`,
    [machop, origin, obtained]
  )).lastID;
const buttons = (reply) => reply.components.flatMap((row) => row.components.map((c) => c.data));

beforeEach(async () => {
  for (const table of ["points", "pokemon_owned"]) await dbRun(points, `DELETE FROM ${table}`);
});

describe("/pk evolution sans individu", () => {
  it("un reçu en échange est désigné : bouton gratuit sur son identifiant", async () => {
    await give("test", 9);
    const id = await give("echange", 1);
    const reply = payloadOf(await evolution({ espece: String(machop) }), "editReply");
    assert.match(textOf(reply), /reçu en échange : il évolue gratuitement/);
    assert.match(textOf(reply), /Reçu en échange : l'évolution est \*\*gratuite\*\*/);
    const [button] = buttons(reply);
    assert.match(button.label, /gratuit/);
    assert.equal(button.custom_id, `poke_evo|${machop}|#${id}|random`);
  });

  it("sans reçu en échange, le bot choisit au clic et l'évolution se paie", async () => {
    for (const obtained of [1, 5, 9]) await give("test", obtained);
    const reply = payloadOf(await evolution({ espece: String(machop) }), "editReply");
    assert.doesNotMatch(textOf(reply), /reçu en échange/i);
    assert.match(textOf(reply), /Le bot choisit/);
  });
});
