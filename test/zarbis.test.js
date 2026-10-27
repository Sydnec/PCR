// /pk zarbis : les lettres de Zarbi réunies, avec leur nombre et leurs shiny, et celles
// qui manquent, sur les formes de la génération ouverte.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { createSandbox, openDatabases, dbRun } from "./helpers.js";
import { fakeUser, payloadOf, runCommand } from "./fake-discord.js";

const GEN1 = { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } };
const GEN2 = { pokemon: { generation: 2 } };
const sandbox = createSandbox({ config: GEN2 });
const { points } = await openDatabases();
const pk = (await import("../commands/pk.js")).default;
const data = await import("../modules/pokemon/data.js");

const unown = data.unownSpecies();
const own = (form, { user = "u1", shiny = 0, speciesId = unown.id } = {}) =>
  dbRun(
    points,
    "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at, form) VALUES (?, ?, ?, NULL, 'test', 1, ?)",
    [user, speciesId, shiny, form]
  );
const zarbis = (users = {}) => runCommand(pk, { sub: "zarbis", users });
const embedOf = (calls) => payloadOf(calls, "editReply").embeds[0].toJSON();
const field = (embed, name) => embed.fields.find((entry) => entry.name === name)?.value;

beforeEach(async () => {
  sandbox.writeConfig(GEN2);
  await dbRun(points, "DELETE FROM pokemon_owned");
});

describe("/pk zarbis", () => {
  it("répond en privé : les lettres réunies avec leur nombre et leurs shiny, puis celles qui manquent", async () => {
    await own("a");
    await own("a");
    await own("b", { shiny: 1 });
    await own("c", { user: "u2" });
    const calls = await zarbis();
    assert.equal(payloadOf(calls, "deferReply").flags, MessageFlags.Ephemeral);
    const embed = embedOf(calls);
    const known = data.speciesForms(unown).length;
    assert.match(embed.title, /Zarbi de user-u1/);
    assert.match(embed.description, new RegExp(`\\*\\*2\\*\\* / ${known} formes \\(${Math.round((2 / known) * 100)} %\\) · ✨ 1 en shiny`));
    assert.equal(field(embed, "Réunies"), "**A** ×2 · **B** ✨");
    const missing = field(embed, "Manquantes").split(" ");
    assert.equal(missing.length, known - 2);
    assert.ok(missing.includes("C"), "la lettre d'un autre dresseur ne compte pas");
    assert.ok(!missing.includes("A") && !missing.includes("B"));
  });

  it("sans Zarbi, rien de réuni ; l'option membre montre un autre dresseur", async () => {
    await own("c", { user: "u2" });
    assert.equal(field(embedOf(await zarbis()), "Réunies"), "Aucune pour l'instant.");
    const other = embedOf(await zarbis({ membre: fakeUser("u2") }));
    assert.match(other.title, /Zarbi de user-u2/);
    assert.equal(field(other, "Réunies"), "**C**");
  });

  it("l'alphabet complet se dit", async () => {
    for (const form of data.speciesForms(unown)) await own(form.key);
    assert.match(field(embedOf(await zarbis()), "Manquantes"), /l'alphabet est complet/);
  });

  it("génération fermée : refus privé, qui dit quand il arrive", async () => {
    sandbox.writeConfig(GEN1);
    const reply = payloadOf(await zarbis(), "reply");
    assert.equal(reply.flags, MessageFlags.Ephemeral);
    assert.equal(reply.content, `❌ Zarbi n'est pas encore dans le Pokédex : il arrive avec la ${unown.generation}ᵉ génération.`);
  });
});
