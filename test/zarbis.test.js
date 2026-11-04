// /pk zarbis : les lettres de Zarbi réunies, avec leur nombre et leurs shiny, et celles
// qui manquent, sur les formes de la génération ouverte. Et devant un Zarbi — apparu, au
// bout de la ligne ou au parc safari —, si sa lettre est déjà dans la boîte, sur Discord
// comme sur le site.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { createSandbox, openDatabases, dbRun, eventually } from "./helpers.js";
import { fakeUser, payloadOf, runCommand } from "./fake-discord.js";

const GEN1 = { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } };
const GEN2 = { pokemon: { generation: 2 } };
const sandbox = createSandbox({ config: GEN2 });
const { points } = await openDatabases();
const pk = (await import("../commands/pk.js")).default;
const data = await import("../modules/pokemon/data.js");
const embeds = await import("../modules/pokemon/embeds.js");
const safari = await import("../modules/pokemon/safari.js");
const { handlePokemonButton } = await import("../modules/pokemon/interactions.js");
const { routes } = await import("../modules/web/api.js");

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

const call = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (err, value) => (err ? reject(err) : resolve(value))));
const api = (method, path, user = "u1") =>
  routes
    .find((entry) => entry.method === method && entry.path === path)
    .handler({ user: { id: user }, body: {}, params: {}, query: {}, bot: null });

const spawnZarbi = async (form, speciesId = unown.id) =>
  (
    await dbRun(
      points,
      `INSERT INTO pokemon_spawns (species_id, is_shiny, catch_rate, rarity, status, spawned_at, flees_at, sex, charm_shiny, form)
       VALUES (?, 0, 225, 'COMMUN', 'ACTIVE', ?, 9999999999999, NULL, 0, ?)`,
      [speciesId, Date.now(), form]
    )
  ).lastID;
const parkZarbi = (form, user = "u1") =>
  dbRun(
    points,
    `INSERT INTO pokemon_safari_sessions
       (user_id, status, actions_left, started_at, expires_at, encounter_no,
        encounter_species_id, encounter_is_shiny, encounter_catch_rate, encounter_bait, encounter_form)
     VALUES (?, 'ACTIVE', 20, 1, ?, 1, ?, 0, 225, 0, ?)`,
    [user, Date.now() + 3_600_000, unown.id, form]
  );

// Le bouton « Infos du Pokémon » d'une apparition : la fiche privée qu'il répond.
async function infoCard(spawnId, user = "u1") {
  const replies = [];
  handlePokemonButton({
    customId: `poke_owned|${spawnId}`,
    user: fakeUser(user),
    reply: async (payload) => replies.push(payload),
  });
  await eventually(() => assert.equal(replies.length, 1));
  return replies[0].embeds[0].toJSON();
}

beforeEach(async () => {
  sandbox.writeConfig(GEN2);
  for (const table of ["pokemon_owned", "pokemon_spawns", "pokemon_safari_sessions"]) {
    await dbRun(points, `DELETE FROM ${table}`);
  }
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

describe("la lettre du Zarbi en face", () => {
  const known = () => data.speciesForms(unown).length;

  it("« Infos du Pokémon » dit si la lettre de l'apparition manque, puis si on l'a, même en shiny", async () => {
    await own("a");
    const id = await spawnZarbi("b");
    assert.equal(field(await infoCard(id), "Formes"), `🆕 Le Zarbi B te manque !\n**1**/${known()} : A`);
    await own("b", { shiny: 1 });
    assert.equal(field(await infoCard(id), "Formes"), `✅ Tu as déjà le Zarbi B\n**2**/${known()} : A B`);
    assert.equal(field(await infoCard(id, "u2"), "Formes"), `🆕 Le Zarbi B te manque !\n**0**/${known()}`, "la collection de celui qui clique");
  });

  it("/pk info parle de l'espèce : la ligne « Formes » n'y vise aucune lettre", () => {
    const card = embeds.buildSpeciesInfoEmbed(unown, { forms: new Set(["a"]) }).toJSON();
    assert.equal(field(card, "Formes"), `**1**/${known()} : A`);
  });

  it("une lecture ratée des formes omet la ligne, plutôt que d'annoncer qu'il manque", async () => {
    await own("b");
    const id = await spawnZarbi("b");
    await parkZarbi("b");
    const original = points.all;
    points.all = function (sql, ...rest) {
      if (/SELECT DISTINCT form/.test(sql)) return rest.at(-1)(new Error("panne de lecture"));
      return original.call(this, sql, ...rest);
    };
    try {
      assert.equal(field(await infoCard(id), "Formes"), undefined);
      const { spawn } = await api("GET", "/api/spawn");
      assert.equal(spawn.forms, null);
      assert.equal(spawn.owned.normal, 1, "le reste de la fiche est là");
      const ongoing = await call(safari.resumeSession, "u1");
      assert.equal(ongoing.forms, null);
      assert.equal(field(embeds.buildSafariView(ongoing.session, ongoing).embeds[0].toJSON(), "Formes"), undefined);
    } finally {
      points.all = original;
    }
  });

  it("le site donne les formes de l'apparition avec ce qu'on en a, rien pour une espèce sans formes", async () => {
    await own("b");
    await own("c", { user: "u2" });
    await spawnZarbi("b");
    const { spawn } = await api("GET", "/api/spawn");
    assert.equal(spawn.form.key, "b");
    assert.equal(spawn.forms.length, known());
    assert.deepEqual(spawn.forms.filter((form) => form.owned).map((form) => form.key), ["b"]);
    await dbRun(points, "DELETE FROM pokemon_spawns");
    await spawnZarbi(null, data.allSpecies().find((entry) => entry.name === "Rattata").id);
    assert.equal((await api("GET", "/api/spawn")).spawn.forms, null);
  });

  it("au parc safari, la rencontre dit si sa lettre manque : en privé, en direct et sur le site", async () => {
    await own("a");
    await parkZarbi("b");
    const ongoing = await call(safari.resumeSession, "u1");
    assert.deepEqual([...ongoing.forms], ["a"]);
    const view = embeds.buildSafariView(ongoing.session, ongoing).embeds[0].toJSON();
    assert.equal(field(view, "Formes"), `🆕 Le Zarbi B te manque !\n**1**/${known()}`);
    const live = embeds.buildSafariLiveView(ongoing.session, ongoing).embeds[0].toJSON();
    assert.equal(field(live, "Formes"), `🆕 Le Zarbi B lui manque !\n**1**/${known()}`);
    const { visit } = await api("GET", "/api/safari");
    assert.equal(visit.encounter.form.key, "b");
    assert.equal(visit.encounter.forms.find((form) => form.key === "b").owned, false);

    await own("b");
    const again = await call(safari.resumeSession, "u1");
    assert.equal(field(embeds.buildSafariView(again.session, again).embeds[0].toJSON(), "Formes"), `✅ Tu as déjà le Zarbi B\n**2**/${known()}`);
    assert.equal(field(embeds.buildSafariLiveView(again.session, again).embeds[0].toJSON(), "Formes"), `✅ Le Zarbi B est déjà dans sa boîte\n**2**/${known()}`);
    assert.equal((await api("GET", "/api/safari")).visit.encounter.forms.find((form) => form.key === "b").owned, true);
  });
});
