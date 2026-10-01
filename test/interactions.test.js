// Les boutons et menus du jeu sur Discord (`poke_*`) : ce que fait un clic, avec de
// fausses interactions qui notent ce qu'on leur répond. Rien n'est gardé en
// mémoire entre deux clics — chaque bouton relit la base —, donc chaque test part
// d'un état en base et regarde la réponse.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { createSandbox, openDatabases, dbRun, dbAll, dbGet, sleep, withRandom, speciesByName } from "./helpers.js";

const sandbox = createSandbox({ config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } } });
process.env.POKEMON_CHANNEL_ID = "123";
const { points } = await openDatabases();
const { handlePokemonButton, handlePokemonSelect } = await import("../modules/pokemon/interactions.js");
const collection = await import("../modules/pokemon/collection.js");
const safari = await import("../modules/pokemon/safari.js");
const items = await import("../modules/pokemon/items.js");
const economy = await import("../modules/economy.js");
const data = await import("../modules/pokemon/data.js");
const { getPokemonConfig, getSafariConfig } = await import("../modules/pokemon/config.js");

const GEN1 = { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } };
const GEN2 = { pokemon: { generation: 2 } };
const species = (name) => speciesByName(data.allSpecies, name);
const call = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value))));
const EPHEMERAL = MessageFlags.Ephemeral;

// Un salon où le bot peut publier, qui note ce qu'il envoie.
function fakeChannel({ allowed = true, sendFails = null, thread = false, locked = false } = {}) {
  const sent = [];
  return {
    id: "c1",
    name: "pokemon",
    sent,
    locked,
    isThread: () => thread,
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => allowed }),
    toString: () => "<#c1>",
    send: async (payload) => {
      if (sendFails) throw sendFails;
      sent.push(payload);
      return { id: "m1", edit: async () => {} };
    },
    messages: { fetch: async (id) => ({ id, embeds: [], edit: async () => {} }) },
  };
}

// Un clic : la réponse du jeu, dans l'ordre. On attend une première réponse, puis
// un court instant pour celles qui suivent (un éphémère différé, puis modifié).
async function click(customId, { user = "u1", channel = fakeChannel(), values = undefined, run = handlePokemonButton, ...overrides } = {}) {
  const calls = [];
  const record = (method) => async (payload) => {
    calls.push({ method, payload });
  };
  const person = { id: user, username: `user-${user}`, displayName: `Dresseur ${user}`, displayAvatarURL: () => "https://cdn.test/u.png" };
  const interaction = {
    customId,
    values,
    user: person,
    member: { displayName: `Membre ${user}`, displayAvatarURL: () => "https://cdn.test/m.png" },
    channel,
    guild: { members: { me: {} } },
    webhook: { deleteMessage: async () => calls.push({ method: "deleteMessage" }) },
    client: {
      users: {
        fetch: async (id) => {
          if (id === "gone") throw new Error("Unknown User");
          return { id, username: `user-${id}`, displayName: `Dresseur ${id}`, displayAvatarURL: () => "https://cdn.test/u.png" };
        },
      },
      channels: { fetch: async () => channel },
    },
    ...overrides,
  };
  for (const method of ["reply", "update", "deferReply", "deferUpdate", "editReply", "followUp"]) interaction[method] = record(method);
  await run(interaction);
  const terminal = ["reply", "update", "editReply", "followUp"];
  for (let waited = 0; waited < 3000 && !calls.some((entry) => terminal.includes(entry.method)); waited += 10) await sleep(10);
  await sleep(60);
  return calls;
}
const last = (calls, method) => calls.filter((entry) => entry.method === method).at(-1)?.payload;
const only = (calls, method) => {
  const found = calls.filter((entry) => entry.method === method);
  assert.equal(found.length, 1, `${method} : une seule réponse attendue, reçu ${found.length} (${calls.map((c) => c.method).join(", ")})`);
  return found[0].payload;
};
const embedOf = (payload, index = 0) => payload.embeds[index].toJSON();
const labels = (payload) => (payload.components ?? []).flatMap((row) => row.toJSON().components.map((button) => button.label));
const buttonIds = (payload) => (payload.components ?? []).flatMap((row) => row.toJSON().components.map((button) => button.custom_id));

let counter = 0;
const newUser = () => `u-${++counter}`;
const setBalance = (amount, user) =>
  dbRun(points, "INSERT INTO points (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = ?", [user, amount, amount]);
const balance = (user) => call(economy.getBalance, user);
const grant = (key, quantity, user) => call(items.grantItem, user, key, quantity, { source: "test" });
const count = (key, user) => call(items.getItemCount, user, key);
async function own(name, user, { shiny = 0, sex = "M", obtained = 1, locked = 0 } = {}) {
  const { lastID } = await dbRun(
    points,
    "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at, locked) VALUES (?, ?, ?, ?, 'test', ?, ?)",
    [user, species(name).id, shiny, sex, obtained, locked]
  );
  return lastID;
}
const ownMany = async (name, quantity, user, options = {}) => {
  const ids = [];
  for (let index = 0; index < quantity; index++) ids.push(await own(name, user, { obtained: index + 1, ...options }));
  return ids;
};
async function spawnRow(name = "Roucool") {
  await dbRun(points, "DELETE FROM pokemon_spawns");
  const { lastID } = await dbRun(
    points,
    `INSERT INTO pokemon_spawns (species_id, is_shiny, catch_rate, rarity, status, spawned_at, flees_at, sex, charm_shiny, channel_id, message_id)
     VALUES (?, 0, ?, ?, 'ACTIVE', ?, 9999999999999, 'M', 0, '123', 'm1')`,
    [species(name).id, species(name).catchRate, data.rarityOf(species(name)), Date.now()]
  );
  return lastID;
}
const openPark = async () =>
  (await dbRun(points, "INSERT INTO pokemon_safari_parks (status, opened_at, expires_at, reserved_for) VALUES ('OPEN', ?, ?, NULL)", [Date.now(), Date.now() + 7_200_000])).lastID;

beforeEach(async () => {
  for (const table of [
    "points", "pokemon_owned", "pokemon_inventory", "pokemon_item_log", "pokemon_spawns", "pokemon_throws", "pokemon_drops",
    "pokemon_trades", "pokemon_safari_sessions", "pokemon_safari_parks", "pokemon_showcase_shares", "pokemon_fusions", "points_log",
  ]) {
    await dbRun(points, `DELETE FROM ${table}`);
  }
  sandbox.writeConfig(GEN1);
});

describe("le routeur", () => {
  it("un bouton qui n'est pas du jeu, ou périmé, ne fait rien", async () => {
    assert.deepEqual(await click("autre_chose|1|2"), []);
    assert.deepEqual(await click("poke_inconnu|1"), []);
  }, { timeout: 8000 });

  it("un menu qui n'est pas celui du parc est ignoré", async () => {
    const calls = await click("poke_autre|park|1", { values: ["1"], run: handlePokemonSelect });
    assert.deepEqual(calls, []);
  });
});

describe("lancer une ball depuis l'annonce", () => {
  it("une capture : l'éphémère est différé puis réécrit, sans boutons, et le Pokémon est dans la boîte", async () => {
    const user = newUser();
    const id = await spawnRow("Roucool");
    await setBalance(1000, user);
    const calls = await withRandom(0, () => click(`poke_throw|${id}|poke`, { user }));
    assert.deepEqual(only(calls, "deferReply"), { flags: EPHEMERAL });
    const reply = only(calls, "editReply");
    assert.match(reply.content, /Bravo ! \*\*Roucool[^*]*\*\* rejoint ton Pokédex/);
    assert.deepEqual(reply.components, [], "plus rien à relancer");
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_owned WHERE user_id = ?", [user])).length, 1);
    assert.equal(await balance(user), 1000 - getPokemonConfig().capture.balls.poke.price);
  });

  it("un raté : le panneau de relance reste, avec les prix", async () => {
    const user = newUser();
    const id = await spawnRow("Mewtwo");
    await setBalance(100000, user);
    const calls = await withRandom(0.999, () => click(`poke_throw|${id}|poke`, { user }));
    const reply = only(calls, "editReply");
    assert.match(reply.content, /Raté/);
    assert.equal(reply.components.length, 1);
    assert.ok(buttonIds(reply).every((customId) => /^poke_re(throw|master)\|/.test(customId)), "les boutons du panneau relancent depuis le panneau");
  });

  it("depuis le panneau, c'est le même message qu'on réécrit : l'accusé est un `deferUpdate`", async () => {
    const user = newUser();
    const id = await spawnRow("Mewtwo");
    await setBalance(100000, user);
    const calls = await withRandom(0.999, () => click(`poke_rethrow|${id}|poke`, { user }));
    assert.ok(calls.some((entry) => entry.method === "deferUpdate"));
    assert.ok(!calls.some((entry) => entry.method === "deferReply"));
    assert.match(only(calls, "editReply").content, /Raté/);
  });

  it("trop tôt : « Doucement » en éphémère avec le panneau, ou réécrit sans toucher aux boutons", async () => {
    const user = newUser();
    const id = await spawnRow("Mewtwo");
    await setBalance(100000, user);
    await withRandom(0.999, () => click(`poke_throw|${id}|poke`, { user }));

    const fromAnnouncement = await click(`poke_throw|${id}|poke`, { user });
    const reply = only(fromAnnouncement, "reply");
    assert.match(reply.content, /Doucement ! Attends encore \*\*\d+s\*\*/);
    assert.equal(reply.flags, EPHEMERAL);
    assert.equal(reply.components.length, 1, "un cul-de-sac sans boutons serait pire");

    const fromPanel = await click(`poke_rethrow|${id}|poke`, { user });
    const update = only(fromPanel, "update");
    assert.match(update.content, /Doucement/);
    assert.equal("components" in update, false, "les boutons du panneau ne sont pas réécrits : un refus tardif ne ressuscite rien");
  });

  it("une ball inconnue est refusée sans rien débiter", async () => {
    const user = newUser();
    const id = await spawnRow("Roucool");
    await setBalance(1000, user);
    const calls = await click(`poke_throw|${id}|ball-magique`, { user });
    assert.match(only(calls, "reply").content, /Ball inconnue/);
    assert.equal(await balance(user), 1000);
  });

  it("un Pokémon déjà parti ne coûte rien", async () => {
    const user = newUser();
    await setBalance(1000, user);
    const calls = await click("poke_throw|424242|poke", { user });
    assert.match(only(calls, "editReply").content, /n'est plus là/);
    assert.equal(await balance(user), 1000);
  });

  it("sans assez de points : le refus dit les chiffres", async () => {
    const user = newUser();
    const id = await spawnRow("Roucool");
    await setBalance(1, user);
    const calls = await click(`poke_throw|${id}|poke`, { user });
    assert.match(only(calls, "editReply").content, /Solde insuffisant : une \*\*Poké Ball\*\* coûte \*\*\d+\*\* points, tu en as \*\*1\*\*/);
  });

  it("une ball annoncée offerte ne se paie jamais en points : sans l'objet, refus", async () => {
    const user = newUser();
    const id = await spawnRow("Roucool");
    await setBalance(100000, user);
    const calls = await click(`poke_rethrow|${id}|master|item`, { user });
    assert.match(only(calls, "editReply").content, /Tu n'as plus de \*\*Master Ball\*\*/);
    assert.equal(await balance(user), 100000, "rien n'est débité");
  });
});

describe("la Master Ball et sa confirmation", () => {
  const price = () => getPokemonConfig().capture.balls.master.price;

  it("depuis l'annonce, un éphémère demande confirmation avec le prix et le solde", async () => {
    const user = newUser();
    const id = await spawnRow("Roucool");
    await setBalance(price() + 10, user);
    const calls = await click(`poke_master|${id}`, { user });
    const reply = only(calls, "reply");
    assert.equal(reply.flags, EPHEMERAL);
    assert.match(reply.content, new RegExp(`coûte \\*\\*${price()}\\*\\* points`));
    assert.match(reply.content, new RegExp(`Ton solde : \\*\\*${price() + 10}\\*\\* points`));
    assert.deepEqual(buttonIds(reply), [`poke_master_ok|${id}`, `poke_master_cancel|${id}`]);
    assert.match(labels(reply)[0], new RegExp(`Confirmer \\(-${price()}\\)`));
    assert.equal(await balance(user), price() + 10, "confirmer n'est pas payer");
  });

  it("depuis le panneau, la confirmation le transforme au lieu d'ouvrir un éphémère de plus", async () => {
    const user = newUser();
    const id = await spawnRow("Roucool");
    await setBalance(price(), user);
    const calls = await click(`poke_remaster|${id}`, { user });
    assert.ok(only(calls, "update").content.includes("garantit la capture"));
    assert.ok(!calls.some((entry) => entry.method === "reply"));
  });

  it("une Master Ball offerte se confirme aussi, avec le nombre qu'il en reste, et le customId porte la promesse", async () => {
    const user = newUser();
    const id = await spawnRow("Roucool");
    await grant("ball_master", 2, user);
    const calls = await click(`poke_master|${id}`, { user });
    const reply = only(calls, "reply");
    assert.match(reply.content, /Tu vas utiliser ta \*\*Master Ball\*\* offerte/);
    assert.match(reply.content, /Il t'en reste \*\*2\*\*/);
    assert.deepEqual(buttonIds(reply), [`poke_master_ok|${id}|item`, `poke_master_cancel|${id}`]);
    assert.equal(labels(reply)[0], "Utiliser ma Master Ball");
  });

  it("sans assez de points ni d'objet : refus avec les chiffres", async () => {
    const user = newUser();
    const id = await spawnRow("Roucool");
    await setBalance(5, user);
    const calls = await click(`poke_master|${id}`, { user });
    assert.match(only(calls, "reply").content, new RegExp(`coûte \\*\\*${price()}\\*\\* points, tu en as \\*\\*5\\*\\*`));
  });

  it("annuler rend le panneau, ou rien s'il n'y en a pas", async () => {
    const user = newUser();
    const id = await spawnRow("Roucool");
    const withPanel = await click(`poke_master_cancel|${id}`, { user });
    const update = only(withPanel, "update");
    assert.equal(update.content, "Annulé, tes points sont intacts.");
    assert.equal(update.components.length, 1);
    const bare = await click("poke_master_cancel", { user });
    assert.deepEqual(only(bare, "update").components, []);
  });

  it("confirmer lance : la capture est garantie", async () => {
    const user = newUser();
    const id = await spawnRow("Mewtwo");
    await setBalance(price(), user);
    const calls = await withRandom(0.999, () => click(`poke_master_ok|${id}`, { user }));
    assert.match(only(calls, "editReply").content, /Bravo ! \*\*Mewtwo[^*]*\*\*/);
    assert.equal(await balance(user), 0);
  });

  it("confirmer une ball offerte qui a disparu entre-temps refuse : jamais payée en points", async () => {
    const user = newUser();
    const id = await spawnRow("Roucool");
    await setBalance(price() * 2, user);
    const calls = await click(`poke_master_ok|${id}|item`, { user });
    assert.match(only(calls, "editReply").content, /Tu n'as plus de \*\*Master Ball\*\*/);
    assert.equal(await balance(user), price() * 2);
  });
});

describe("la fiche et les objets au sol", () => {
  it("« Infos du Pokémon » répond en privé : la fiche de l'espèce puis le solde", async () => {
    const user = newUser();
    const id = await spawnRow("Roucool");
    await setBalance(321, user);
    await own("Roucool", user);
    const calls = await click(`poke_owned|${id}`, { user });
    const reply = only(calls, "reply");
    assert.equal(reply.flags, EPHEMERAL);
    assert.equal(reply.embeds.length, 2);
    assert.match(JSON.stringify(embedOf(reply, 1)), /321/);
  });

  it("une apparition introuvable est dite", async () => {
    const calls = await click("poke_owned|99999");
    assert.match(only(calls, "reply").content, /introuvable/);
  });

  it("le premier ramasse : le message est réécrit sans bouton, et l'objet entre dans son sac", async () => {
    const winner = newUser();
    const spawnId = await spawnRow("Roucool");
    await dbRun(points, "UPDATE pokemon_spawns SET status = 'FLED', ended_at = ? WHERE id = ?", [Date.now(), spawnId]);
    const { lastID } = await dbRun(points, "INSERT INTO pokemon_drops (spawn_id, item_key, status, dropped_at, channel_id, message_id) VALUES (?, 'pepite', 'OPEN', ?, '123', 'm9')", [spawnId, Date.now()]);
    const calls = await click(`poke_drop|${lastID}`, { user: winner });
    const update = only(calls, "update");
    assert.deepEqual(update.components, []);
    assert.match(JSON.stringify(embedOf(update)), new RegExp(winner));
    assert.equal(await count("pepite", winner), 1);

    const late = await click(`poke_drop|${lastID}`, { user: newUser() });
    assert.equal(only(late, "reply").flags, EPHEMERAL, "les autres reçoivent un mot en privé");
    assert.equal((await dbAll(points, "SELECT SUM(count) AS total FROM pokemon_inventory"))[0].total, 1, "rien n'a été créé en plus");
  });
});

describe("les pages du Pokédex, de la boîte et des doublons", () => {
  it("le Pokédex se relit à chaque clic, avec le nom du dresseur", async () => {
    await ownMany("Rattata", 2, "42");
    const calls = await click("poke_dex|42|0");
    const update = only(calls, "update");
    assert.match(JSON.stringify(embedOf(update)), /Pokédex de user-42/);
    assert.equal(update.components.length, 1);
  });

  it("un dresseur parti du serveur s'affiche quand même, sans nom", async () => {
    await own("Rattata", "gone");
    const calls = await click("poke_dex|gone|0");
    assert.match(JSON.stringify(embedOf(only(calls, "update"))), /Dresseur inconnu/);
  });

  it("la boîte, filtrée par espèce ou non, page demandée", async () => {
    await ownMany("Rattata", 3, "42");
    await own("Roucool", "42");
    const all = await click("poke_box|42|0|0");
    const filtered = await click(`poke_box|42|${species("Rattata").id}|0`);
    assert.match(JSON.stringify(embedOf(only(all, "update"))), /Roucool/);
    assert.doesNotMatch(JSON.stringify(embedOf(only(filtered, "update"))), /Roucool/);
    const far = await click("poke_box|42|0|99");
    assert.equal(far.filter((entry) => entry.method === "update").length, 1, "une page hors limites ne plante pas");
  });

  it("les doublons d'un dresseur, avec ou sans la réserve des évolutions", async () => {
    await ownMany("Rattata", 3, "42");
    const plain = await click("poke_dup|42|0");
    const reserved = await click("poke_dupr|42|0");
    assert.match(JSON.stringify(embedOf(only(plain, "update"))), /Rattata/);
    assert.doesNotMatch(JSON.stringify(embedOf(only(reserved, "update"))), /Rattata ×|Rattata.*2/, "il manque Rattatac : ses Rattata sont mis de côté");
    assert.ok(buttonIds(only(reserved, "update")).every((id) => id.startsWith("poke_dupr")), "les boutons gardent le mode réserve");
  });

  it("qui a une espèce en double, et le refus d'une espèce inconnue", async () => {
    await ownMany("Rattata", 3, "42");
    const calls = await click(`poke_dupsp|${species("Rattata").id}|0`);
    assert.match(JSON.stringify(embedOf(only(calls, "update"))), /Dresseur 42|<@42>/);
    const unknown = await click("poke_dupsp|99999|0");
    assert.match(only(unknown, "reply").content, /Espèce inconnue/);
    assert.equal(only(unknown, "reply").flags, EPHEMERAL);
  });
});

describe("les boutons d'évolution", () => {
  const evo = (speciesName, variant, mode = "random", extra = "") => `poke_evo|${species(speciesName).id}|${variant}|${mode}${extra}`;

  it("fait évoluer l'individu désigné, et dit ce que ça a coûté", async () => {
    const user = newUser();
    const ids = await ownMany("Rattata", 3, user);
    await setBalance(5000, user);
    const calls = await click(evo("Rattata", `#${ids[2]}`), { user });
    const update = only(calls, "update");
    assert.match(update.content, /Félicitations ! Ton #\d+ \*\*Rattata[^*]*\*\* a évolué en \*\*Rattatac/);
    assert.match(update.content, /-1 Rattata, -1500 points/);
    assert.deepEqual(update.components, []);
    assert.equal(await balance(user), 3500);
  });

  it("un second clic sur le même bouton est refusé : il ne repaie pas", async () => {
    const user = newUser();
    const ids = await ownMany("Rattata", 4, user);
    await setBalance(9000, user);
    await click(evo("Rattata", `#${ids[3]}`), { user });
    const again = await click(evo("Rattata", `#${ids[3]}`), { user });
    assert.match(only(again, "update").content, /^❌ Le Pokémon #\d+ ne peut pas évoluer/);
    assert.equal(await balance(user), 9000 - 1500);
  });

  it("sans désigner d'individu (`*`), le bot choisit ; un ancien format (`0`, `1F`) reste lu", async () => {
    const user = newUser();
    await ownMany("Rattata", 3, user);
    await setBalance(9000, user);
    assert.match(only(await click(evo("Rattata", "*"), { user }), "update").content, /a évolué/);
    await dbRun(points, "DELETE FROM pokemon_owned");
    await ownMany("Rattata", 3, user);
    assert.match(only(await click(evo("Rattata", "0"), { user }), "update").content, /a évolué/);
    await dbRun(points, "DELETE FROM pokemon_owned");
    await ownMany("Rattata", 3, user, { shiny: 1, sex: "F" });
    assert.match(only(await click(evo("Rattata", "1F"), { user }), "update").content, /✨/);
  });

  it("il manque des exemplaires : le refus dit lesquels", async () => {
    const user = newUser();
    const ids = await ownMany("Rattata", 2, user);
    await setBalance(9000, user);
    const calls = await click(evo("Rattata", `#${ids[1]}`), { user });
    const update = only(calls, "update");
    assert.match(update.content, /^❌ Il te faut \*\*3\*\* Rattata/);
    assert.deepEqual(update.components, []);
  });

  it("un Pokémon verrouillé demande confirmation, et le bouton de confirmation porte « ok »", async () => {
    const user = newUser();
    const ids = await ownMany("Rattata", 3, user);
    await dbRun(points, "UPDATE pokemon_owned SET locked = 1 WHERE id = ?", [ids[2]]);
    await setBalance(9000, user);
    const asked = await click(evo("Rattata", `#${ids[2]}`), { user });
    const update = only(asked, "update");
    assert.match(update.content, /est verrouillé/);
    assert.deepEqual(labels(update), ["Faire évoluer quand même", "Annuler"]);
    const [confirmId, cancelId] = buttonIds(update);
    assert.equal(cancelId, "poke_evo_cancel");
    assert.ok(confirmId.endsWith("|ok"));
    assert.equal(await balance(user), 9000, "rien n'a été pris");

    const done = await click(confirmId, { user });
    assert.match(only(done, "update").content, /a évolué/);
  });

  it("annuler laisse le Pokémon tel quel", async () => {
    const calls = await click("poke_evo_cancel");
    assert.deepEqual(only(calls, "update"), { content: "Évolution annulée : il reste tel quel.", embeds: [], components: [] });
  });

  it("une lignée à embranchement propose ses formes, au prix du stade, et le choix part avec l'individu", async () => {
    const user = newUser();
    const ids = await ownMany("Évoli", 3, user);
    await setBalance(9000, user);
    const choices = await click(evo("Évoli", `#${ids[2]}`, "choose"), { user });
    const update = only(choices, "update");
    assert.match(update.content, /Choisis l'évolution \(\*\*3\s000\*\* points, 1 sacrifice\)/);
    assert.deepEqual(labels(update).sort(), ["Aquali", "Pyroli", "Voltali"]);
    assert.ok(buttonIds(update).every((id) => id.startsWith(`poke_evo_pick|${species("Évoli").id}|#${ids[2]}|`)));

    const picked = buttonIds(update).find((id) => id.endsWith(`|${species("Voltali").id}`));
    const done = await click(picked, { user });
    assert.match(only(done, "update").content, /a évolué en \*\*Voltali/);
    assert.equal(await balance(user), 9000 - getPokemonConfig().evolution.branchChoicePoints, "choisir coûte le supplément");
  });

  it("une espèce qui n'évolue pas répond avec le motif", async () => {
    const calls = await click(`poke_evo|${species("Mewtwo").id}|*|choose`);
    assert.match(only(calls, "update").content, /^❌ Mewtwo n'a pas d'évolution/);
  });

  it("un objet inconnu ou qui n'est pas un choix est ignoré : un vieux bouton ne casse rien", async () => {
    const user = newUser();
    const ids = await ownMany("Évoli", 3, user);
    await setBalance(9000, user);
    const calls = await click(evo("Évoli", `#${ids[2]}`, "choose", "|n_importe_quoi"), { user });
    assert.ok(buttonIds(only(calls, "update")).every((id) => !id.includes("n_importe_quoi")));
  });

  it("avec l'Évolyte, le choix est gratuit en points", async () => {
    const user = newUser();
    const ids = await ownMany("Évoli", 2, user);
    await grant("evolyte", 1, user);
    const choices = await click(evo("Évoli", `#${ids[1]}`, "choose", "|evolyte"), { user });
    const update = only(choices, "update");
    assert.match(update.content, /gratuit, 0 sacrifice.*Évolyte/);
    const picked = buttonIds(update).find((id) => id.endsWith(`|${species("Aquali").id}|evolyte`));
    const done = await click(picked, { user });
    assert.match(only(done, "update").content, /a évolué en \*\*Aquali/);
    assert.equal(await count("evolyte", user), 0);
  });

  it("Métamorph comble un sacrifice, et le message le dit", async () => {
    const user = newUser();
    const ids = await ownMany("Rattata", 2, user);
    await ownMany("Métamorph", 2, user);
    await setBalance(5000, user);
    const calls = await click(evo("Rattata", `#${ids[1]}`, "random", `|${collection.DITTO_HELPER}`), { user });
    assert.match(only(calls, "update").content, /-1 Métamorph/);
  });
});

describe("les boutons d'échange", () => {
  async function trade({ from = "u-from", to = "u-to", expired = false } = {}) {
    await ownMany("Rattata", 2, from);
    await ownMany("Roucool", 2, to);
    const id = await call(collection.createTrade, {
      fromUserId: from, toUserId: to, offerSpeciesId: species("Rattata").id, requestSpeciesId: species("Roucool").id, channelId: "123",
    });
    if (expired) await dbRun(points, "UPDATE pokemon_trades SET expires_at = ? WHERE id = ?", [Date.now() - 1, id]);
    return id;
  }
  const status = async (id) => (await dbGet(points, "SELECT status FROM pokemon_trades WHERE id = ?", [id])).status;

  it("l'accepter échange les Pokémon et ferme l'offre", async () => {
    const id = await trade();
    const calls = await click(`poke_trade_accept|${id}`, { user: "u-to" });
    const update = only(calls, "update");
    assert.equal(await status(id), "ACCEPTED");
    assert.ok(update.components[0].toJSON().components.every((button) => button.disabled), "les boutons sont grisés");
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_owned WHERE user_id = 'u-from' AND species_id = ?", [species("Roucool").id])).length, 1);
  });

  it("seule la cible accepte ou refuse, seul l'auteur annule", async () => {
    const id = await trade();
    for (const [action, user] of [["accept", "intrus"], ["decline", "u-from"], ["accept", "u-from"]]) {
      const calls = await click(`poke_trade_${action}|${id}`, { user });
      assert.match(only(calls, "reply").content, /ne t'est pas destiné/, `${action} par ${user}`);
    }
    const cancelByTarget = await click(`poke_trade_cancel|${id}`, { user: "u-to" });
    assert.match(only(cancelByTarget, "reply").content, /Seul l'auteur de l'offre peut l'annuler/);
    assert.equal(await status(id), "PENDING");
  });

  it("l'auteur annule, la cible refuse : l'offre est fermée sans rien échanger", async () => {
    const cancelled = await trade({ from: "a1", to: "b1" });
    assert.equal(only(await click(`poke_trade_cancel|${cancelled}`, { user: "a1" }), "update").components.length, 1);
    assert.equal(await status(cancelled), "CANCELLED");
    const declined = await trade({ from: "a2", to: "b2" });
    await click(`poke_trade_decline|${declined}`, { user: "b2" });
    assert.equal(await status(declined), "DECLINED");
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_owned WHERE user_id = 'a2' AND species_id = ?", [species("Rattata").id])).length, 2);
  });

  it("une offre déjà traitée ou inconnue est dite, en privé", async () => {
    const id = await trade({ from: "a3", to: "b3" });
    await click(`poke_trade_decline|${id}`, { user: "b3" });
    assert.match(only(await click(`poke_trade_accept|${id}`, { user: "b3" }), "reply").content, /déjà été traité/);
    assert.match(only(await click("poke_trade_accept|99999", { user: "b3" }), "reply").content, /Échange introuvable/);
  });

  it("une offre expirée échoue en le disant, sans rien échanger", async () => {
    const id = await trade({ from: "a4", to: "b4", expired: true });
    const calls = await click(`poke_trade_accept|${id}`, { user: "b4" });
    assert.match(only(calls, "update").content, /^❌ Cette offre a expiré/);
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_owned WHERE user_id = 'a4' AND species_id = ?", [species("Rattata").id])).length, 2);
  });

  it("un Pokémon qui n'est plus disponible fait échouer l'offre avec le motif", async () => {
    const id = await trade({ from: "a5", to: "b5" });
    await dbRun(points, "DELETE FROM pokemon_owned WHERE user_id = 'a5' AND id = (SELECT MAX(id) FROM pokemon_owned WHERE user_id = 'a5')");
    const calls = await click(`poke_trade_accept|${id}`, { user: "b5" });
    assert.match(only(calls, "update").content, /Le Pokémon proposé n'est plus disponible/);
    assert.equal(await status(id), "FAILED");
  });
});

describe("le parc safari sur Discord", () => {
  const goes = (customId, user) => click(customId, { user });

  it("entrer dans un parc ouvert : la visite s'affiche en éphémère", async () => {
    const user = newUser();
    const parkId = await openPark();
    const calls = await goes(`poke_safari_enter|${parkId}`, user);
    const reply = only(calls, "reply");
    assert.equal(reply.flags, EPHEMERAL);
    assert.ok(reply.embeds.length >= 1);
    assert.ok(buttonIds(reply).some((id) => id.startsWith("poke_safari_ball|")));
    const [session] = await dbAll(points, "SELECT user_id, actions_left FROM pokemon_safari_sessions");
    assert.equal(session.user_id, user);
    assert.equal(session.actions_left, getSafariConfig().actionsPerSession);
  });

  it("un parc fermé : refus en privé", async () => {
    const calls = await goes("poke_safari_enter|424242", newUser());
    assert.match(only(calls, "reply").content, /^❌ /);
    assert.equal(only(calls, "reply").flags, EPHEMERAL);
  });

  it("ressortir et rentrer reprend la visite, sans repayer ni redémarrer", async () => {
    const user = newUser();
    const parkId = await openPark();
    await goes(`poke_safari_enter|${parkId}`, user);
    const again = await goes(`poke_safari_enter|${parkId}`, user);
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_safari_sessions")).length, 1);
    assert.match(only(again, "reply").content ?? "", /reprends|reprise|où tu en étais/i);
  });

  it("une action : réécrit la visite, et un jeton périmé est refusé en privé sans toucher au plateau", async () => {
    const user = newUser();
    const parkId = await openPark();
    await goes(`poke_safari_enter|${parkId}`, user);
    const [{ id: sessionId, actions_left: actions }] = await dbAll(points, "SELECT id, actions_left FROM pokemon_safari_sessions");
    const stale = await goes(`poke_safari_bait|${sessionId}|${actions + 5}`, user);
    assert.equal(only(stale, "reply").flags, EPHEMERAL);
    assert.match(only(stale, "reply").content, /^❌ /);
    const ok = await withRandom(0.999, () => goes(`poke_safari_bait|${sessionId}|${actions}`, user));
    assert.equal(ok.filter((entry) => entry.method === "update").length, 1);
    assert.equal((await dbGet(points, "SELECT actions_left FROM pokemon_safari_sessions WHERE id = ?", [sessionId])).actions_left, actions - 1);
  });

  it("la visite d'un autre n'est pas la sienne", async () => {
    const owner = newUser();
    const parkId = await openPark();
    await goes(`poke_safari_enter|${parkId}`, owner);
    const [{ id: sessionId, actions_left: actions }] = await dbAll(points, "SELECT id, actions_left FROM pokemon_safari_sessions");
    const calls = await goes(`poke_safari_flee|${sessionId}|${actions}`, newUser());
    assert.match(only(calls, "reply").content, /^❌ /);
    assert.equal((await dbGet(points, "SELECT status FROM pokemon_safari_sessions WHERE id = ?", [sessionId])).status, "ACTIVE");
  });

  it("avec plusieurs générations ouvertes, entrer propose d'abord le choix, puis le menu se met à jour", async () => {
    sandbox.writeConfig(GEN2);
    const user = newUser();
    const parkId = await openPark();
    const picker = await goes(`poke_safari_enter|${parkId}`, user);
    const reply = only(picker, "reply");
    assert.equal(reply.flags, EPHEMERAL);
    assert.ok(reply.components.length >= 1);
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_safari_sessions")).length, 0, "rien n'est ouvert avant le choix");

    const menu = await click(`poke_safari_gens|park|${parkId}`, { user, values: ["1", "2", "0", "x"], run: handlePokemonSelect });
    assert.equal(only(menu, "update").components.length >= 1, true);

    const go = await goes(`poke_safari_go|park|${parkId}|1`, user);
    assert.ok(only(go, "update").embeds.length >= 1);
    const [session] = await dbAll(points, "SELECT encounter_species_id FROM pokemon_safari_sessions");
    assert.equal(data.getSpecies(session.encounter_species_id).generation, 1, "la génération choisie est respectée");
  });

  it("l'entrée payante depuis le menu : refus du parc fermé, parc offert signalé, puis débit", async () => {
    sandbox.writeConfig(GEN2);
    const user = newUser();
    await setBalance(getSafariConfig().entryPrice + 50, user);
    const paid = await goes("poke_safari_go|paid||1,2", user);
    assert.ok(only(paid, "update").embeds.length >= 1);
    assert.equal(await balance(user), 50);

    const broke = newUser();
    const refused = await goes("poke_safari_go|paid||1", broke);
    assert.match(only(refused, "update").content, /^❌ /);

    const rich = newUser();
    await setBalance(100000, rich);
    await openPark();
    const free = await goes("poke_safari_go|paid||1", rich);
    assert.match(only(free, "update").content, /ton entrée est offerte/);
    assert.equal(await balance(rich), 100000, "un parc offert est ouvert : on ne paie pas");
  });

  it("le safari fermé en configuration refuse l'entrée payante", async () => {
    sandbox.writeConfig({ pokemon: { ...GEN1.pokemon, safari: { enabled: false } } });
    const calls = await goes("poke_safari_go|paid||1", newUser());
    assert.match(only(calls, "update").content, /parc safari est fermé/);
  });
});

describe("le partage du bilan de safari", () => {
  async function finishedSession(user) {
    const parkId = await openPark();
    await click(`poke_safari_enter|${parkId}`, { user });
    const [{ id }] = await dbAll(points, "SELECT id FROM pokemon_safari_sessions WHERE user_id = ?", [user]);
    await dbRun(points, "UPDATE pokemon_safari_sessions SET actions_left = 0 WHERE id = ?", [id]);
    return id;
  }

  it("publie le bilan dans le salon, une seule fois", async () => {
    const user = newUser();
    const id = await finishedSession(user);
    const channel = fakeChannel();
    const calls = await click(`poke_safari_share|${id}`, { user, channel });
    assert.equal(channel.sent.length, 1);
    assert.equal(channel.sent[0].embeds.length, 1);
    assert.match(last(calls, "editReply").content, /Bilan partagé dans <#c1>/);
    assert.deepEqual(last(calls, "editReply").components, []);

    const again = await click(`poke_safari_share|${id}`, { user, channel });
    assert.match(only(again, "reply").content, /déjà été partagé/);
    assert.equal(channel.sent.length, 1);
  });

  it("une visite qui n'est pas la sienne, ou pas terminée, ne se partage pas", async () => {
    const owner = newUser();
    const parkId = await openPark();
    await click(`poke_safari_enter|${parkId}`, { user: owner });
    const [{ id }] = await dbAll(points, "SELECT id FROM pokemon_safari_sessions");
    const unfinished = await click(`poke_safari_share|${id}`, { user: owner });
    assert.match(only(unfinished, "reply").content, /pas terminée/);
    await dbRun(points, "UPDATE pokemon_safari_sessions SET actions_left = 0 WHERE id = ?", [id]);
    const stolen = await click(`poke_safari_share|${id}`, { user: newUser() });
    assert.match(only(stolen, "reply").content, /n'est pas la tienne/);
  });

  it("un salon où le bot ne peut pas publier est refusé AVANT de consommer le droit de partager", async () => {
    const user = newUser();
    const id = await finishedSession(user);
    const calls = await click(`poke_safari_share|${id}`, { user, channel: fakeChannel({ allowed: false }) });
    assert.match(only(calls, "reply").content, /Je ne peux pas publier d'embed dans <#c1>/);
    assert.equal((await dbGet(points, "SELECT shared_at FROM pokemon_safari_sessions WHERE id = ?", [id])).shared_at, null, "le droit n'est pas consommé");
    const locked = await click(`poke_safari_share|${id}`, { user, channel: fakeChannel({ thread: true, locked: true }) });
    assert.match(only(locked, "reply").content, /est verrouillé/);
  });

  it("un envoi qui échoue pour une raison prouvée rend le droit ; un échec incertain ne le rouvre pas", async () => {
    const user = newUser();
    const id = await finishedSession(user);
    const proven = await click(`poke_safari_share|${id}`, { user, channel: fakeChannel({ sendFails: Object.assign(new Error("Missing Permissions"), { code: 50013 }) }) });
    assert.match(last(proven, "followUp").content, /Tu peux réessayer/);
    assert.equal((await dbGet(points, "SELECT shared_at FROM pokemon_safari_sessions WHERE id = ?", [id])).shared_at, null);

    const uncertain = await click(`poke_safari_share|${id}`, { user, channel: fakeChannel({ sendFails: new Error("ECONNRESET") }) });
    assert.match(last(uncertain, "followUp").content, /peut-être abouti quand même/);
    assert.notEqual((await dbGet(points, "SELECT shared_at FROM pokemon_safari_sessions WHERE id = ?", [id])).shared_at, null, "republier deux fois serait pire");
  });

  it("sans salon, refus", async () => {
    const calls = await click("poke_safari_share|1", { channel: null });
    assert.match(only(calls, "reply").content, /Salon introuvable/);
  });
});

describe("le partage de la vitrine", () => {
  const share = (options = {}) => click("poke_showcase_share", options);

  async function showcaseOf(user, quantity = 2) {
    const ids = await ownMany("Rattata", quantity, user);
    ids.forEach(async (id, index) => dbRun(points, "UPDATE pokemon_owned SET showcase_pos = ? WHERE id = ?", [index + 1, id]));
    await sleep(40);
    return ids;
  }
  const noNetwork = async (run) => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("hors ligne");
    };
    try {
      return await run();
    } finally {
      globalThis.fetch = original;
    }
  };

  it("montre la vitrine dans le salon, avec la mention du dresseur sans ping", async () => {
    const user = newUser();
    await showcaseOf(user);
    const channel = fakeChannel();
    const calls = await noNetwork(() => share({ user, channel }));
    assert.equal(channel.sent.length, 1);
    assert.deepEqual(channel.sent[0].allowedMentions, { parse: [] });
    assert.match(JSON.stringify(channel.sent[0]), new RegExp(`<@${user}>`));
    assert.ok(calls.some((entry) => entry.method === "deferUpdate"));
    assert.match(JSON.stringify(last(calls, "editReply")), /Ta vitrine est montrée dans <#c1>/);
  });

  it("une vitrine vide, un salon fermé, un envoi trop rapproché : refus en privé", async () => {
    const user = newUser();
    assert.match(only(await share({ user }), "reply").content, /Ta vitrine est vide/);
    await showcaseOf(user);
    assert.match(only(await share({ user, channel: fakeChannel({ allowed: false }) }), "reply").content, /Je ne peux pas publier/);
    await noNetwork(() => share({ user }));
    const soon = await noNetwork(() => share({ user }));
    assert.match(only(soon, "reply").content, /prochain envoi possible <t:\d+:R>/);
  });

  it("un envoi qui échoue pour une raison prouvée rend le délai : il peut réessayer tout de suite", async () => {
    const user = newUser();
    await showcaseOf(user);
    const failing = fakeChannel({ sendFails: Object.assign(new Error("Unknown Channel"), { code: 10003 }) });
    const calls = await noNetwork(() => share({ user, channel: failing }));
    assert.match(last(calls, "followUp").content, /Tu peux réessayer/);
    const retry = fakeChannel();
    await noNetwork(() => share({ user, channel: retry }));
    assert.equal(retry.sent.length, 1);
  });

  it("sans salon, refus", async () => {
    assert.match(only(await share({ channel: null }), "reply").content, /Salon introuvable/);
  });
});
