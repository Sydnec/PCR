// Le brouillon d'un échange : /pk echange sans options ouvre un écran privé, dont les
// menus remplissent chaque côté, et « Proposer » publie la même offre que la commande.
// Chaque clic relit la base : un test enchaîne des clics et regarde la réponse.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { createSandbox, openDatabases, dbRun, dbAll, sleep, speciesByName } from "./helpers.js";
import { fakeChannel, fakeUser, payloadOf, runCommand } from "./fake-discord.js";

createSandbox({ config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } } });
const { points } = await openDatabases();
const pk = (await import("../commands/pk.js")).default;
const { handlePokemonButton, handlePokemonModal, handlePokemonSelect } = await import("../modules/pokemon/interactions.js");
const items = await import("../modules/pokemon/items.js");
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
    fields: { getTextInputValue: (id) => fields[id] ?? "" },
    isFromMessage: () => true,
  };
  for (const method of ["reply", "update", "showModal"]) interaction[method] = record(method);
  const handler = { button: handlePokemonButton, select: handlePokemonSelect, modal: handlePokemonModal }[kind];
  await handler(interaction);
  await sleep(40);
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
    const buttons = componentsOf(reply);
    assert.deepEqual(buttons.map((button) => button.custom_id), [`poke_td_side|${id}|give`, `poke_td_side|${id}|get`, `poke_td_go|${id}`, `poke_td_cancel|${id}`]);
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
    assert.equal(channel.sent[0].components.length, 1);
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
