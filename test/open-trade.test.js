// L'offre ouverte à tous : /pk echange sans membre. Le premier qui accepte l'emporte,
// chacun peut contre-proposer à l'auteur, et une contre-offre acceptée ferme l'offre
// ouverte. Un refus qui ne tient qu'à celui qui accepte la laisse ouverte aux autres.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { createSandbox, openDatabases, dbRun, dbAll, dbGet, eventually, untilQuiet, speciesByName } from "./helpers.js";
import { fakeChannel, fakeUser, payloadOf, runAutocomplete, runCommand } from "./fake-discord.js";

createSandbox({ config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } } });
const { points } = await openDatabases();
const pk = (await import("../commands/pk.js")).default;
const { handlePokemonButton, handlePokemonModal } = await import("../modules/pokemon/interactions.js");
const items = await import("../modules/pokemon/items.js");
const collection = await import("../modules/pokemon/collection.js");
const data = await import("../modules/pokemon/data.js");

const species = (name) => speciesByName(data.allSpecies, name);
const call = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value))));
const grant = (key, quantity, user) => call(items.grantItem, user, key, quantity, { source: "test" });
const stock = (user, key) => call(items.getItemCount, user, key);
const setBalance = (amount, user) =>
  dbRun(points, "INSERT INTO points (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = ?", [user, amount, amount]);
const balanceOf = async (user) => (await dbGet(points, "SELECT balance FROM points WHERE user_id = ?", [user]))?.balance ?? 0;
const trades = () => dbAll(points, "SELECT * FROM pokemon_trades ORDER BY id");
const tradeRow = (id) => dbGet(points, "SELECT * FROM pokemon_trades WHERE id = ?", [id]);
const drafts = () => dbAll(points, "SELECT * FROM pokemon_trade_drafts ORDER BY id");

const BONBON = "super_bonbon";
const thing = (key, quantity = null) => (quantity === null ? `item:${key}` : `item:${key}:${quantity}`);
const offer = (options, extra = {}) => runCommand(pk, { sub: "echange", options, users: {}, ...extra });

async function interact(customId, { kind = "button", user, channel = fakeChannel(), fields = {} } = {}) {
  const calls = [];
  const record = (method) => async (payload) => {
    calls.push({ method, payload });
  };
  const interaction = {
    customId,
    user: fakeUser(user),
    channel,
    channelId: channel.id,
    client: { channels: { fetch: async () => channel } },
    fields: { getTextInputValue: (id) => fields[id] ?? "" },
    isFromMessage: () => true,
  };
  for (const method of ["reply", "update", "showModal"]) interaction[method] = record(method);
  await (kind === "modal" ? handlePokemonModal : handlePokemonButton)(interaction);
  await untilQuiet(calls);
  return { calls, channel };
}
const press = (customId, user, options = {}) => interact(customId, { user, ...options });
const last = (calls, method) => calls.filter((entry) => entry.method === method).at(-1)?.payload;
const buttonsOf = (payload) =>
  (payload?.components ?? []).flatMap((row) => row.toJSON().components).map((button) => button.custom_id.split("|")[0]);
const embedOf = (payload) => payload.embeds[0].toJSON();

// u1 offre 100 points contre une Super Bonbon : l'offre ouverte la plus simple.
async function openOffer() {
  await setBalance(100, "u1");
  await offer({ je_donne: "100", je_recois: thing(BONBON, 1) });
  const [row] = await trades();
  return row;
}

beforeEach(async () => {
  for (const table of ["points", "pokemon_owned", "pokemon_inventory", "pokemon_item_log", "pokemon_trades", "pokemon_trade_drafts", "points_log"]) {
    await dbRun(points, `DELETE FROM ${table}`);
  }
});

describe("proposer à tous", () => {
  it("sans membre : offre publique sans mention, sans destinataire, sans « Refuser »", async () => {
    await setBalance(100, "u1");
    const calls = await offer({ je_donne: "100", je_recois: thing(BONBON, 1) });
    const reply = payloadOf(calls, "editReply");
    assert.equal(reply.content, undefined, "personne n'est mentionné");
    assert.deepEqual(buttonsOf(reply), ["poke_trade_accept", "poke_trade_counter", "poke_trade_cancel"]);
    const embed = embedOf(reply);
    assert.match(embed.description, /<@u1> propose \*\*100 points\*\*\ncontre \*\*.*Super Bonbon.*\*\*, au premier qui accepte\./);
    assert.match(embed.footer.text, /Ouverte à tous : le premier qui accepte l'emporte/);
    const [row] = await trades();
    assert.deepEqual([row.to_user_id, row.open_offer, row.request_open, row.status], ["", 1, 0, "PENDING"]);
  });

  it("sans `je_recois`, elle est « à son choix » ; `je_recois: 0` en fait un cadeau à prendre", async () => {
    await setBalance(200, "u1");
    const open = await offer({ je_donne: "100" });
    assert.deepEqual(buttonsOf(payloadOf(open, "editReply")), ["poke_trade_counter", "poke_trade_cancel"]);
    await offer({ je_donne: "50", je_recois: "0" });
    const [choice, gift] = await trades();
    assert.deepEqual([choice.request_open, choice.request_points], [1, null]);
    assert.deepEqual([gift.request_open, gift.request_points], [0, 0]);
    assert.match(embedOf(payloadOf(open, "editReply")).description, /à qui le veut, contre ce qu'on lui proposera/);
  });

  it("ce qu'on demande ne se lit chez personne : une espèce que personne n'a se demande quand même", async () => {
    await setBalance(100, "u1");
    await offer({ je_donne: "100", je_recois: `pk:${species("Roucool").id}` });
    const [row] = await trades();
    assert.equal(row.request_species_id, species("Roucool").id);
  });

  it("l'autocomplétion de `je_recois` sans membre propose tout le Pokédex et les objets", async () => {
    const calls = await runAutocomplete(pk, { sub: "echange", options: {}, focused: { name: "je_recois", value: "roucoo" } });
    const names = payloadOf(calls, "respond").map((choice) => choice.name);
    assert.ok(names.includes("Roucool"), names.join(", "));
    const bonbons = await runAutocomplete(pk, { sub: "echange", options: {}, focused: { name: "je_recois", value: "2 bonbon" } });
    assert.deepEqual(payloadOf(bonbons, "respond").map((choice) => choice.value), [thing(BONBON, 2)]);
  });

  it("le brouillon sans membre part « à son choix » et publie une offre ouverte", async () => {
    await setBalance(100, "u1");
    const calls = await runCommand(pk, { sub: "echange", options: {}, users: {} });
    assert.equal(payloadOf(calls, "reply").flags, MessageFlags.Ephemeral);
    const [draft] = await drafts();
    assert.deepEqual([draft.to_user_id, JSON.parse(draft.request)], ["", { kind: "open" }]);
    await interact(`poke_td_pts|${draft.id}|give`, { kind: "modal", user: "u1", fields: { amount: "100" } });
    const { calls: go, channel } = await press(`poke_td_go|${draft.id}`, "u1");
    assert.equal(channel.sent.length, 1);
    assert.equal(channel.sent[0].content, undefined, "personne n'est mentionné");
    assert.match(last(go, "update").content, /Offre publiée, ouverte à tous/);
    const [row] = await trades();
    assert.deepEqual([row.to_user_id, row.open_offer, row.request_open], ["", 1, 1]);
  });
});

describe("accepter une offre ouverte", () => {
  it("le premier qui accepte l'emporte : il en devient le destinataire, l'échange a lieu", async () => {
    const open = await openOffer();
    await grant(BONBON, 1, "u2");
    const { calls } = await press(`poke_trade_accept|${open.id}`, "u2");
    assert.match(JSON.stringify(embedOf(last(calls, "update"))), /Échange effectué/);
    const row = await tradeRow(open.id);
    assert.deepEqual([row.status, row.to_user_id], ["ACCEPTED", "u2"]);
    assert.deepEqual([await balanceOf("u1"), await balanceOf("u2"), await stock("u1", BONBON), await stock("u2", BONBON)], [0, 100, 1, 0]);
  });

  it("l'auteur ne peut ni l'accepter ni la refuser, personne ne la refuse", async () => {
    const open = await openOffer();
    await grant(BONBON, 1, "u1");
    const own = await press(`poke_trade_accept|${open.id}`, "u1");
    assert.match(last(own.calls, "reply").content, /ta propre offre/);
    const decline = await press(`poke_trade_decline|${open.id}`, "u2");
    assert.match(last(decline.calls, "reply").content, /ne se refuse pas/);
    assert.deepEqual([(await tradeRow(open.id)).status, (await tradeRow(open.id)).to_user_id], ["PENDING", ""]);
    assert.equal(await balanceOf("u1"), 100);
  });

  it("celui à qui il manque ce qu'on demande lit seul le refus : l'offre reste ouverte, un autre la prend", async () => {
    const open = await openOffer();
    const refused = await press(`poke_trade_accept|${open.id}`, "u2");
    const reply = last(refused.calls, "reply");
    assert.equal(reply.flags, MessageFlags.Ephemeral);
    assert.match(reply.content, /Tu n'as plus assez de Super Bonbon : tu en as 0, il en faut 1/);
    assert.equal(last(refused.calls, "update"), undefined, "le message public ne bouge pas");
    let row = await tradeRow(open.id);
    assert.deepEqual([row.status, row.to_user_id], ["PENDING", ""]);
    assert.deepEqual([await balanceOf("u1"), await balanceOf("u2")], [100, 0], "rien n'a bougé");

    await grant(BONBON, 1, "u3");
    await press(`poke_trade_accept|${open.id}`, "u3");
    row = await tradeRow(open.id);
    assert.deepEqual([row.status, row.to_user_id], ["ACCEPTED", "u3"]);
    assert.equal(await balanceOf("u3"), 100);
  });

  it("deux clics simultanés : un seul échange", async () => {
    const open = await openOffer();
    await grant(BONBON, 1, "u2");
    await grant(BONBON, 1, "u3");
    await Promise.all([press(`poke_trade_accept|${open.id}`, "u2"), press(`poke_trade_accept|${open.id}`, "u3")]);
    const row = await tradeRow(open.id);
    assert.equal(row.status, "ACCEPTED");
    assert.equal((await balanceOf("u2")) + (await balanceOf("u3")), 100);
    assert.equal((await stock("u2", BONBON)) + (await stock("u3", BONBON)), 1);
    assert.equal(await stock("u1", BONBON), 1);
  });
});

describe("les contre-offres d'une offre ouverte", () => {
  // Une contre-offre de `user` : il propose `points` points contre les 100 de u1.
  async function counter(open, user, points) {
    await setBalance(points, user);
    await press(`poke_trade_counter|${open.id}`, user);
    const draft = (await drafts()).filter((entry) => entry.from_user_id === user).at(-1);
    assert.deepEqual([draft.to_user_id, draft.counter_of], ["u1", open.id]);
    await interact(`poke_td_pts|${draft.id}|give`, { kind: "modal", user, fields: { amount: String(points) } });
    await press(`poke_td_go|${draft.id}`, user);
    return (await trades()).filter((row) => row.counter_of === open.id && row.from_user_id === user).at(-1);
  }

  it("n'importe qui sauf l'auteur contre-propose, et l'offre ouverte reste ouverte", async () => {
    const open = await openOffer();
    const mine = await press(`poke_trade_counter|${open.id}`, "u1");
    assert.match(last(mine.calls, "reply").content, /ta propre offre/);
    const reply = await counter(open, "u2", 30);
    assert.deepEqual([reply.from_user_id, reply.to_user_id, reply.offer_points, reply.request_points, reply.open_offer], ["u2", "u1", 30, 100, 0]);
    assert.equal((await tradeRow(open.id)).status, "PENDING");
  });

  it("une contre-offre acceptée ferme l'offre ouverte (conclue avec lui) et annule les autres", async () => {
    const open = await openOffer();
    const fromU2 = await counter(open, "u2", 30);
    const fromU3 = await counter(open, "u3", 40);
    const { calls } = await press(`poke_trade_accept|${fromU3.id}`, "u1");
    assert.match(JSON.stringify(embedOf(last(calls, "update"))), /Échange effectué/);
    await eventually(async () => assert.equal((await tradeRow(fromU2.id)).status, "CANCELLED"));
    const base = await tradeRow(open.id);
    assert.deepEqual([base.status, base.to_user_id], ["SETTLED", "u3"]);
    assert.equal((await tradeRow(fromU2.id)).status, "CANCELLED");
    assert.deepEqual([await balanceOf("u1"), await balanceOf("u3")], [40, 100]);

    const { buildTradeEmbed } = await import("../modules/pokemon/embeds.js");
    const settled = buildTradeEmbed(base, "SETTLED").toJSON();
    assert.match(settled.description, /au premier qui accepte\.\n\n🤝 Conclu avec <@u3> par une contre-offre\./);
  });

  it("acceptée directement, l'offre ouverte annule les contre-offres en attente", async () => {
    const open = await openOffer();
    const fromU2 = await counter(open, "u2", 30);
    await grant(BONBON, 1, "u3");
    await press(`poke_trade_accept|${open.id}`, "u3");
    // La fermeture de la famille suit l'échange : on l'attend plutôt que de la supposer finie.
    await eventually(async () => assert.equal((await tradeRow(fromU2.id)).status, "CANCELLED"));
    assert.equal((await tradeRow(open.id)).status, "ACCEPTED");
    assert.equal(await balanceOf("u2"), 30, "la contre-offre annulée n'a rien pris");
  });

  it("une contre-offre contrée par l'auteur, puis acceptée, ferme toujours l'offre ouverte", async () => {
    const open = await openOffer();
    const fromU2 = await counter(open, "u2", 30);
    // u1 répond à la contre-offre de u2 : 100 points contre 60.
    await press(`poke_trade_counter|${fromU2.id}`, "u1");
    const draft = (await drafts()).find((entry) => entry.counter_of === fromU2.id);
    await setBalance(60, "u2");
    await interact(`poke_td_pts|${draft.id}|get`, { kind: "modal", user: "u1", fields: { amount: "60" } });
    await press(`poke_td_go|${draft.id}`, "u1");
    const again = (await trades()).find((row) => row.counter_of === fromU2.id);
    assert.equal((await tradeRow(fromU2.id)).status, "COUNTERED");
    await press(`poke_trade_accept|${again.id}`, "u2");
    await eventually(async () => assert.equal((await tradeRow(open.id)).status, "SETTLED"));
    const base = await tradeRow(open.id);
    assert.deepEqual([base.status, base.to_user_id], ["SETTLED", "u2"]);
  });
});

describe("closeOpenFamily", () => {
  it("sans destinataire ni ANYONE, la création échoue au lieu d'ouvrir l'offre à tous", async () => {
    await assert.rejects(() =>
      call(collection.proposeTrade, { fromUserId: "u1", toUserId: undefined, offer: { points: 0 }, request: { points: 5 }, channelId: "c" })
    );
    assert.deepEqual(await trades(), []);
  });

  it("un échange adressé, sans offre ouverte en amont, ne ferme rien", async () => {
    await setBalance(10, "u1");
    const trade = await call(collection.proposeTrade, { fromUserId: "u1", toUserId: "u2", offer: { points: 10 }, request: { points: 0 }, channelId: "c" });
    assert.deepEqual(await new Promise((resolve) => collection.closeOpenFamily(trade, resolve)), []);
  });
});
