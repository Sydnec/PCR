// L'actualisation des messages publics : une apparition capturée ou enfuie, une
// offre d'échange conclue ou expirée, un parc fermé, un objet ramassé. Chaque
// message finit sur l'état que dit la base — même quand une réécriture plus
// ancienne arrive en retard, même quand Discord a refusé une fois, même après un
// redémarrage (le rattrapage).
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbGet, sleep, eventually, speciesByName } from "./helpers.js";

createSandbox({
  config: {
    pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" }, spawn: { embedRefreshMs: 0 } },
    publicMessages: { retries: 2, retryDelayMs: 5, repairGraceSeconds: 60, repairWindowHours: 24 },
  },
});
process.env.POKEMON_CHANNEL_ID = "123";
const { points } = await openDatabases();
const spawn = await import("../modules/pokemon/spawn.js");
const data = await import("../modules/pokemon/data.js");
const roucool = speciesByName(data.allSpecies, "Roucool");
const { handlePokemonButton } = await import("../modules/pokemon/interactions.js");
const collection = await import("../modules/pokemon/collection.js");
const tradeMessage = await import("../modules/pokemon/trade-message.js");
const economy = await import("../modules/economy.js");
const safari = await import("../modules/pokemon/safari.js");
const drops = await import("../modules/pokemon/drops.js");

const MINUTE = 60_000;
const quiet = async (work) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await work();
  } finally {
    console.error = original;
  }
};

// Un salon dont on règle la lenteur (la première lecture d'un message traîne)
// et les pannes, et qui note chaque écriture, dans l'ordre où elle arrive.
function fakeDiscord({ slowFirstFetch = 0, slowFirstWrite = 0, failures = [], fetchFailure = null, onSend = null } = {}) {
  const writes = [];
  let fetches = 0;
  let edits = 0;
  const record = async (id, payload) => {
    if (edits++ === 0 && slowFirstWrite) await sleep(slowFirstWrite);
    const failure = failures.shift();
    if (failure) throw failure;
    writes.push({ id, payload });
  };
  const channel = {
    id: "123",
    writes,
    send: async (payload) => {
      if (onSend) await onSend(payload);
      return { id: "sent1" };
    },
    messages: {
      fetch: async (id) => {
        if (fetchFailure) throw fetchFailure;
        if (fetches++ === 0 && slowFirstFetch) await sleep(slowFirstFetch);
        return { id, embeds: [{ description: null }], edit: (payload) => record(id, payload) };
      },
      edit: (id, payload) => record(id, payload),
    },
  };
  return { client: { channels: { fetch: async () => channel } }, writes };
}
const isFinal = (write) => Array.isArray(write.payload.components) && write.payload.components.length === 0;

async function activeSpawn({ endedAgo = null, status = "ACTIVE", closed = false } = {}) {
  await dbRun(points, "DELETE FROM pokemon_spawns");
  await dbRun(points, "DELETE FROM pokemon_drops");
  const endedAt = endedAgo === null ? null : Date.now() - endedAgo;
  await dbRun(
    points,
    `INSERT INTO pokemon_spawns (id, species_id, catch_rate, rarity, status, spawned_at, flees_at, message_id, channel_id,
       caught_by, caught_ball, ended_at, message_closed_at)
     VALUES (1, ?, 45, 'COMMUN', ?, 1, 9999999999999, 'm1', '123', ?, ?, ?, ?)`,
    [roucool.id, status, status === "CAUGHT" ? "u1" : null, status === "CAUGHT" ? "poke" : null, endedAt, closed ? 1 : null]
  );
}
const spawnRow = () => dbGet(points, "SELECT * FROM pokemon_spawns WHERE id = 1");
const capture = () =>
  dbRun(points, "UPDATE pokemon_spawns SET status = 'CAUGHT', caught_by = 'u1', caught_ball = 'poke', ended_at = ? WHERE id = 1", [Date.now()]);
const flee = () => dbRun(points, "UPDATE pokemon_spawns SET status = 'FLED', ended_at = ? WHERE id = 1", [Date.now()]);

describe("l'annonce d'une apparition", () => {
  beforeEach(() => activeSpawn());

  for (const [ending, end, finish] of [
    ["capturée", capture, (client) => spawn.finalizeCaughtSpawn(client, 1)],
    ["enfuie", flee, async (client) => spawn.endSpawnAsFled(client, await spawnRow())],
  ]) {
    it(`${ending} : un rafraîchissement déjà en route n'écrase plus l'embed final`, async () => {
      // Le rafraîchissement a lu l'apparition ACTIVE, et son envoi traîne : la
      // fin arrive pendant ce temps. Sans file par message, elle partirait la
      // première et l'embed « actif » repasserait par-dessus.
      const discord = fakeDiscord({ slowFirstWrite: 120 });
      spawn.refreshSpawnEmbed(discord.client, 1, { immediate: true });
      await sleep(30);
      await end();
      await finish(discord.client);
      await eventually(() => assert.equal(discord.writes.length, 2));
      await sleep(80);
      assert.equal(discord.writes.length, 2);
      assert.ok(!isFinal(discord.writes[0]), "le rafraîchissement, d'abord");
      assert.ok(isFinal(discord.writes[1]), "la fin, en dernier, boutons retirés");
      assert.notEqual((await spawnRow()).message_closed_at, null);
    });

    it(`${ending} : un rafraîchissement qui lit la base après la fin se tait`, async () => {
      const discord = fakeDiscord({ slowFirstFetch: 120 });
      spawn.refreshSpawnEmbed(discord.client, 1, { immediate: true });
      await sleep(20);
      await end();
      await finish(discord.client);
      await eventually(() => assert.equal(discord.writes.length, 1));
      await sleep(150);
      assert.equal(discord.writes.length, 1, "rien ne repasse par-dessus");
      assert.ok(isFinal(discord.writes[0]));
    });
  }

  it("la capture affiche le vainqueur et sa ball relus en base", async () => {
    const discord = fakeDiscord();
    await capture();
    spawn.finalizeCaughtSpawn(discord.client, 1);
    await eventually(() => assert.equal(discord.writes.length, 1));
    assert.match(JSON.stringify(discord.writes[0].payload.embeds[0].toJSON()), /<@u1>/);
  });

  it("un rafraîchissement ne touche pas à une apparition déjà terminée", async () => {
    const discord = fakeDiscord();
    await flee();
    spawn.refreshSpawnEmbed(discord.client, 1, { immediate: true });
    await sleep(80);
    assert.deepEqual(discord.writes, []);
    assert.equal((await spawnRow()).message_closed_at, null, "sa fin reste à écrire par son propre chemin");
  });

  it("une panne passagère se réessaie, et la fin s'écrit quand même", async () => {
    const discord = fakeDiscord({ failures: [new Error("ECONNRESET")] });
    await capture();
    spawn.finalizeCaughtSpawn(discord.client, 1);
    await eventually(() => assert.equal(discord.writes.length, 1));
    assert.ok(isFinal(discord.writes[0]));
    await eventually(async () => assert.notEqual((await spawnRow()).message_closed_at, null));
  });

  it("une panne qui dure laisse la fin à écrire : le rattrapage s'en chargera", async () => {
    const discord = fakeDiscord({ failures: [new Error("a"), new Error("b"), new Error("c")] });
    await capture();
    await quiet(() => spawn.syncSpawnMessage(discord.client, 1, { dropped: false, charmed: false }));
    assert.deepEqual(discord.writes, []);
    assert.equal((await spawnRow()).message_closed_at, null);
  });

  it("un message supprimé ne se réessaie pas, et n'est plus à conclure", async () => {
    const discord = fakeDiscord({ failures: [Object.assign(new Error("Unknown Message"), { code: 10008 })] });
    await flee();
    assert.equal(await spawn.syncSpawnMessage(discord.client, 1), "gone");
    assert.notEqual((await spawnRow()).message_closed_at, null);
  });

  it("un message introuvable dès sa lecture n'est plus à conclure non plus", async () => {
    // Le cas le plus courant : Discord dit 404 avant même que le contenu soit construit.
    const discord = fakeDiscord({ fetchFailure: Object.assign(new Error("Unknown Message"), { code: 10008 }) });
    await activeSpawn({ status: "FLED", endedAgo: 5 * MINUTE });
    assert.equal(await spawn.repairSpawnMessages(discord.client), 0);
    assert.notEqual((await spawnRow()).message_closed_at, null, "le rattrapage ne repassera pas toutes les cinq minutes");
  });

  it("un rattrapage ne recouvre pas une fin que le chemin de la capture vient d'écrire", async () => {
    const discord = fakeDiscord();
    await activeSpawn({ status: "CAUGHT", endedAgo: 5 * MINUTE, closed: true });
    assert.equal(await spawn.syncSpawnMessage(discord.client, 1, { repair: true }), "skipped");
    assert.deepEqual(discord.writes, []);
  });

  it("un objet perdu, faute de salon, n'est pas un objet lâché", async () => {
    const discord = fakeDiscord();
    await dbRun(points, "UPDATE pokemon_spawns SET held_item = 'pepite' WHERE id = 1");
    await flee();
    await dbRun(points, "INSERT INTO pokemon_drops (spawn_id, item_key, status, dropped_at) VALUES (1, 'pepite', 'LOST', 1)");
    await spawn.syncSpawnMessage(discord.client, 1);
    const fields = discord.writes[0].payload.embeds[0].toJSON().fields.map((field) => field.name);
    assert.ok(!fields.includes("Il a lâché"), fields.join(", "));
  });

  it("l'objet lâché se déduit de la base quand le chemin de la fuite n'est plus là pour le dire", async () => {
    const discord = fakeDiscord();
    await dbRun(points, "UPDATE pokemon_spawns SET held_item = 'pepite' WHERE id = 1");
    await flee();
    await dbRun(points, "INSERT INTO pokemon_drops (spawn_id, item_key, channel_id, dropped_at) VALUES (1, 'pepite', '123', 1)");
    await spawn.syncSpawnMessage(discord.client, 1);
    const fields = discord.writes[0].payload.embeds[0].toJSON().fields.map((field) => field.name);
    assert.ok(fields.includes("Il a lâché"), fields.join(", "));
  });
});

describe("le rattrapage des apparitions", () => {
  it("réécrit une fin jamais affichée, passé le répit et dans la fenêtre", async () => {
    await activeSpawn({ status: "CAUGHT", endedAgo: 5 * MINUTE });
    const discord = fakeDiscord();
    assert.equal(await spawn.repairSpawnMessages(discord.client), 1);
    assert.ok(isFinal(discord.writes[0]));
    assert.match(JSON.stringify(discord.writes[0].payload.embeds[0].toJSON()), /Roucool/);
    assert.notEqual((await spawnRow()).message_closed_at, null);
    assert.equal(await spawn.repairSpawnMessages(discord.client), 0, "une fois conclue, plus rien à faire");
  });

  it("laisse le chemin ordinaire conclure pendant le répit, et l'historique en paix", async () => {
    for (const endedAgo of [10_000, 3 * 24 * 60 * MINUTE]) {
      await activeSpawn({ status: "FLED", endedAgo });
      const discord = fakeDiscord();
      assert.equal(await spawn.repairSpawnMessages(discord.client), 0, String(endedAgo));
      assert.deepEqual(discord.writes, []);
    }
  });

  it("ne touche ni une apparition en cours, ni une fin déjà affichée", async () => {
    for (const options of [{}, { status: "CAUGHT", endedAgo: 5 * MINUTE, closed: true }]) {
      await activeSpawn(options);
      const discord = fakeDiscord();
      assert.equal(await spawn.repairSpawnMessages(discord.client), 0);
      assert.deepEqual(discord.writes, []);
    }
  });
});

describe("le message d'une offre d'échange", () => {
  const call = (fn, ...args) => new Promise((resolve, reject) => fn(...args, (err, value) => (err ? reject(err) : resolve(value))));
  const tradeRow = (id) => dbGet(points, "SELECT * FROM pokemon_trades WHERE id = ?", [id]);

  async function offer({ expiredAgo = null, messageId = "t1" } = {}) {
    await dbRun(points, "DELETE FROM pokemon_trades");
    await call(economy.addPoints, "u1", 1000);
    const trade = await call(collection.proposeTrade, { fromUserId: "u1", toUserId: "u2", offer: { points: 500 }, request: { points: 0 }, channelId: "123" });
    if (messageId) await dbRun(points, "UPDATE pokemon_trades SET message_id = ? WHERE id = ?", [messageId, trade.id]);
    if (expiredAgo !== null) await dbRun(points, "UPDATE pokemon_trades SET expires_at = ? WHERE id = ?", [Date.now() - expiredAgo, trade.id]);
    return trade.id;
  }
  // Un clic sur un bouton de l'offre, qui note ce que le jeu y répond.
  const press = (customId, user, { updateFails = false } = {}) => {
    const calls = [];
    const interaction = {
      customId,
      user: { id: user },
      member: {},
      client: fakeDiscord().client,
      reply: async (payload) => calls.push({ kind: "reply", payload }),
      update: async (payload) => {
        if (updateFails) throw new Error("Unknown interaction");
        calls.push({ kind: "update", payload });
      },
      deferUpdate: async () => {},
    };
    return { calls, interaction, run: () => handlePokemonButton(interaction) };
  };
  const titles = (calls) => calls.filter((entry) => entry.kind === "update").map((entry) => entry.payload.embeds[0].toJSON().title);

  it("deux clics sur « Accepter » : un seul réécrit le message, l'autre l'apprend en privé", async () => {
    const id = await offer();
    const first = press(`poke_trade_accept|${id}`, "u2");
    const second = press(`poke_trade_accept|${id}`, "u2");
    await Promise.all([first.run(), second.run()]);
    const both = () => [...first.calls, ...second.calls];
    await eventually(() => assert.equal(both().length, 2));
    await sleep(80);
    const calls = both();
    assert.equal(calls.length, 2);
    assert.deepEqual(titles(calls), ["✅ Échange effectué"], "jamais d'« Échange impossible » par-dessus");
    const reply = calls.find((entry) => entry.kind === "reply");
    assert.match(reply.payload.content, /déjà été traité/);
    assert.equal((await tradeRow(id)).status, "ACCEPTED");
    await eventually(async () => assert.notEqual((await tradeRow(id)).message_closed_at, null));
  });

  it("si Discord refuse la réponse au clic, le message se réécrit par le salon", async () => {
    const id = await offer();
    const discord = fakeDiscord();
    const { interaction, run } = press(`poke_trade_decline|${id}`, "u2", { updateFails: true });
    interaction.client = discord.client;
    await run();
    await eventually(() => assert.equal(discord.writes.length, 1));
    assert.equal(discord.writes[0].payload.embeds[0].toJSON().title, "❌ Échange refusé");
    await eventually(async () => assert.notEqual((await tradeRow(id)).message_closed_at, null));
  });

  it("les offres échues passent en « expiré », boutons retirés ; les très anciennes changent de statut sans réécriture", async () => {
    const recent = await offer({ expiredAgo: 5 * MINUTE });
    const discord = fakeDiscord();
    assert.equal(await tradeMessage.expireTrades(discord.client), 1);
    assert.equal((await tradeRow(recent)).status, "EXPIRED");
    assert.equal(discord.writes[0].payload.embeds[0].toJSON().title, "⌛ Échange expiré");
    assert.ok(discord.writes[0].payload.components[0].toJSON().components.every((button) => button.disabled));
    assert.notEqual((await tradeRow(recent)).message_closed_at, null);

    const ancient = await offer({ expiredAgo: 30 * 24 * 60 * MINUTE });
    const quietDiscord = fakeDiscord();
    assert.equal(await tradeMessage.expireTrades(quietDiscord.client), 1);
    assert.equal((await tradeRow(ancient)).status, "EXPIRED");
    assert.deepEqual(quietDiscord.writes, []);
    assert.notEqual((await tradeRow(ancient)).message_closed_at, null);

    const open = await offer();
    assert.equal(await tradeMessage.expireTrades(fakeDiscord().client), 0);
    assert.equal((await tradeRow(open)).status, "PENDING");
  });

  it("un clic sur une offre échue la fait expirer, quel que soit le bouton", async () => {
    const id = await offer({ expiredAgo: 1000 });
    const { calls, run } = press(`poke_trade_cancel|${id}`, "u1");
    await run();
    await eventually(() => assert.equal(calls.length, 1));
    assert.deepEqual(titles(calls), ["⌛ Échange expiré"]);
    assert.equal((await tradeRow(id)).status, "EXPIRED");
  });

  it("une offre échue qu'une acceptation a gagnée au même instant n'est pas affichée « expirée »", async () => {
    const id = await offer({ expiredAgo: 1000 });
    // L'acceptation passe entre la lecture du clic et son expiration.
    const original = points.run;
    points.run = function (sql, ...rest) {
      if (/SET status = 'EXPIRED'/.test(sql)) {
        points.run = original;
        return original.call(this, "UPDATE pokemon_trades SET status = 'ACCEPTED', resolved_at = ? WHERE id = ?", [Date.now(), id], () =>
          original.call(this, sql, ...rest)
        );
      }
      return original.call(this, sql, ...rest);
    };
    const { calls, run } = press(`poke_trade_decline|${id}`, "u2");
    try {
      await run();
      await eventually(() => assert.equal(calls.length, 1));
    } finally {
      points.run = original;
    }
    assert.deepEqual(titles(calls), [], "le message est à l'acceptation, pas à ce clic");
    assert.match(calls[0].payload.content, /déjà été traité/);
    assert.equal((await tradeRow(id)).status, "ACCEPTED");
  });

  it("une offre conclue avant que son message soit connu reçoit sa fin dès qu'il l'est", async () => {
    const id = await offer({ messageId: null });
    await call(collection.resolveTradeAs, id, "u1", "CANCELLED");
    const discord = fakeDiscord();
    await tradeMessage.linkTradeMessage(discord.client, id, "t9");
    assert.equal(discord.writes.length, 1);
    assert.equal(discord.writes[0].id, "t9");
    assert.equal(discord.writes[0].payload.embeds[0].toJSON().title, "🚫 Échange annulé");
  });

  it("le rattrapage réécrit une offre conclue dont le message n'a pas reçu sa fin", async () => {
    const id = await offer();
    await call(collection.resolveTradeAs, id, "u2", "DECLINED");
    await dbRun(points, "UPDATE pokemon_trades SET resolved_at = ? WHERE id = ?", [Date.now() - 5 * MINUTE, id]);
    const discord = fakeDiscord();
    assert.equal(await tradeMessage.repairTradeMessages(discord.client), 1);
    assert.equal(discord.writes[0].payload.embeds[0].toJSON().title, "❌ Échange refusé");
    assert.equal(await tradeMessage.repairTradeMessages(discord.client), 0);
  });

  it("une offre contrée se réécrit « Contre-offre de » son destinataire, sans aucun bouton, et la fin est retenue", async () => {
    const id = await offer();
    await call(economy.addPoints, "u2", 1000);
    const countered = await new Promise((resolve) =>
      collection.counterTrade({ tradeId: id, fromUserId: "u2", offer: { points: 10 }, request: { points: 500 }, channelId: "123" }, (err, trade) => resolve(err ? null : trade))
    );
    assert.ok(countered, "la contre-offre est créée");
    const discord = fakeDiscord();
    assert.equal(await tradeMessage.syncTradeMessage(discord.client, id), "edited");
    const [write] = discord.writes;
    assert.equal(write.id, "t1");
    assert.equal(write.payload.embeds[0].toJSON().title, "↩️ Contre-offre");
    assert.match(write.payload.embeds[0].toJSON().description, /Contre-offre de <@u2>/);
    assert.deepEqual(write.payload.components, [], "plus aucun bouton");
    assert.notEqual((await tradeRow(id)).message_closed_at, null);
    assert.equal((await tradeRow(countered.id)).status, "PENDING", "la contre-offre, elle, reste ouverte");
  });

  it("le minuteur d'expiration ne touche pas une offre contrée, et le rattrapage lui donne sa fin", async () => {
    const id = await offer({ expiredAgo: MINUTE });
    await dbRun(points, "UPDATE pokemon_trades SET status = 'COUNTERED', resolved_at = ? WHERE id = ?", [Date.now() - 5 * MINUTE, id]);
    const discord = fakeDiscord();
    assert.equal(await tradeMessage.expireTrades(discord.client), 0);
    assert.equal((await tradeRow(id)).status, "COUNTERED");
    assert.equal(discord.writes.length, 0);
    assert.equal(await tradeMessage.repairTradeMessages(discord.client), 1);
    assert.equal(discord.writes[0].payload.embeds[0].toJSON().title, "↩️ Contre-offre");
    assert.equal(await tradeMessage.repairTradeMessages(discord.client), 0);
  });
});

describe("le message d'un parc safari", () => {
  const parkRow = () => dbGet(points, "SELECT * FROM pokemon_safari_parks WHERE id = 1");
  async function openPark({ closedAgo = null } = {}) {
    await dbRun(points, "DELETE FROM pokemon_safari_parks");
    await dbRun(
      points,
      `INSERT INTO pokemon_safari_parks (id, status, opened_at, expires_at, channel_id, message_id, entries, closed_at)
       VALUES (1, ?, 1, ?, '123', 'p1', 2, ?)`,
      [closedAgo === null ? "OPEN" : "CLOSED", Date.now() + 3_600_000, closedAgo === null ? null : Date.now() - closedAgo]
    );
  }
  const close = () => dbRun(points, "UPDATE pokemon_safari_parks SET status = 'CLOSED', closed_at = ? WHERE id = 1", [Date.now()]);

  it("un compteur d'entrées parti avant la fermeture ne rouvre pas le message", async () => {
    await openPark();
    const discord = fakeDiscord({ slowFirstWrite: 120 });
    safari.refreshParkMessage(discord.client, 1);
    await sleep(20);
    await close();
    await safari.syncParkMessage(discord.client, 1);
    await eventually(() => assert.ok(discord.writes.length >= 1));
    await sleep(150);
    assert.ok(isFinal(discord.writes.at(-1)), "la fermeture est la dernière écriture");
    assert.notEqual((await parkRow()).message_closed_at, null);
  });

  it("un compteur d'entrées ne touche ni aux boutons d'un parc ouvert, ni à un parc fermé", async () => {
    await openPark();
    const discord = fakeDiscord();
    await safari.syncParkMessage(discord.client, 1, { refreshOnly: true });
    assert.equal(discord.writes.length, 1);
    assert.equal(discord.writes[0].payload.components, undefined, "le bouton d'entrée reste en place");
    await close();
    await safari.syncParkMessage(discord.client, 1, { refreshOnly: true });
    assert.equal(discord.writes.length, 1);
  });

  it("le rattrapage pose la fermeture qu'un parc n'a jamais affichée", async () => {
    await openPark({ closedAgo: 5 * MINUTE });
    const discord = fakeDiscord();
    assert.equal(await safari.repairParkMessages(discord.client), 1);
    assert.ok(isFinal(discord.writes[0]));
    assert.equal(await safari.repairParkMessages(discord.client), 0);
  });
});

describe("le message d'un objet au sol", () => {
  const dropRow = (id) => dbGet(points, "SELECT * FROM pokemon_drops WHERE id = ?", [id]);

  it("ramassé avant que son message soit connu, il perd son bouton dès qu'il l'est", async () => {
    await dbRun(points, "DELETE FROM pokemon_drops");
    // Le ramassage (depuis le site) passe pendant l'envoi de l'annonce.
    const discord = fakeDiscord({
      onSend: () => dbRun(points, "UPDATE pokemon_drops SET status = 'CLAIMED', claimed_by = 'u9', claimed_at = ? WHERE status = 'OPEN'", [Date.now()]),
    });
    const dropId = await new Promise((resolve) =>
      drops.dropItem(discord.client, { spawn: { id: 1, species_id: roucool.id, channel_id: "123" }, itemKey: "pepite" }, (err, id) => resolve(id))
    );
    await eventually(() => assert.equal(discord.writes.length, 1));
    assert.equal(discord.writes[0].id, "sent1");
    assert.ok(isFinal(discord.writes[0]));
    await eventually(async () => assert.notEqual((await dropRow(dropId)).message_closed_at, null));
  });

  it("si Discord refuse la réponse au clic, le message se réécrit par le salon", async () => {
    await dbRun(points, "DELETE FROM pokemon_drops");
    await dbRun(points, "DELETE FROM pokemon_spawns");
    const { lastID } = await dbRun(points, "INSERT INTO pokemon_drops (item_key, status, channel_id, message_id, dropped_at) VALUES ('pepite', 'OPEN', '123', 'd1', 1)");
    const discord = fakeDiscord();
    await handlePokemonButton({
      customId: `poke_drop|${lastID}`,
      user: { id: "u3" },
      member: {},
      client: discord.client,
      reply: async () => {},
      update: async () => {
        throw new Error("Unknown interaction");
      },
      followUp: async () => {},
    });
    await eventually(() => assert.equal(discord.writes.length, 1));
    assert.ok(isFinal(discord.writes[0]));
    await eventually(async () => assert.notEqual((await dropRow(lastID)).message_closed_at, null));
  });

  it("le rattrapage retire le bouton d'un objet ramassé", async () => {
    await dbRun(points, "DELETE FROM pokemon_drops");
    const { lastID } = await dbRun(points, "INSERT INTO pokemon_drops (item_key, status, channel_id, message_id, dropped_at, claimed_by, claimed_at) VALUES ('pepite', 'CLAIMED', '123', 'd2', 1, 'u4', ?)", [Date.now() - 5 * MINUTE]);
    const discord = fakeDiscord();
    assert.equal(await drops.repairDropMessages(discord.client), 1);
    assert.equal(discord.writes[0].id, "d2");
    assert.notEqual((await dropRow(lastID)).message_closed_at, null);
  });
});
