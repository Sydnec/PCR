// Le brouillon d'un échange : /pk echange sans options ouvre un écran privé, dont les
// menus remplissent chaque côté, et « Proposer » publie la même offre que la commande.
// Chaque clic relit la base : un test enchaîne des clics et regarde la réponse.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { createSandbox, openDatabases, dbRun, dbAll, dbGet, untilQuiet, speciesByName } from "./helpers.js";
import { fakeChannel, fakeUser, payloadOf, runCommand } from "./fake-discord.js";

createSandbox({ config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } } });
const { points } = await openDatabases();
const pk = (await import("../commands/pk.js")).default;
const { handlePokemonButton, handlePokemonModal, handlePokemonSelect } = await import("../modules/pokemon/interactions.js");
const items = await import("../modules/pokemon/items.js");
const collection = await import("../modules/pokemon/collection.js");
const data = await import("../modules/pokemon/data.js");
const { getPokemonConfig } = await import("../modules/pokemon/config.js");

const species = (name) => speciesByName(data.allSpecies, name);
const call = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value))));
const grant = (key, quantity, user = "u1") => call(items.grantItem, user, key, quantity, { source: "test" });
const setBalance = (amount, user = "u1") =>
  dbRun(points, "INSERT INTO points (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = ?", [user, amount, amount]);
async function own(name, { user = "u1", shiny = 0, obtained = 1, locked = 0 } = {}) {
  const { lastID } = await dbRun(
    points,
    "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at, locked) VALUES (?, ?, ?, 'M', 'test', ?, ?)",
    [user, species(name).id, shiny, obtained, locked]
  );
  return lastID;
}
const ownMany = async (name, quantity, options = {}) => {
  const ids = [];
  for (let index = 0; index < quantity; index++) ids.push(await own(name, { obtained: index + 1, ...options }));
  return ids;
};
const balanceOf = async (user) => (await dbGet(points, "SELECT balance FROM points WHERE user_id = ?", [user]))?.balance ?? 0;
const drafts = () => dbAll(points, "SELECT * FROM pokemon_trade_drafts ORDER BY id");
const trades = () => dbAll(points, "SELECT * FROM pokemon_trades ORDER BY id");

// Un clic, un choix de menu ou une fenêtre validée : ce que le jeu répond, dans l'ordre.
async function interact(customId, { kind = "button", user = "u1", channel = fakeChannel(), values, fields = {} } = {}) {
  const calls = [];
  const record = (method) => async (payload) => {
    calls.push({ method, payload });
  };
  const interaction = {
    customId,
    values,
    user: fakeUser(user),
    channel,
    channelId: channel.id,
    client: { channels: { fetch: async () => channel } },
    fields: { getTextInputValue: (id) => fields[id] ?? "" },
    isFromMessage: () => true,
  };
  for (const method of ["reply", "update", "showModal"]) interaction[method] = record(method);
  const handler = { button: handlePokemonButton, select: handlePokemonSelect, modal: handlePokemonModal }[kind];
  await handler(interaction);
  await untilQuiet(calls);
  return { calls, channel };
}
const press = (customId, options) => interact(customId, options);
const choose = (customId, values, options) => interact(customId, { ...options, kind: "select", values: [].concat(values) });
const submit = (customId, fields, options) => interact(customId, { ...options, kind: "modal", fields });

const last = (calls, method) => calls.filter((entry) => entry.method === method).at(-1)?.payload;
const textOf = (payload) =>
  JSON.stringify(payload?.embeds?.map((embed) => embed.toJSON()) ?? []) + (payload?.content ?? "");
const componentsOf = (payload) => (payload?.components ?? []).flatMap((row) => row.toJSON().components);
const goButton = (payload) => componentsOf(payload).find((component) => component.custom_id?.startsWith("poke_td_go"));

// Ouvre un brouillon avec u2 et rend son identifiant.
async function openDraft(options = {}) {
  const calls = await runCommand(pk, { sub: "echange", options: { membre: "u2" }, users: { membre: fakeUser("u2") }, ...options });
  const [draft] = await drafts();
  return { calls, id: draft?.id };
}

beforeEach(async () => {
  for (const table of ["points", "pokemon_owned", "pokemon_inventory", "pokemon_item_log", "pokemon_trades", "pokemon_trade_drafts", "points_log"]) {
    await dbRun(points, `DELETE FROM ${table}`);
  }
});

describe("/pk echange sans options", () => {
  it("ouvre un brouillon privé : les deux côtés à choisir, « Proposer » grisé, rien proposé", async () => {
    const { calls, id } = await openDraft();
    const reply = payloadOf(calls, "reply");
    assert.equal(reply.flags, MessageFlags.Ephemeral);
    assert.match(textOf(reply), /Échange avec <@u2>/);
    const ids = componentsOf(reply).map((button) => button.custom_id);
    for (const side of ["give", "get"]) assert.ok(ids.includes(`poke_td_side|${id}|${side}`), `le côté « ${side} » est à choisir`);
    assert.equal(goButton(reply).disabled, true);
    assert.equal((await trades()).length, 0);
    const [row] = await drafts();
    assert.equal(row.from_user_id, "u1");
    assert.equal(row.expires_at - row.created_at, getPokemonConfig().trade.draftMinutes * 60 * 1000);
  });

  it("avec une option, la commande reste directe : pas de brouillon", async () => {
    await runCommand(pk, { sub: "echange", options: { membre: "u2", je_donne: "5" }, users: { membre: fakeUser("u2") } });
    assert.equal((await drafts()).length, 0);
  });

  it("purge les brouillons périmés à l'ouverture du suivant", async () => {
    const { id: old } = await openDraft();
    await dbRun(points, "UPDATE pokemon_trade_drafts SET expires_at = 1 WHERE id = ?", [old]);
    await openDraft();
    assert.deepEqual((await drafts()).map((row) => row.id).includes(old), false);
  });
});

describe("les menus du brouillon", () => {
  it("des points : fenêtre de saisie, montant retenu et contrôlé avec le solde", async () => {
    await setBalance(500);
    const { id } = await openDraft();
    const kind = await choose(`poke_td_kind|${id}|give`, "points");
    assert.match(last(kind.calls, "showModal").toJSON().custom_id, new RegExp(`^poke_td_pts\\|${id}\\|give$`));

    const refused = await submit(`poke_td_pts|${id}|give`, { amount: "9 000" });
    assert.match(last(refused.calls, "update").content, /Tu n'as que \*\*500\*\* points : il t'en faut \*\*9[\s\u202f]000\*\*/);
    assert.equal((await drafts())[0].offer, null, "un refus ne retient rien");

    const bad = await submit(`poke_td_pts|${id}|give`, { amount: "beaucoup" });
    assert.match(last(bad.calls, "update").content, /Tape un nombre de points/);

    const ok = await submit(`poke_td_pts|${id}|give`, { amount: "400 points" });
    assert.match(textOf(last(ok.calls, "update")), /400 points/);
    assert.deepEqual(JSON.parse((await drafts())[0].offer), { kind: "points", amount: 400 });
  });

  it("« Rien » se retient sans saisie : c'est le cadeau", async () => {
    const { id } = await openDraft();
    const result = await choose(`poke_td_kind|${id}|get`, "nothing");
    assert.match(textOf(last(result.calls, "update")), /rien \(0 point\)/);
    assert.deepEqual(JSON.parse((await drafts())[0].request), { kind: "points", amount: 0 });
  });

  it("un objet : recherche avec quantité, menu des résultats, choix retenu avec la quantité", async () => {
    await grant("super_bonbon", 5);
    await grant("charme_chroma_1", 1);
    const { id } = await openDraft();
    const kind = await choose(`poke_td_kind|${id}|give`, "item");
    assert.match(last(kind.calls, "showModal").toJSON().custom_id, new RegExp(`^poke_td_find\\|${id}\\|give\\|item$`));

    const none = await submit(`poke_td_find|${id}|give|item`, { query: "zzz", quantity: "2" });
    assert.match(last(none.calls, "update").content, /Aucun objet de ce nom/);
    const zero = await submit(`poke_td_find|${id}|give|item`, { query: "bonbon", quantity: "0" });
    assert.match(last(zero.calls, "update").content, /au moins 1/);

    const found = await submit(`poke_td_find|${id}|give|item`, { query: "", quantity: "3" });
    const select = componentsOf(last(found.calls, "update"))[0];
    assert.deepEqual(select.options.map((option) => option.value), ["item:super_bonbon:3"], "le charme ne se propose pas");
    assert.equal(select.options[0].label, "3× Super Bonbon (sur 5)");

    const picked = await choose(select.custom_id, "item:super_bonbon:3");
    assert.match(textOf(last(picked.calls, "update")), /3× Super Bonbon/);
    assert.deepEqual(JSON.parse((await drafts())[0].offer), { kind: "item", id: "super_bonbon", quantity: 3 });
  });

  it("un objet qu'on n'a pas en assez grand nombre est refusé avec les chiffres", async () => {
    await grant("super_bonbon", 1);
    const { id } = await openDraft();
    const found = await submit(`poke_td_find|${id}|give|item`, { query: "bonbon", quantity: "3" });
    const select = componentsOf(last(found.calls, "update"))[0];
    const picked = await choose(select.custom_id, "item:super_bonbon:3");
    assert.match(last(picked.calls, "update").content, /Tu n'as que \*\*1\*\* Super Bonbon : il t'en faut \*\*3\*\*/);
    assert.equal((await drafts())[0].offer, null);
  });

  it("un Pokémon qu'on donne : espèces en trop, puis l'individu, le moins précieux par défaut", async () => {
    const rattata = await ownMany("Rattata", 3);
    const oldest = rattata[0];
    await own("Salamèche");
    const { id } = await openDraft();
    const kind = await choose(`poke_td_kind|${id}|give`, "pk");
    assert.match(last(kind.calls, "showModal").toJSON().custom_id, new RegExp(`^poke_td_find\\|${id}\\|give\\|pk$`));

    const none = await submit(`poke_td_find|${id}|give|pk`, { query: "salam" });
    assert.match(last(none.calls, "update").content, /Aucune espèce « salam » à échanger/, "le seul Salamèche reste");

    const found = await submit(`poke_td_find|${id}|give|pk`, { query: "ratt" });
    const select = componentsOf(last(found.calls, "update"))[0];
    assert.deepEqual(select.options.map((option) => option.value), [`pk:${species("Rattata").id}`]);

    const picked = await choose(select.custom_id, `pk:${species("Rattata").id}`);
    const individuals = componentsOf(last(picked.calls, "update"))[0];
    assert.equal(individuals.custom_id, `poke_td_ind|${id}|give`);
    assert.equal(individuals.options[0].value, "auto");
    assert.deepEqual(individuals.options.slice(1).map((option) => option.value), [...rattata].reverse().map((id) => `#${id}`), "les plus récents d'abord");
    assert.equal(JSON.parse((await drafts())[0].offer).individual, null, "retenu « le moins précieux » en attendant");

    const chosen = await choose(`poke_td_ind|${id}|give`, `#${oldest}`);
    assert.match(textOf(last(chosen.calls, "update")), new RegExp(`#${oldest}`));
    assert.equal(JSON.parse((await drafts())[0].offer).individual, `#${oldest}`);
    const back = await choose(`poke_td_ind|${id}|give`, "auto");
    assert.match(textOf(last(back.calls, "update")), /le moins précieux/);
    assert.equal(JSON.parse((await drafts())[0].offer).individual, null);
  });

  it("un Pokémon qu'on demande : cherché chez le destinataire, il choisira lequel", async () => {
    await ownMany("Roucool", 2, { user: "u2" });
    await own("Rattata", { user: "u2" });
    const { id } = await openDraft();
    await choose(`poke_td_kind|${id}|get`, "pk");
    const found = await submit(`poke_td_find|${id}|get|pk`, { query: "" });
    const select = componentsOf(last(found.calls, "update"))[0];
    assert.deepEqual(select.options.map((option) => option.value), [`pk:${species("Roucool").id}`], "le seul Rattata de u2 reste chez lui");
    const picked = await choose(select.custom_id, `pk:${species("Roucool").id}`);
    assert.match(textOf(last(picked.calls, "update")), /un Roucool, au choix de l'autre/);
    assert.deepEqual(JSON.parse((await drafts())[0].request), { kind: "pk", id: String(species("Roucool").id), individual: null });
  });

  it("« Retour » et « Chercher autrement » ramènent au bon écran", async () => {
    const { id } = await openDraft();
    const side = await press(`poke_td_side|${id}|give`);
    assert.match(last(side.calls, "update").content, /Que donnes-tu/);
    assert.equal(componentsOf(last(side.calls, "update"))[0].custom_id, `poke_td_kind|${id}|give`);
    const back = await press(`poke_td_back|${id}`);
    assert.match(textOf(last(back.calls, "update")), /Tu donnes/);
    const ask = await press(`poke_td_side|${id}|get`);
    assert.match(last(ask.calls, "update").content, /Que demandes-tu à <@u2>/);
  });
});

describe("Proposer", () => {
  const fill = async (id, give, get) => {
    await dbRun(points, "UPDATE pokemon_trade_drafts SET offer = ?, request = ? WHERE id = ?", [JSON.stringify(give), JSON.stringify(get), id]);
  };

  it("est grisé tant qu'un côté manque, et refusé s'il est forcé", async () => {
    const { id } = await openDraft();
    await fill(id, { kind: "points", amount: 10 }, null);
    const forced = await press(`poke_td_go|${id}`);
    assert.match(last(forced.calls, "update").content, /Il manque un côté/);
    assert.equal((await trades()).length, 0);
  });

  it("publie l'offre comme la commande : message public, boutons, offre enregistrée, brouillon fermé", async () => {
    await setBalance(900);
    await ownMany("Roucool", 2, { user: "u2" });
    const { id } = await openDraft();
    await fill(id, { kind: "points", amount: 400 }, { kind: "pk", id: String(species("Roucool").id), individual: null });
    const channel = fakeChannel({ id: "salon-3" });
    const sent = await press(`poke_td_go|${id}`, { channel });

    assert.match(last(sent.calls, "update").content, /Offre envoyée à <@u2>/);
    assert.equal(channel.sent.length, 1);
    assert.equal(channel.sent[0].content, "<@u2>");
    assert.ok(componentsOf(channel.sent[0]).some((button) => button.custom_id?.startsWith("poke_trade_accept|")), "le message porte le bouton « Accepter »");
    const [trade] = await trades();
    assert.equal(trade.status, "PENDING");
    assert.equal(trade.offer_points, 400);
    assert.equal(trade.request_species_id, species("Roucool").id);
    assert.equal(trade.message_id, "msg-1", "le message de l'offre est retenu pour l'éditer plus tard");
    assert.equal((await drafts()).length, 0);
  });

  it("donne le Pokémon désigné, pas un autre", async () => {
    const ids = await ownMany("Rattata", 3);
    await ownMany("Roucool", 2, { user: "u2" });
    const { id } = await openDraft();
    await fill(id, { kind: "pk", id: String(species("Rattata").id), individual: `#${ids[0]}` }, { kind: "pk", id: String(species("Roucool").id), individual: null });
    await press(`poke_td_go|${id}`);
    assert.equal((await trades())[0].offer_pokemon_id, ids[0]);
  });

  it("revérifie tout à l'envoi : un solde tombé, un Pokémon parti sont refusés avec les chiffres, l'écran reste", async () => {
    await setBalance(500);
    await ownMany("Roucool", 2, { user: "u2" });
    const { id } = await openDraft();
    await fill(id, { kind: "points", amount: 400 }, { kind: "pk", id: String(species("Roucool").id), individual: null });
    await setBalance(100);
    const poor = await press(`poke_td_go|${id}`);
    assert.match(last(poor.calls, "update").content, /Tu n'as que \*\*100\*\* points : il t'en faut \*\*400\*\*/);

    await setBalance(500);
    await dbRun(points, "DELETE FROM pokemon_owned WHERE user_id = 'u2'");
    const gone = await press(`poke_td_go|${id}`);
    assert.match(last(gone.calls, "update").content, /<@u2> n'a aucun Roucool à donner/);
    assert.equal((await trades()).length, 0);
    assert.equal((await drafts()).length, 1, "le brouillon reste, pour corriger");
  });

  it("refuse deux côtés à zéro point, et une offre identique déjà ouverte", async () => {
    await setBalance(500);
    await ownMany("Roucool", 2, { user: "u2" });
    const { id } = await openDraft();
    await fill(id, { kind: "points", amount: 0 }, { kind: "points", amount: 0 });
    assert.match(last((await press(`poke_td_go|${id}`)).calls, "update").content, /Rien à échanger : les deux côtés sont à 0 point/);

    await fill(id, { kind: "points", amount: 100 }, { kind: "pk", id: String(species("Roucool").id), individual: null });
    await press(`poke_td_go|${id}`);
    const { id: second } = await openDraft();
    await fill(second, { kind: "points", amount: 100 }, { kind: "pk", id: String(species("Roucool").id), individual: null });
    const twice = await press(`poke_td_go|${second}`);
    assert.match(last(twice.calls, "update").content, /offre identique est déjà ouverte/);
    assert.equal((await trades()).filter((row) => row.status === "PENDING").length, 1);
  });

  it("un salon où le bot ne peut pas publier : l'offre est fermée, le brouillon reste", async () => {
    await setBalance(500);
    const { id } = await openDraft();
    await fill(id, { kind: "points", amount: 100 }, { kind: "points", amount: 0 });
    const channel = fakeChannel();
    channel.send = async () => {
      throw new Error("Missing Permissions");
    };
    const result = await press(`poke_td_go|${id}`, { channel });
    assert.match(last(result.calls, "update").content, /Je ne peux pas publier l'offre dans ce salon/);
    assert.deepEqual((await trades()).map((row) => row.status), ["CANCELLED"]);
    assert.equal((await drafts()).length, 1);
  });
});

describe("la vie d'un brouillon", () => {
  it("Annuler le ferme", async () => {
    const { id } = await openDraft();
    const result = await press(`poke_td_cancel|${id}`);
    assert.equal(last(result.calls, "update").content, "Échange annulé.");
    assert.equal((await drafts()).length, 0);
  });

  it("un brouillon périmé ou fermé le dit, partout : bouton, menu et fenêtre", async () => {
    const { id } = await openDraft();
    await dbRun(points, "UPDATE pokemon_trade_drafts SET expires_at = 1 WHERE id = ?", [id]);
    for (const result of [
      await press(`poke_td_side|${id}|give`),
      await choose(`poke_td_kind|${id}|give`, "points"),
      await submit(`poke_td_pts|${id}|give`, { amount: "10" }),
      await press(`poke_td_go|${id}`),
    ]) {
      assert.match(last(result.calls, "update").content, /expiré ou a été fermé/);
    }
    assert.equal((await trades()).length, 0);
  });

  it("personne d'autre ne touche à ton brouillon", async () => {
    const { id } = await openDraft();
    const intruder = await press(`poke_td_cancel|${id}`, { user: "u3" });
    assert.match(last(intruder.calls, "reply").content, /n'est pas à toi/);
    assert.equal((await drafts()).length, 1);
    const pick = await submit(`poke_td_pts|${id}|give`, { amount: "10" }, { user: "u3" });
    assert.match(last(pick.calls, "reply").content, /n'est pas à toi/);
    assert.equal((await drafts())[0].offer, null);
  });
});

describe("la contre-offre depuis le brouillon", () => {
  const propose = (offer, request, { from = "u1", to = "u2", messageId = "orig-msg" } = {}) =>
    call(collection.proposeTrade, { fromUserId: from, toUserId: to, offer, request, channelId: "salon" }).then(async (trade) => {
      await dbRun(points, "UPDATE pokemon_trades SET message_id = ? WHERE id = ?", [messageId, trade.id]);
      return trade;
    });
  // Un salon qui note les réécritures de messages, comme Discord les recevrait.
  const salon = () => {
    const channel = fakeChannel({ id: "salon" });
    channel.edits = [];
    channel.messages.edit = async (id, payload) => channel.edits.push({ id, payload });
    return channel;
  };
  const statuses = async () => (await trades()).map((row) => row.status);
  const openCounter = async (tradeId, user = "u2") => {
    await press(`poke_trade_counter|${tradeId}`, { user });
    return (await drafts()).find((draft) => draft.counter_of === tradeId);
  };

  it("« Proposer » ferme l'offre contrée, publie la contre-offre pour l'ancien auteur et réécrit l'ancien message", async () => {
    await setBalance(1000, "u1");
    await setBalance(1000, "u2");
    const original = await propose({ points: 100 }, { points: 300 });
    const draft = await openCounter(original.id);
    const channel = salon();
    const sent = await press(`poke_td_go|${draft.id}`, { user: "u2", channel });

    assert.match(last(sent.calls, "update").content, /Contre-offre envoyée à <@u1>/);
    assert.equal(channel.sent.length, 1);
    assert.equal(channel.sent[0].content, "<@u1>", "l'ancien auteur est mentionné");
    assert.deepEqual(componentsOf(channel.sent[0]).map((button) => button.label), ["Accepter", "Contre-offre", "Refuser", "Annuler"]);
    const [old, fresh] = await trades();
    assert.deepEqual([old.status, fresh.status], ["COUNTERED", "PENDING"]);
    assert.deepEqual([fresh.from_user_id, fresh.to_user_id, fresh.offer_points, fresh.request_points], ["u2", "u1", 300, 100], "les côtés sont inversés");
    assert.equal(fresh.counter_of, original.id);
    assert.equal(fresh.message_id, "msg-1", "la nouvelle offre est liée à son message");
    assert.equal((await drafts()).length, 0);

    assert.equal(channel.edits.length, 1, "l'ancien message est réécrit");
    assert.equal(channel.edits[0].id, "orig-msg");
    assert.match(textOf(channel.edits[0].payload), /Contre-offre de <@u2>/);
    assert.deepEqual(channel.edits[0].payload.components, [], "plus aucun bouton");
    assert.notEqual((await trades())[0].message_closed_at, null, "la fin du message est retenue");
  });

  it("les deux côtés se modifient avant l'envoi", async () => {
    await setBalance(1000, "u1");
    await setBalance(1000, "u2");
    const original = await propose({ points: 100 }, { points: 300 });
    const draft = await openCounter(original.id);
    await submit(`poke_td_pts|${draft.id}|give`, { amount: "250" }, { user: "u2" });
    await choose(`poke_td_kind|${draft.id}|get`, "nothing", { user: "u2" });
    await press(`poke_td_go|${draft.id}`, { user: "u2", channel: salon() });
    const fresh = (await trades())[1];
    assert.deepEqual([fresh.offer_points, fresh.request_points], [250, 0], "ni la valeur du côté donné ni celle du côté demandé n'est figée");
  });

  // A offre son Rattata shiny #n contre des points ; B le redemande pour moins.
  async function shinyCounter() {
    await setBalance(1000, "u1");
    await setBalance(1000, "u2");
    const [plain, , shiny] = [await own("Rattata", { obtained: 1 }), await own("Rattata", { obtained: 2 }), await own("Rattata", { obtained: 3, shiny: 1 })];
    const original = await propose(collection.selectorOf((await dbAll(points, "SELECT * FROM pokemon_owned WHERE id = ?", [shiny]))[0]), { points: 1000 });
    const draft = await openCounter(original.id);
    return { plain, shiny, original, draft };
  }

  it("la contre-offre redemande l'individu exact que l'offre désignait, et l'acceptation le déplace lui, pas un autre", async () => {
    const { plain, shiny, draft } = await shinyCounter();
    assert.deepEqual(JSON.parse(draft.request), { kind: "pk", id: String(species("Rattata").id), individual: `#${shiny}` });
    await submit(`poke_td_pts|${draft.id}|give`, { amount: "800" }, { user: "u2" });
    await press(`poke_td_go|${draft.id}`, { user: "u2", channel: salon() });
    const fresh = (await trades())[1];
    assert.deepEqual([fresh.request_pokemon_id, fresh.request_is_shiny, fresh.request_species_id], [shiny, 1, species("Rattata").id]);

    await press(`poke_trade_accept|${fresh.id}`, { user: "u1", channel: salon() });
    assert.equal((await trades())[1].status, "ACCEPTED");
    const holders = Object.fromEntries((await dbAll(points, "SELECT id, user_id FROM pokemon_owned")).map((row) => [row.id, row.user_id]));
    assert.equal(holders[shiny], "u2", "le shiny désigné a changé de main");
    assert.equal(holders[plain], "u1", "le moins précieux reste chez lui");
    assert.deepEqual([await balanceOf("u1"), await balanceOf("u2")], [1800, 200]);
  });

  it("si l'individu redemandé n'est plus disponible : refusé à l'envoi, ou à l'acceptation sans rien déplacer", async () => {
    const { shiny, draft } = await shinyCounter();
    await dbRun(points, "UPDATE pokemon_owned SET locked = 1 WHERE id = ?", [shiny]);
    const refused = await press(`poke_td_go|${draft.id}`, { user: "u2", channel: salon() });
    assert.match(last(refused.calls, "update").content, /est verrouillé chez <@u1>/);
    assert.deepEqual(await statuses(), ["PENDING"], "l'offre d'origine reste ouverte");

    await dbRun(points, "UPDATE pokemon_owned SET locked = 0 WHERE id = ?", [shiny]);
    await press(`poke_td_go|${draft.id}`, { user: "u2", channel: salon() });
    const fresh = (await trades())[1];
    await dbRun(points, "UPDATE pokemon_owned SET user_id = 'u3' WHERE id = ?", [shiny]);
    const before = await dbAll(points, "SELECT id, user_id FROM pokemon_owned ORDER BY id");
    await press(`poke_trade_accept|${fresh.id}`, { user: "u1", channel: salon() });
    assert.equal((await trades())[1].status, "FAILED");
    assert.deepEqual(await dbAll(points, "SELECT id, user_id FROM pokemon_owned ORDER BY id"), before);
    assert.deepEqual([await balanceOf("u1"), await balanceOf("u2")], [1000, 1000], "aucun point n'a bougé");
  });

  it("deux clics simultanés sur « Proposer » : une contre-offre, un message public, et aucun faux « elle n'est pas partie »", async () => {
    await setBalance(1000, "u1");
    await setBalance(1000, "u2");
    const original = await propose({ points: 100 }, { points: 300 });
    const draft = await openCounter(original.id);
    const channel = salon();
    const [first, second] = await Promise.all([
      press(`poke_td_go|${draft.id}`, { user: "u2", channel }),
      press(`poke_td_go|${draft.id}`, { user: "u2", channel }),
    ]);
    const texts = [first, second].map((result) => last(result.calls, "update")?.content ?? "");
    assert.ok(texts.every((text) => text.startsWith("✅")), texts.join(" | "));
    assert.equal(channel.sent.length, 1, "un seul message public");
    assert.deepEqual(await statuses(), ["COUNTERED", "PENDING"]);
    assert.equal((await drafts()).length, 0);
  });

  it("un brouillon de contre-offre périmé renvoie vers « Contre-offre »", async () => {
    const { draft } = await shinyCounter();
    await dbRun(points, "UPDATE pokemon_trade_drafts SET expires_at = 1 WHERE id = ?", [draft.id]);
    const result = await press(`poke_td_go|${draft.id}`, { user: "u2" });
    assert.match(last(result.calls, "update").content, /reclique sur « Contre-offre »/);
  });

  it("une offre conclue entre-temps refuse la contre-offre en privé : rien n'est créé, le brouillon est fermé", async () => {
    await setBalance(1000, "u1");
    await setBalance(1000, "u2");
    for (const [label, end] of [
      ["déjà acceptée", (id) => call(collection.acceptTrade, id, {})],
      ["déjà refusée", (id) => call(collection.resolveTradeAs, id, "u2", "DECLINED")],
      ["déjà annulée", (id) => call(collection.resolveTradeAs, id, "u1", "CANCELLED")],
    ]) {
      const original = await propose({ points: 100 }, { points: 300 });
      const draft = await openCounter(original.id);
      await end(original.id);
      const before = (await trades()).length;
      const channel = salon();
      const result = await press(`poke_td_go|${draft.id}`, { user: "u2", channel });
      assert.match(last(result.calls, "update").content, /Cette offre a expiré ou a déjà été traitée/, label);
      assert.equal((await trades()).length, before, `${label} : aucune offre créée`);
      assert.equal(channel.sent.length, 0, label);
      assert.equal((await drafts()).length, 0, `${label} : le brouillon est fermé`);
      await dbRun(points, "DELETE FROM pokemon_trades");
    }
  });

  it("une offre échue mais encore ouverte en base expire à l'envoi, et son message le dit", async () => {
    await setBalance(1000, "u2");
    const original = await propose({ points: 0 }, { points: 300 });
    const draft = await openCounter(original.id);
    await dbRun(points, "UPDATE pokemon_trades SET expires_at = ? WHERE id = ?", [Date.now() - 1, original.id]);
    const channel = salon();
    const result = await press(`poke_td_go|${draft.id}`, { user: "u2", channel });
    assert.match(last(result.calls, "update").content, /expiré ou a déjà été traitée/);
    assert.deepEqual(await statuses(), ["EXPIRED"]);
    assert.match(textOf(channel.edits[0].payload), /Échange expiré/);
  });

  it("les contrôles passent avant la fermeture : un solde trop bas est refusé avec les chiffres et l'offre reste ouverte", async () => {
    await setBalance(1000, "u1");
    await setBalance(50, "u2");
    const original = await propose({ points: 100 }, { points: 300 });
    const draft = await openCounter(original.id);
    const result = await press(`poke_td_go|${draft.id}`, { user: "u2", channel: salon() });
    assert.match(last(result.calls, "update").content, /Tu n'as que \*\*50\*\* points : il t'en faut \*\*300\*\*/);
    assert.deepEqual(await statuses(), ["PENDING"]);
    assert.equal((await drafts()).length, 1, "le brouillon reste, pour corriger");
  });

  it("un salon où le bot ne peut pas publier : la contre-offre est annulée et l'offre contrée redevient ouverte", async () => {
    await setBalance(1000, "u1");
    await setBalance(1000, "u2");
    const original = await propose({ points: 100 }, { points: 300 });
    const draft = await openCounter(original.id);
    const channel = salon();
    channel.send = async () => {
      throw new Error("Missing Permissions");
    };
    const result = await press(`poke_td_go|${draft.id}`, { user: "u2", channel });
    assert.match(last(result.calls, "update").content, /Je ne peux pas publier l'offre dans ce salon/);
    assert.deepEqual(await statuses(), ["PENDING", "CANCELLED"]);
    assert.equal((await trades())[0].resolved_at, null);
    assert.equal(channel.edits.length, 0, "l'ancien message n'est pas touché");
    assert.equal((await drafts()).length, 1);
  });

  it("une panne à la création laisse l'offre contrée ouverte et ne crée rien", async () => {
    await setBalance(1000, "u1");
    await setBalance(1000, "u2");
    const original = await propose({ points: 100 }, { points: 300 });
    const draft = await openCounter(original.id);
    await dbRun(points, "CREATE TRIGGER panne BEFORE INSERT ON pokemon_trades WHEN NEW.counter_of IS NOT NULL BEGIN SELECT RAISE(ABORT, 'panne'); END");
    let result;
    try {
      result = await press(`poke_td_go|${draft.id}`, { user: "u2", channel: salon() });
    } finally {
      await dbRun(points, "DROP TRIGGER panne");
    }
    assert.match(last(result.calls, "update").content, /Impossible de créer l'échange/);
    assert.deepEqual(await statuses(), ["PENDING"]);
  });
});

describe("« À son choix » depuis le brouillon", () => {
  const openDraftWith = async (give) => {
    const { id } = await openDraft();
    if (give) await dbRun(points, "UPDATE pokemon_trade_drafts SET offer = ? WHERE id = ?", [JSON.stringify(give), id]);
    return id;
  };

  it("se propose pour ce qu'on reçoit seulement, et se retient comme tel", async () => {
    const id = await openDraftWith();
    const give = componentsOf(last((await press(`poke_td_side|${id}|give`)).calls, "update"))[0].options.map((option) => option.value);
    assert.deepEqual(give, ["pk", "item", "points", "nothing"], "ce qu'on donne reste concret");
    const get = componentsOf(last((await press(`poke_td_side|${id}|get`)).calls, "update"))[0].options.map((option) => option.value);
    assert.ok(get.includes("open"));

    const forced = await choose(`poke_td_kind|${id}|give`, "open");
    assert.equal(last(forced.calls, "update"), undefined, "un « à son choix » forcé sur ce qu'on donne est ignoré");
    assert.equal((await drafts())[0].offer, null);

    const chosen = await choose(`poke_td_kind|${id}|get`, "open");
    assert.match(textOf(last(chosen.calls, "update")), /À son choix/);
    assert.deepEqual(JSON.parse((await drafts())[0].request), { kind: "open" });
  });

  it("« Proposer » publie l'offre ouverte : « Faire une proposition » à la place d'« Accepter », phrase « contre ce qu'il voudra »", async () => {
    await setBalance(900);
    await setBalance(100, "u2");
    const id = await openDraftWith({ kind: "points", amount: 400 });
    await choose(`poke_td_kind|${id}|get`, "open");
    const channel = fakeChannel({ id: "salon-4" });
    await press(`poke_td_go|${id}`, { channel });

    const [trade] = await trades();
    assert.deepEqual([trade.request_open, trade.request_species_id, trade.offer_points, trade.status], [1, 0, 400, "PENDING"]);
    const message = channel.sent[0];
    assert.equal(message.content, "<@u2>");
    assert.deepEqual(componentsOf(message).map((button) => button.label), ["Faire une proposition", "Refuser", "Annuler"]);
    assert.match(textOf(message), /<@u1> propose \*\*400 points\*\* à <@u2>, contre ce qu'il voudra\./);
  });

  it("une offre où rien n'est offert n'a pas de sens : refusée à l'envoi, rien créé", async () => {
    const id = await openDraftWith({ kind: "points", amount: 0 });
    await choose(`poke_td_kind|${id}|get`, "open");
    const result = await press(`poke_td_go|${id}`);
    assert.match(last(result.calls, "update").content, /Rien à échanger : tu n'offres rien/);
    assert.equal((await trades()).length, 0);
  });

  it("le destinataire répond par une proposition : ce qu'il donne est à choisir, puis l'auteur accepte et tout change de main", async () => {
    await setBalance(900, "u1");
    await setBalance(700, "u2");
    await ownMany("Roucool", 2, { user: "u2" });
    const offered = await ownMany("Rattata", 2);
    const { id } = await openDraft();
    await dbRun(points, "UPDATE pokemon_trade_drafts SET offer = ?, request = ? WHERE id = ?", [JSON.stringify({ kind: "pk", id: String(species("Rattata").id), individual: `#${offered[1]}` }), JSON.stringify({ kind: "open" }), id]);
    const channel = fakeChannel({ id: "salon" });
    channel.messages.edit = async () => {};
    await press(`poke_td_go|${id}`, { channel });
    const [open] = await trades();
    await dbRun(points, "UPDATE pokemon_trades SET message_id = 'orig-msg' WHERE id = ?", [open.id]);

    // L'accepter tel quel est refusé, même par un clic forgé.
    const forged = await press(`poke_trade_accept|${open.id}`, { user: "u2" });
    assert.match(last(forged.calls, "reply").content, /propose d'abord ce que tu donnes/);

    const opened = await press(`poke_trade_counter|${open.id}`, { user: "u2", channel });
    const draft = (await drafts()).find((entry) => entry.counter_of === open.id);
    assert.equal(draft.offer, null, "ce qu'il donne n'est pas rempli");
    assert.equal(goButton(last(opened.calls, "reply")).disabled, true, "« Proposer » reste grisé tant qu'il n'a pas choisi");
    const early = await press(`poke_td_go|${draft.id}`, { user: "u2", channel });
    assert.match(last(early.calls, "update").content, /Il manque un côté/);
    assert.deepEqual((await trades()).map((row) => row.status), ["PENDING"]);

    await submit(`poke_td_pts|${draft.id}|give`, { amount: "500" }, { user: "u2" });
    await press(`poke_td_go|${draft.id}`, { user: "u2", channel });
    const [, counter] = await trades();
    assert.deepEqual((await trades()).map((row) => row.status), ["COUNTERED", "PENDING"]);
    assert.deepEqual([counter.from_user_id, counter.to_user_id, counter.offer_points], ["u2", "u1", 500]);
    assert.equal(counter.request_species_id, species("Rattata").id);

    // u1 accepte : la contre-offre redemande le Rattata que son offre désignait, sans menu.
    assert.equal(counter.request_pokemon_id, offered[1]);
    await press(`poke_trade_accept|${counter.id}`, { user: "u1", channel });
    assert.equal((await trades())[1].status, "ACCEPTED");
    assert.deepEqual([await balanceOf("u1"), await balanceOf("u2")], [1400, 200]);
    assert.equal((await dbAll(points, "SELECT user_id FROM pokemon_owned WHERE id = ?", [offered[1]]))[0].user_id, "u2");
  });
});
