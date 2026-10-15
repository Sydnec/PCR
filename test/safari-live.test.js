// Le partage en direct d'une visite du parc safari : le bot publie la rencontre
// dans un salon, réécrit ce message à chaque action, puis le remplace par le
// bilan. Le message se suit par la base (salon, id, clôture), le journal des
// actions aussi : rien n'est gardé en mémoire que le minuteur de regroupement.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbGet, dbAll, withRandom, speciesByName, eventually } from "./helpers.js";

const sandbox = createSandbox({
  config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" }, safari: { liveRefreshMs: 0 } } },
});
process.env.POKEMON_CHANNEL_ID = "pk";
const { points } = await openDatabases();
const safari = await import("../modules/pokemon/safari.js");
const data = await import("../modules/pokemon/data.js");
const { getSafariConfig } = await import("../modules/pokemon/config.js");

const id = (name) => speciesByName(data.allSpecies, name).id;
const call = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value))));
const author = { displayName: "Sacha", avatarURL: "https://cdn.test/s.png" };
const row = () => dbGet(points, "SELECT * FROM pokemon_safari_sessions WHERE id = 1");
const events = () => dbAll(points, "SELECT * FROM pokemon_safari_events WHERE session_id = 1 ORDER BY id");

// Un salon qui note ce qu'on y publie et ce qu'on y réécrit ; `editFails` fait
// échouer les réécritures.
function fakeChannel({ sendFails = null, editFails = null } = {}) {
  const channel = {
    id: "c1",
    name: "pokemon",
    sent: [],
    edited: [],
    editFails,
    isTextBased: () => true,
    toString: () => "<#c1>",
    send: async (payload) => {
      if (sendFails) throw sendFails;
      channel.sent.push(payload);
      return { id: "m1" };
    },
    messages: {
      edit: async (messageId, payload) => {
        if (channel.editFails) throw channel.editFails;
        channel.edited.push({ messageId, payload });
      },
    },
  };
  return channel;
}
const fakeClient = (channel) => ({ channels: { fetch: async () => channel } });

async function seed({ species = "Bulbizarre", actions = 25, user = "u1", expiresAt = Date.now() + 3_600_000 } = {}) {
  for (const table of ["pokemon_safari_sessions", "pokemon_safari_events", "pokemon_safari_catches", "pokemon_owned"]) {
    await dbRun(points, `DELETE FROM ${table}`);
  }
  await dbRun(
    points,
    `INSERT INTO pokemon_safari_sessions
       (id, user_id, status, actions_left, started_at, expires_at, encounter_no,
        encounter_species_id, encounter_is_shiny, encounter_catch_rate, encounter_bait)
     VALUES (1, ?, 'ACTIVE', ?, 1, ?, 1, ?, 0, ?, 0)`,
    [user, actions, expiresAt, id(species), data.getSpecies(id(species)).catchRate]
  );
}
const play = async (action, random) => {
  const { actions_left } = await row();
  return withRandom(random, () => call(safari.playAction, "u1", 1, String(actions_left), action));
};
const goLive = (channel, user = "u1") => safari.startLiveShare(fakeClient(channel), user, 1, channel, author);
const embedOf = (payload) => payload.embeds[0].toJSON();

beforeEach(() => seed());

describe("le journal des actions", () => {
  it("note chaque action avec le Pokémon qu'elle visait, même quand il a détalé", async () => {
    await play("BAIT", 0.99);
    await play("FLEE", 0.99);
    const journal = await events();
    assert.deepEqual(journal.map((event) => event.outcome), ["BAIT", "FLED"]);
    assert.deepEqual(journal.map((event) => event.species_id), [id("Bulbizarre"), id("Bulbizarre")]);
    const recent = await call(safari.getRecentEvents, 1, 5);
    assert.equal(recent[0].outcome, "FLED", "la plus récente en tête");
  });

  it("un appât refusé au plafond ne s'écrit pas au journal", async () => {
    await dbRun(points, "UPDATE pokemon_safari_sessions SET encounter_bait = 2 WHERE id = 1");
    assert.equal((await play("BAIT", 0.99)).ok, false);
    assert.deepEqual(await events(), []);
  });
});

describe("mettre une visite en direct", () => {
  it("publie la rencontre une fois, et retient le message, la signature et le verrou", async () => {
    const channel = fakeChannel();
    const result = await goLive(channel);
    assert.equal(result.ok, true);
    assert.equal(channel.sent.length, 1);
    assert.deepEqual(channel.sent[0].allowedMentions, { parse: [] });
    assert.match(embedOf(channel.sent[0]).author.name, /Sacha/);
    const session = await row();
    assert.equal(session.live_channel_id, "c1");
    assert.equal(session.live_message_id, "m1");
    assert.deepEqual(JSON.parse(session.live_author), author);
    assert.notEqual(session.shared_at, null);
    assert.notEqual(result.session.shared_at, null, "la session rendue porte le verrou");

    const again = await goLive(channel);
    assert.equal(again.ok, false);
    assert.equal(again.shared, true);
    assert.match(again.reason, /déjà partagée/);
    assert.equal(channel.sent.length, 1);
  });

  it("une visite en direct ne repartage plus son bilan", async () => {
    await goLive(fakeChannel());
    await dbRun(points, "UPDATE pokemon_safari_sessions SET actions_left = 0, status = 'FINISHED' WHERE id = 1");
    const share = await call(safari.prepareShare, "u1", 1);
    assert.equal(share.ok, false);
    assert.match(share.reason, /déjà été partagé/);
  });

  it("la visite d'un autre, ou une visite finie, ne se met pas en direct", async () => {
    const channel = fakeChannel();
    const stolen = await goLive(channel, "intrus");
    assert.match(stolen.reason, /n'est pas la tienne/);
    await dbRun(points, "UPDATE pokemon_safari_sessions SET actions_left = 0, status = 'FINISHED' WHERE id = 1");
    const finished = await goLive(channel);
    assert.match(finished.reason, /terminée/);
    assert.equal(channel.sent.length, 0);
    assert.equal((await row()).shared_at, null);
  });

  it("un envoi qui échoue pour une raison prouvée rend le droit ; un échec incertain le garde", async () => {
    const proven = await goLive(fakeChannel({ sendFails: Object.assign(new Error("Missing Access"), { code: 50001 }) }));
    assert.equal(proven.ok, false);
    assert.match(proven.reason, /Tu peux réessayer/);
    assert.equal((await row()).shared_at, null);
    assert.equal((await row()).live_message_id, null);

    const uncertain = await goLive(fakeChannel({ sendFails: new Error("ECONNRESET") }));
    assert.equal(uncertain.shared, true);
    assert.match(uncertain.reason, /peut-être abouti/);
    assert.notEqual((await row()).shared_at, null, "republier deux fois serait pire");
  });

  it("depuis le site, dans le salon Pokémon ; sans salon, rien n'est consommé", async () => {
    const channel = fakeChannel();
    const ok = await safari.startLiveShareFromSite(fakeClient(channel), "u1", 1, author);
    assert.equal(ok.ok, true);
    assert.equal(channel.sent.length, 1);

    await seed();
    const missing = await safari.startLiveShareFromSite({ channels: { fetch: async () => null } }, "u1", 1, author);
    assert.match(missing.reason, /introuvable/);
    assert.equal((await row()).shared_at, null);
  });
});

describe("le message suit la visite", () => {
  it("chaque action le réécrit : actions restantes et dernière action", async () => {
    const channel = fakeChannel();
    await goLive(channel);
    await play("BAIT", 0.99);
    safari.refreshLiveShare(fakeClient(channel), 1);
    await eventually(() => {
      const embed = embedOf(channel.edited.at(-1).payload);
      assert.equal(embed.fields.find((field) => field.name === "Actions restantes").value, `**24** / ${getSafariConfig().actionsPerSession}`);
      assert.match(embed.fields.find((field) => field.name === "Dernières actions").value, /Appât lancé/);
    });
    assert.equal(channel.edited.at(-1).messageId, "m1");
  });

  it("se réécrit tout de suite, puis au plus une fois par intervalle, sans perdre la dernière action", async () => {
    sandbox.writeConfig({ pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" }, safari: { liveRefreshMs: 300 } } });
    try {
      const channel = fakeChannel();
      await goLive(channel);
      await eventually(() => assert.equal(channel.edited.length, 1), { timeout: 2000 });
      channel.edited.length = 0;
      await new Promise((resolve) => setTimeout(resolve, 350));

      const client = fakeClient(channel);
      await play("BAIT", 0.99);
      safari.refreshLiveShare(client, 1);
      await eventually(() => assert.equal(channel.edited.length, 1, "la première action se voit sans attendre"), { timeout: 100 });

      // Une salve : rien de plus avant la fin de l'intervalle, puis une seule
      // réécriture, qui montre la dernière action.
      await play("FLEE", 0.99);
      safari.refreshLiveShare(client, 1);
      await play("FLEE", 0.99);
      safari.refreshLiveShare(client, 1);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(channel.edited.length, 1);
      await eventually(() => assert.equal(channel.edited.length, 2), { timeout: 1000 });
      const embed = embedOf(channel.edited[1].payload);
      assert.equal(embed.fields.find((field) => field.name === "Actions restantes").value, `**22** / ${getSafariConfig().actionsPerSession}`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.equal(channel.edited.length, 2, "pas de réécriture en trop");
    } finally {
      sandbox.writeConfig({ pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" }, safari: { liveRefreshMs: 0 } } });
    }
  });

  it("la dernière action le remplace par le bilan public, puis il n'est plus réécrit", async () => {
    await seed({ actions: 1 });
    const channel = fakeChannel();
    await goLive(channel);
    await play("FLEE", 0.99);
    await safari.flushLiveShare(fakeClient(channel), 1);
    const embed = embedOf(channel.edited.at(-1).payload);
    assert.equal(embed.title, "🏕️ Fin de la visite");
    assert.match(embed.description, /\*\*Sacha\*\* ressort du parc/);
    assert.notEqual((await row()).live_closed_at, null);

    const edits = channel.edited.length;
    await safari.flushLiveShare(fakeClient(channel), 1);
    assert.equal(channel.edited.length, edits);
  });

  it("un bilan qui n'a pas pu s'écrire reste à faire ; un message supprimé n'est plus suivi", async () => {
    await seed({ actions: 1 });
    const channel = fakeChannel();
    await goLive(channel);
    await play("FLEE", 0.99);
    channel.editFails = new Error("ECONNRESET");
    await safari.flushLiveShare(fakeClient(channel), 1);
    assert.equal((await row()).live_closed_at, null, "le balayage réessaiera");

    channel.editFails = Object.assign(new Error("Unknown Message"), { code: 10008 });
    await safari.flushLiveShare(fakeClient(channel), 1);
    const session = await row();
    assert.notEqual(session.live_closed_at, null);
    assert.equal(session.live_message_id, null);
    assert.equal(session.shared_at, null, "le bilan redevient partageable");
    assert.equal((await call(safari.prepareShare, "u1", 1)).ok, true);
  });

  it("une réécriture lente ne repasse pas par-dessus le bilan", async () => {
    await seed({ actions: 1 });
    const channel = fakeChannel();
    await goLive(channel);
    channel.edited.length = 0;
    // La première réécriture a lu la rencontre avant la dernière action, et
    // n'aboutit qu'après la suivante — ou au bout d'une seconde, quand elles
    // passent l'une après l'autre et que la suivante l'attend.
    const edit = channel.messages.edit;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
      setTimeout(resolve, 1000);
    });
    let slow = true;
    channel.messages.edit = async (messageId, payload) => {
      if (slow) {
        slow = false;
        await gate;
        return edit(messageId, payload);
      }
      await edit(messageId, payload);
      if (embedOf(payload).title === "🏕️ Fin de la visite") release();
    };
    const first = safari.flushLiveShare(fakeClient(channel), 1);
    await play("FLEE", 0.99);
    await Promise.all([first, safari.flushLiveShare(fakeClient(channel), 1)]);
    assert.equal(embedOf(channel.edited.at(-1).payload).title, "🏕️ Fin de la visite");
  });

  it("le balayage pose le bilan sur une visite expirée en route", async () => {
    const channel = fakeChannel();
    await goLive(channel);
    await dbRun(points, "UPDATE pokemon_safari_sessions SET actions_left = 7, expires_at = ? WHERE id = 1", [Date.now() - 1]);
    await new Promise((resolve) => safari.sweepSafari(fakeClient(channel), resolve));
    const embed = embedOf(channel.edited.at(-1).payload);
    assert.equal(embed.title, "🏕️ Fin de la visite");
    assert.match(embed.description, /\*\*7\*\* actions jamais jouées/);
    const session = await row();
    assert.equal(session.status, "EXPIRED");
    assert.notEqual(session.live_closed_at, null);
  });
});
