// La vie d'une apparition : sa naissance dans le salon, sa fuite (par
// remplacement, par expiration, ou parce que son message a disparu), et ce qu'elle
// laisse tomber en partant. Discord est simulé : on regarde ce qu'il aurait reçu.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbGet, dbAll, sleep, withRandom, speciesByName } from "./helpers.js";

createSandbox({
  config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" }, spawn: { embedRefreshMs: 20 } } },
});
process.env.POKEMON_CHANNEL_ID = "123";
process.env.POKEMON_ROLE_ID = "role-pokemon";
const { points } = await openDatabases();
const spawn = await import("../modules/pokemon/spawn.js");
const drops = await import("../modules/pokemon/drops.js");
const items = await import("../modules/pokemon/items.js");
const data = await import("../modules/pokemon/data.js");
const { getPokemonConfig } = await import("../modules/pokemon/config.js");
const { default: attachFleeHandler } = await import("../functions/handlers/handlePokemonFleeOnTimer.js");

const call = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value))));
const species = (name) => speciesByName(data.allSpecies, name);
const MINUTE = 60_000;

// Un Discord qui note ce qu'on lui envoie : le salon, ses messages, leurs éditions.
function fakeDiscord({ sendFails = false, messageGone = false } = {}) {
  const sent = [];
  const edits = [];
  let counter = 0;
  const messages = new Map();
  const channel = {
    id: "123",
    send: async (payload) => {
      if (sendFails) throw new Error("salon fermé");
      const id = `m${++counter}`;
      const message = {
        id,
        embeds: payload.embeds?.map((embed) => embed.toJSON?.() ?? embed) ?? [],
        edit: async (next) => {
          edits.push({ id, ...next });
        },
      };
      messages.set(message.id, message);
      sent.push(payload);
      return message;
    },
    messages: {
      fetch: async (id) => {
        if (messageGone) throw new Error("message supprimé");
        const known = messages.get(id) ?? { id, embeds: [], edit: async (next) => edits.push({ id, ...next }) };
        return known;
      },
    },
  };
  return { client: { channels: { fetch: async () => channel } }, sent, edits };
}

const active = () => dbGet(points, "SELECT * FROM pokemon_spawns WHERE status = 'ACTIVE'");
const all = () => dbAll(points, "SELECT * FROM pokemon_spawns ORDER BY id");

beforeEach(async () => {
  for (const table of ["pokemon_spawns", "pokemon_throws", "pokemon_drops", "pokemon_inventory"]) await dbRun(points, `DELETE FROM ${table}`);
  await dbRun(points, "UPDATE pokemon_state SET spawning = 1, total_spawns = 0, message_count = 0, spawn_paused_until = 0 WHERE id = 1");
});

describe("naissance d'une apparition (doSpawn)", () => {
  it("poste l'annonce, enregistre la ligne avec le taux de l'espèce et le message, et rend le verrou", async () => {
    const discord = fakeDiscord();
    await withRandom(0.5, () => spawn.doSpawn(discord.client, { speciesId: species("Roucool").id, forceShiny: false }));
    await sleep(80);
    const row = await active();
    assert.equal(row.species_id, species("Roucool").id);
    assert.equal(row.catch_rate, species("Roucool").catchRate, "le taux figé est celui de l'espèce, le plancher joue à la lecture");
    assert.equal(row.rarity, "COMMUN");
    assert.equal(row.is_shiny, 0);
    assert.equal(row.message_id, "m1");
    assert.equal(discord.sent.length, 1);
    const state = await dbGet(points, "SELECT spawning, total_spawns FROM pokemon_state WHERE id = 1");
    assert.deepEqual(state, { spawning: 0, total_spawns: 1 });
  });

  it("la durée de vie d'un légendaire est le double de celle d'un Pokémon ordinaire", async () => {
    const { min, max } = getPokemonConfig().spawn.fleeAfterMinutes;
    const factor = getPokemonConfig().spawn.legendaryFleeMultiplier;
    const discord = fakeDiscord();
    // createSpawn n'est atteint qu'après des rappels de la base : le tirage doit
    // rester figé jusque-là, pas seulement le temps de l'appel.
    await withRandom(0, async () => {
      await spawn.doSpawn(discord.client, { speciesId: species("Mewtwo").id, forceShiny: false });
      await sleep(80);
    });
    const legendary = await active();
    assert.equal(legendary.rarity, "LEGENDAIRE");
    assert.equal(legendary.catch_rate, 3);
    assert.ok(Math.abs(legendary.flees_at - legendary.spawned_at - min * factor * MINUTE) < 50);

    await dbRun(points, "UPDATE pokemon_spawns SET status = 'FLED'");
    await dbRun(points, "UPDATE pokemon_state SET spawning = 1");
    await withRandom(0, async () => {
      await spawn.doSpawn(discord.client, { speciesId: species("Roucool").id, forceShiny: false });
      await sleep(80);
    });
    const common = await active();
    assert.ok(Math.abs(common.flees_at - common.spawned_at - min * MINUTE) < 50);
    assert.ok(max >= min);
  });

  it("mentionne le rôle pour un rare, un légendaire ou un shiny, pas pour un commun", async () => {
    const mentions = async (name, forceShiny) => {
      await dbRun(points, "UPDATE pokemon_spawns SET status = 'FLED'");
      await dbRun(points, "UPDATE pokemon_state SET spawning = 1");
      const discord = fakeDiscord();
      await spawn.doSpawn(discord.client, { speciesId: species(name).id, forceShiny });
      await sleep(80);
      return discord.sent.at(-1)?.content;
    };
    assert.equal(await mentions("Roucool", false), undefined);
    assert.match(await mentions("Dracaufeu", false), /<@&role-pokemon>/);
    assert.match(await mentions("Mewtwo", false), /<@&role-pokemon>/);
    assert.match(await mentions("Roucool", true), /<@&role-pokemon>/);
  });

  it("un shiny forcé l'est pour tout le salon, l'annonce l'écrit dans son titre", async () => {
    const discord = fakeDiscord();
    await spawn.doSpawn(discord.client, { speciesId: species("Roucool").id, forceShiny: true });
    await sleep(80);
    assert.equal((await active()).is_shiny, 1);
    assert.match(discord.sent[0].embeds[0].toJSON().title, /SHINY/);
  });

  it("l'annonce de l'organisateur figure dans l'embed", async () => {
    const discord = fakeDiscord();
    await spawn.doSpawn(discord.client, { speciesId: species("Roucool").id, announcement: "Un événement !" });
    await sleep(80);
    assert.match(discord.sent[0].embeds[0].toJSON().description, /Un événement !/);
  });

  it("le suivant remplace le précédent : le premier est marqué enfui et son message édité", async () => {
    const discord = fakeDiscord();
    await spawn.doSpawn(discord.client, { speciesId: species("Roucool").id });
    await sleep(80);
    await dbRun(points, "UPDATE pokemon_state SET spawning = 1");
    await spawn.doSpawn(discord.client, { speciesId: species("Rattata").id });
    await sleep(120);
    const rows = await all();
    assert.deepEqual(rows.map((row) => row.status), ["FLED", "ACTIVE"]);
    assert.ok(rows[0].ended_at > 0);
    assert.ok(discord.edits.some((edit) => edit.id === "m1" && edit.components?.length === 0), "le premier message perd ses boutons");
  });

  it("un seul Pokémon actif à la fois, garanti par la base", async () => {
    await dbRun(points, "INSERT INTO pokemon_spawns (species_id, catch_rate, status, spawned_at) VALUES (1, 45, 'ACTIVE', 1)");
    await assert.rejects(() => dbRun(points, "INSERT INTO pokemon_spawns (species_id, catch_rate, status, spawned_at) VALUES (2, 45, 'ACTIVE', 2)"), /UNIQUE/);
  });

  it("un salon qui refuse l'envoi n'enferme pas le jeu : l'apparition est annulée et le verrou rendu", async () => {
    const discord = fakeDiscord({ sendFails: true });
    await spawn.doSpawn(discord.client, { speciesId: species("Roucool").id });
    await sleep(120);
    assert.equal(await active(), undefined);
    assert.equal((await dbGet(points, "SELECT spawning FROM pokemon_state WHERE id = 1")).spawning, 0);
  });

  it("une espèce inconnue ne fait rien d'autre que rendre le verrou", async () => {
    const discord = fakeDiscord();
    await spawn.doSpawn(discord.client, { speciesId: 99999 });
    await sleep(60);
    assert.equal(discord.sent.length, 0);
    assert.equal((await dbGet(points, "SELECT spawning FROM pokemon_state WHERE id = 1")).spawning, 0);
  });

  it("une apparition forcée remet les compteurs à zéro et ignore la pause du parc", async () => {
    await dbRun(points, "UPDATE pokemon_state SET spawning = 0, message_count = 77, spawn_paused_until = ?", [Date.now() + 60 * MINUTE]);
    assert.equal(await call(spawn.claimForcedSpawn), true);
    const state = await dbGet(points, "SELECT message_count, spawning FROM pokemon_state WHERE id = 1");
    assert.deepEqual(state, { message_count: 0, spawning: 1 });
    assert.equal(await call(spawn.claimForcedSpawn), false, "un verrou déjà pris se refuse");
  });
});

describe("lectures", () => {
  it("rend l'apparition active, la dernière terminée, et la pause du parc", async () => {
    assert.equal(await call(spawn.getActiveSpawn), undefined);
    assert.equal(await call(spawn.getLastEndedSpawn), null);
    await dbRun(points, "INSERT INTO pokemon_spawns (id, species_id, catch_rate, status, spawned_at) VALUES (1, 1, 45, 'FLED', 1), (2, 2, 45, 'CAUGHT', 2), (3, 3, 45, 'ACTIVE', 3)");
    assert.equal((await call(spawn.getActiveSpawn)).id, 3);
    assert.equal((await call(spawn.getLastEndedSpawn)).id, 2);
    assert.equal((await call(spawn.getSpawn, 1)).status, "FLED");
    await dbRun(points, "UPDATE pokemon_state SET spawn_paused_until = 4242");
    assert.equal(await call(spawn.getSpawnPause), 4242);
  });

  it("répartit les dépenses : les lancers de chacun, les points brûlés seulement sur les ratés, les remboursés exclus", async () => {
    const insert = (user, ball, cost, result) =>
      dbRun(points, "INSERT INTO pokemon_throws (spawn_id, user_id, ball, cost, probability, result, thrown_at) VALUES (1, ?, ?, ?, 0.1, ?, 1)", [user, ball, cost, result]);
    await insert("a", "poke", 100, "MISS");
    await insert("a", "poke", 100, "MISS");
    await insert("a", "super", 200, "CATCH");
    await insert("b", "hyper", 400, "MISS");
    await insert("b", "poke", 100, "VOID");
    const spending = await call(spawn.spendingBreakdown, 1);
    assert.equal(spending.total, 600, "200 + 400 : le gagnant et le remboursé ne brûlent rien");
    assert.deepEqual(spending.participants.map((entry) => [entry.user_id, entry.throws, entry.burned]), [
      ["a", 3, 200],
      ["b", 1, 400],
    ]);
    assert.deepEqual(spending.participants[0].balls, { poke: 2, super: 1 });
  });

  it("les derniers lancers se lisent du plus ancien au plus récent, remboursés exclus", async () => {
    for (const [index, result] of ["MISS", "VOID", "MISS", "CATCH"].entries()) {
      await dbRun(points, "INSERT INTO pokemon_throws (spawn_id, user_id, ball, cost, probability, result, thrown_at) VALUES (1, ?, 'poke', 100, 0.1, ?, ?)", [`u${index}`, result, index]);
    }
    const recent = await call(spawn.recentThrows, 1, 2);
    assert.deepEqual(recent.map((entry) => entry.result), ["MISS", "CATCH"]);
  });
});

describe("fuite par expiration (balayage)", () => {
  const bot = fakeDiscord();
  attachFleeHandler(bot.client);
  const sweep = async () => {
    await bot.client.handlePokemonFleeOnTimer();
    await sleep(120);
  };

  it("fait fuir un Pokémon dont la durée de vie est écoulée, et pas avant", async () => {
    await dbRun(points, "INSERT INTO pokemon_spawns (species_id, catch_rate, status, spawned_at, flees_at, message_id, channel_id) VALUES (1, 45, 'ACTIVE', 1, ?, 'm9', '123')", [Date.now() + 10 * MINUTE]);
    await sweep();
    assert.equal((await active()).species_id, 1, "pas encore");
    await dbRun(points, "UPDATE pokemon_spawns SET flees_at = ?", [Date.now() - 1000]);
    await sweep();
    assert.equal(await active(), undefined);
    const [row] = await all();
    assert.equal(row.status, "FLED");
    assert.ok(row.ended_at > 0);
  });

  it("un Pokémon sans échéance n'est jamais balayé", async () => {
    await dbRun(points, "INSERT INTO pokemon_spawns (species_id, catch_rate, status, spawned_at, flees_at) VALUES (1, 45, 'ACTIVE', 1, NULL)");
    await sweep();
    assert.ok(await active());
  });

  it("une capture arrivée entre-temps gagne la course : rien n'est enfui, rien n'est annoncé", async () => {
    await dbRun(points, "INSERT INTO pokemon_spawns (species_id, catch_rate, status, spawned_at, flees_at) VALUES (1, 45, 'CAUGHT', 1, ?)", [Date.now() - 1000]);
    await sweep();
    assert.equal((await all())[0].status, "CAUGHT");
  });

  it("l'embed final signale la fuite et retire les boutons", async () => {
    await dbRun(points, "INSERT INTO pokemon_spawns (species_id, catch_rate, rarity, status, spawned_at, flees_at, message_id, channel_id) VALUES (?, 45, 'COMMUN', 'ACTIVE', 1, ?, 'm9', '123')", [species("Roucool").id, Date.now() - 1000]);
    bot.edits.length = 0;
    await sweep();
    const edit = bot.edits.find((entry) => entry.id === "m9");
    assert.ok(edit, "le message est édité");
    assert.deepEqual(edit.components, []);
    assert.match(JSON.stringify(edit.embeds[0].toJSON()), /enfui|s'est|Roucool/i);
  });
});

describe("l'objet qu'un Pokémon emporte", () => {
  it("un Pokémon qui s'enfuit lâche parfois son objet, une fois sur cinq", async () => {
    const discord = fakeDiscord();
    const row = { id: 7, species_id: species("Roucool").id, held_item: "pepite", channel_id: "123", message_id: "m5", rarity: "COMMUN", is_shiny: 0, throw_count: 0, sex: "M", form: null };
    await dbRun(points, "INSERT INTO pokemon_spawns (id, species_id, catch_rate, status, spawned_at, held_item, channel_id, message_id) VALUES (7, ?, 45, 'FLED', 1, 'pepite', '123', 'm5')", [row.species_id]);
    await withRandom(0.1, () => spawn.endSpawnAsFled(discord.client, row));
    await sleep(120);
    const [drop] = await dbAll(points, "SELECT * FROM pokemon_drops");
    assert.equal(drop.item_key, "pepite");
    assert.equal(drop.status, "OPEN");
    assert.equal(drop.spawn_id, 7);
    assert.ok(drop.message_id, "l'objet est annoncé dans le salon");
    await dbRun(points, "DELETE FROM pokemon_drops");
    await withRandom(0.9, () => spawn.endSpawnAsFled(discord.client, row));
    await sleep(80);
    assert.deepEqual(await dbAll(points, "SELECT * FROM pokemon_drops"), [], "il emporte son objet");
  });

  it("un Pokémon sans objet n'en laisse pas", async () => {
    const discord = fakeDiscord();
    await withRandom(0.1, () => spawn.endSpawnAsFled(discord.client, { id: 8, species_id: 1, held_item: null }));
    await sleep(60);
    assert.deepEqual(await dbAll(points, "SELECT * FROM pokemon_drops"), []);
  });
});

describe("objets au sol", () => {
  const user = (n) => `user-${n}`;
  const give = (dropId, spawnId = 1) => dbRun(points, "INSERT INTO pokemon_drops (id, spawn_id, item_key, species_id, channel_id, dropped_at) VALUES (?, ?, 'pepite', 1, '123', 1)", [dropId, spawnId]);

  it("ramassé par le premier : l'objet entre dans son sac, et l'objet est refermé", async () => {
    await give(1);
    const claimed = await call(drops.claimDrop, user(1), 1);
    assert.equal(claimed.ok, true);
    assert.equal(claimed.item.key, "pepite");
    assert.equal(await call(items.getItemCount, user(1), "pepite"), 1);
    assert.equal((await dbGet(points, "SELECT status, claimed_by FROM pokemon_drops")).claimed_by, user(1));
  });

  it("dix ramasseurs simultanés : un seul gagne, aucun objet n'est créé en plus", async () => {
    await give(1);
    const results = await Promise.all(Array.from({ length: 10 }, (_, n) => call(drops.claimDrop, user(n), 1)));
    assert.equal(results.filter((result) => result.ok).length, 1);
    const total = (await dbAll(points, "SELECT SUM(count) AS total FROM pokemon_inventory"))[0].total;
    assert.equal(total, 1);
    assert.ok(results.filter((result) => !result.ok).every((result) => /plus rapide/.test(result.reason)));
  });

  it("celui qui a capturé le Pokémon ne ramasse pas ce qu'il lâche : c'est une seconde course pour les autres", async () => {
    await dbRun(points, "INSERT INTO pokemon_spawns (id, species_id, catch_rate, status, spawned_at, caught_by) VALUES (1, 1, 45, 'CAUGHT', 1, ?)", [user(1)]);
    await give(1);
    const refused = await call(drops.claimDrop, user(1), 1);
    assert.equal(refused.ok, false);
    assert.equal(refused.captor, true);
    assert.match(refused.reason, /revient aux autres/);
    assert.equal((await dbGet(points, "SELECT status FROM pokemon_drops")).status, "OPEN", "toujours au sol");
    assert.equal((await call(drops.claimDrop, user(2), 1)).ok, true);
  });

  it("la liste des objets ouverts dit, pour chacun, s'il est interdit à ce dresseur", async () => {
    await dbRun(points, "INSERT INTO pokemon_spawns (id, species_id, catch_rate, status, spawned_at, caught_by) VALUES (1, 1, 45, 'CAUGHT', 1, ?)", [user(1)]);
    await give(1, 1);
    await give(2, 99);
    const mine = await call(drops.getOpenDrops, user(1));
    assert.deepEqual(mine.map((drop) => [drop.id, Boolean(drop.captor)]), [[2, false], [1, true]], "du plus récent au plus ancien");
    assert.equal((await call(drops.getOpenDrops, user(2))).every((drop) => !drop.captor), true);
  });

  it("un objet qu'aucun message n'annonce est refermé plutôt que laissé ouvert pour l'éternité", async () => {
    const dropId = await call(drops.dropItem, null, { spawn: { id: 1, species_id: 1, channel_id: null }, itemKey: "pepite" });
    assert.equal(dropId, null);
    assert.equal((await dbGet(points, "SELECT status FROM pokemon_drops")).status, "LOST");
    const failing = fakeDiscord({ sendFails: true });
    assert.equal(await call(drops.dropItem, failing.client, { spawn: { id: 1, species_id: 1, channel_id: "123" }, itemKey: "pepite" }).catch(() => "erreur"), "erreur");
  });

  it("un objet inconnu du catalogue ne tombe pas", async () => {
    assert.equal(await call(drops.dropItem, fakeDiscord().client, { spawn: { id: 1 }, itemKey: "fantome" }), null);
    assert.deepEqual(await dbAll(points, "SELECT * FROM pokemon_drops"), []);
  });

  it("un objet déjà revendiqué ne se ramasse pas deux fois", async () => {
    await give(1);
    await call(drops.claimDrop, user(1), 1);
    const second = await call(drops.claimDrop, user(2), 1);
    assert.equal(second.ok, false);
    assert.match(second.reason, /Trop tard/);
  });

  it("le ramassage depuis le site retire le bouton du salon", async () => {
    const discord = fakeDiscord();
    await drops.announceDropClaim(discord.client, { id: 1, channel_id: "123", message_id: "m1" }, items.getItem("pepite"), user(1));
    assert.equal(discord.edits.length, 1);
    assert.deepEqual(discord.edits[0].components, []);
    await drops.announceDropClaim(null, { id: 1 }, items.getItem("pepite"), user(1));
    await drops.announceDropClaim(fakeDiscord({ messageGone: true }).client, { id: 1, channel_id: "123", message_id: "m1" }, items.getItem("pepite"), user(1));
  });

  it("le tirage de lâcher suit la chance réglée", () => {
    assert.equal(withRandom(0, () => drops.leavesItemBehind()), true);
    assert.equal(withRandom(0.999, () => drops.leavesItemBehind()), false);
    const chance = getPokemonConfig().spawn.itemDropChance;
    assert.equal(withRandom(chance - 0.001, () => drops.leavesItemBehind()), true);
    assert.equal(withRandom(chance + 0.001, () => drops.leavesItemBehind()), false);
  });
});

describe("réparation au démarrage (rehydratePokemon)", () => {
  it("libère le verrou resté pris après un arrêt brutal", async () => {
    await dbRun(points, "UPDATE pokemon_state SET spawning = 1");
    spawn.rehydratePokemon(fakeDiscord().client);
    await sleep(100);
    assert.equal((await dbGet(points, "SELECT spawning FROM pokemon_state")).spawning, 0);
  });

  it("clôt une apparition sans message : sans cela, plus aucune ne pourrait naître", async () => {
    await dbRun(points, "INSERT INTO pokemon_spawns (species_id, catch_rate, status, spawned_at) VALUES (1, 45, 'ACTIVE', 1)");
    spawn.rehydratePokemon(fakeDiscord().client);
    await sleep(120);
    assert.equal(await active(), undefined);
  });

  it("donne une échéance à une apparition d'avant l'ajout de la colonne, sans la tuer au premier tick", async () => {
    await dbRun(points, "INSERT INTO pokemon_spawns (species_id, catch_rate, status, spawned_at, message_id, channel_id, flees_at) VALUES (1, 45, 'ACTIVE', 1, 'm1', '123', NULL)");
    spawn.rehydratePokemon(fakeDiscord().client);
    await sleep(120);
    const row = await active();
    assert.ok(row.flees_at > Date.now(), "une échéance dans le futur");
  });

  it("clôt l'apparition dont le message a été supprimé", async () => {
    await dbRun(points, "INSERT INTO pokemon_spawns (species_id, catch_rate, status, spawned_at, message_id, channel_id, flees_at) VALUES (1, 45, 'ACTIVE', 1, 'm1', '123', ?)", [Date.now() + 10 * MINUTE]);
    spawn.rehydratePokemon(fakeDiscord({ messageGone: true }).client);
    await sleep(150);
    assert.equal(await active(), undefined);
  });

  it("laisse intacte une apparition saine", async () => {
    await dbRun(points, "INSERT INTO pokemon_spawns (species_id, catch_rate, status, spawned_at, message_id, channel_id, flees_at) VALUES (1, 45, 'ACTIVE', 1, 'm1', '123', ?)", [Date.now() + 10 * MINUTE]);
    spawn.rehydratePokemon(fakeDiscord().client);
    await sleep(150);
    assert.ok(await active());
  });
});

describe("rafraîchissement de l'annonce", () => {
  it("regroupe une salve de lancers en une seule édition", async () => {
    const discord = fakeDiscord();
    await dbRun(points, "INSERT INTO pokemon_spawns (id, species_id, catch_rate, rarity, status, spawned_at, message_id, channel_id) VALUES (1, ?, 45, 'COMMUN', 'ACTIVE', 1, 'm1', '123')", [species("Roucool").id]);
    for (let i = 0; i < 8; i++) spawn.refreshSpawnEmbed(discord.client, 1);
    await sleep(250);
    assert.equal(discord.edits.length, 1, "Discord limite les éditions d'un même message");
  });

  it("l'édition immédiate part sans attendre", async () => {
    const discord = fakeDiscord();
    await dbRun(points, "INSERT INTO pokemon_spawns (id, species_id, catch_rate, rarity, status, spawned_at, message_id, channel_id) VALUES (1, ?, 45, 'COMMUN', 'ACTIVE', 1, 'm1', '123')", [species("Roucool").id]);
    spawn.refreshSpawnEmbed(discord.client, 1, { immediate: true });
    await sleep(60);
    assert.equal(discord.edits.length, 1);
  });
});
