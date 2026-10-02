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
  const edited = [];
  return {
    id: "c1",
    name: "pokemon",
    sent,
    edited,
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
    messages: {
      fetch: async (id) => ({ id, embeds: [], edit: async () => {} }),
      edit: async (id, payload) => edited.push({ id, payload }),
    },
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

  it("un Machopeur reçu en échange évolue sans rien payer, sans solde, avec un exemplaire restant", async () => {
    const user = newUser();
    await own("Machopeur", user);
    const id = await own("Machopeur", user, { obtained: 2 });
    await dbRun(points, "UPDATE pokemon_owned SET origin = 'echange' WHERE id = ?", [id]);
    const calls = await click(evo("Machopeur", `#${id}`), { user });
    assert.match(only(calls, "update").content, /a évolué en \*\*Mackogneur/);
    assert.equal((await dbAll(points, "SELECT species_id FROM pokemon_owned WHERE id = ?", [id]))[0].species_id, species("Mackogneur").id);
    const left = await own("Machopeur", "u-seul");
    await dbRun(points, "UPDATE pokemon_owned SET origin = 'echange' WHERE id = ?", [left]);
    const alone = await click(evo("Machopeur", `#${left}`), { user: "u-seul" });
    assert.match(only(alone, "update").content, /^❌/, "seul de son espèce, il ne peut pas évoluer");
    assert.equal(await balance(user), 0);
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
  // `pinned` : l'offre désigne l'individu demandé, comme celles de /pk comparer ;
  // sinon c'est au destinataire de le choisir en acceptant.
  async function trade({ from = "u-from", to = "u-to", expired = false, pinned = false } = {}) {
    await ownMany("Rattata", 2, from);
    const theirs = await ownMany("Roucool", 2, to);
    const id = await call(collection.createTrade, {
      fromUserId: from, toUserId: to, offerSpeciesId: species("Rattata").id, requestSpeciesId: species("Roucool").id, channelId: "123",
      requestPokemonId: pinned ? theirs[0] : null,
    });
    if (expired) await dbRun(points, "UPDATE pokemon_trades SET expires_at = ? WHERE id = ?", [Date.now() - 1, id]);
    return id;
  }
  const status = async (id) => (await dbGet(points, "SELECT status FROM pokemon_trades WHERE id = ?", [id])).status;

  it("accepter une offre qui désigne le Pokémon demandé échange les Pokémon et ferme l'offre", async () => {
    const id = await trade({ pinned: true });
    const calls = await click(`poke_trade_accept|${id}`, { user: "u-to" });
    const update = only(calls, "update");
    assert.equal(await status(id), "ACCEPTED");
    assert.ok(update.components[0].toJSON().components.every((button) => button.disabled), "les boutons sont grisés");
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_owned WHERE user_id = 'u-from' AND species_id = ?", [species("Roucool").id])).length, 1);
  });

  it("accepter une offre qui ne désigne que l'espèce ouvre un menu privé : on y choisit le Pokémon donné", async () => {
    const id = await trade({ from: "p-from", to: "p-to" });
    const owned = await dbAll(points, "SELECT id FROM pokemon_owned WHERE user_id = 'p-to' AND species_id = ? ORDER BY id", [species("Roucool").id]);
    const asked = await click(`poke_trade_accept|${id}`, { user: "p-to" });
    const menu = only(asked, "reply");
    assert.equal(menu.flags, MessageFlags.Ephemeral, "sa boîte ne regarde que lui");
    assert.deepEqual(buttonIds(menu), [`poke_trade_pick|${id}`]);
    assert.equal(await status(id), "PENDING", "rien n'est échangé avant son choix");
    const options = menu.components[0].toJSON().components[0].options;
    assert.deepEqual(options.map((option) => option.value), [`#${owned[1].id}`, `#${owned[0].id}`], "les plus récents d'abord, comme /pk echange");

    const channel = fakeChannel();
    const picked = await click(`poke_trade_pick|${id}`, { user: "p-to", values: [`#${owned[1].id}`], run: handlePokemonSelect, channel });
    assert.match(only(picked, "update").content, /Échange effectué/);
    assert.deepEqual(only(picked, "update").components, []);
    assert.equal(await status(id), "ACCEPTED");
    const row = await dbGet(points, "SELECT user_id FROM pokemon_owned WHERE id = ?", [owned[1].id]);
    assert.equal(row.user_id, "p-from", "le Pokémon choisi est parti");
    // L'offre publique annonce le résultat, avec l'individu qui a vraiment changé de main.
    assert.equal(channel.edited.length, 0, "message_id inconnu : l'éphémère a déjà tout dit");
  });

  it("le menu réécrit le message public de l'offre quand on le connaît, avec le Pokémon choisi", async () => {
    const id = await trade({ from: "q-from", to: "q-to" });
    await dbRun(points, "UPDATE pokemon_trades SET message_id = 'm9' WHERE id = ?", [id]);
    const [, chosen] = await dbAll(points, "SELECT id FROM pokemon_owned WHERE user_id = 'q-to' AND species_id = ? ORDER BY id", [species("Roucool").id]);
    const channel = fakeChannel();
    await click(`poke_trade_pick|${id}`, { user: "q-to", values: [`#${chosen.id}`], run: handlePokemonSelect, channel });
    assert.equal(channel.edited.length, 1);
    assert.equal(channel.edited[0].id, "m9");
    const embed = channel.edited[0].payload.embeds[0].toJSON();
    assert.match(embed.title, /Échange effectué/);
    assert.match(embed.description, new RegExp(`#${chosen.id} Roucool`), "l'individu donné s'affiche, plus « un Roucool »");
    assert.ok(channel.edited[0].payload.components[0].toJSON().components.every((button) => button.disabled));
  });

  it("sans Pokémon libre à donner, le destinataire le lit en privé et l'offre reste ouverte", async () => {
    const id = await trade({ from: "r-from", to: "r-to" });
    await dbRun(points, "DELETE FROM pokemon_owned WHERE id = (SELECT MAX(id) FROM pokemon_owned WHERE user_id = 'r-to')");
    const calls = await click(`poke_trade_accept|${id}`, { user: "r-to" });
    assert.match(only(calls, "reply").content, /Tu n'as aucun Roucool à donner/);
    assert.equal(await status(id), "PENDING");
  });

  it("le menu n'obéit qu'au destinataire, sur une offre encore ouverte, avec un choix lisible", async () => {
    const id = await trade({ from: "s-from", to: "s-to" });
    const [, chosen] = await dbAll(points, "SELECT id FROM pokemon_owned WHERE user_id = 's-to' AND species_id = ? ORDER BY id", [species("Roucool").id]);
    const pick = (user, values) => click(`poke_trade_pick|${id}`, { user, values, run: handlePokemonSelect });
    assert.match(only(await pick("intrus", [`#${chosen.id}`]), "reply").content, /ne t'est pas destiné/);
    assert.match(only(await pick("s-to", ["n'importe quoi"]), "reply").content, /Choisis un Pokémon/);
    assert.equal(await status(id), "PENDING");
    await click(`poke_trade_decline|${id}`, { user: "s-to" });
    assert.match(only(await pick("s-to", [`#${chosen.id}`]), "reply").content, /déjà été traité/);
  });

  it("un choix périmé fait échouer l'offre avec le motif, sans rien déplacer", async () => {
    const id = await trade({ from: "t-from", to: "t-to" });
    const [, chosen] = await dbAll(points, "SELECT id FROM pokemon_owned WHERE user_id = 't-to' AND species_id = ? ORDER BY id", [species("Roucool").id]);
    await dbRun(points, "UPDATE pokemon_owned SET locked = 1 WHERE id = ?", [chosen.id]);
    const calls = await click(`poke_trade_pick|${id}`, { user: "t-to", values: [`#${chosen.id}`], run: handlePokemonSelect });
    assert.match(only(calls, "update").content, /Le Pokémon demandé n'est plus disponible/);
    assert.equal(await status(id), "FAILED");
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_owned WHERE user_id = 't-from' AND species_id = ?", [species("Roucool").id])).length, 0);
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
    const id = await trade({ from: "a5", to: "b5", pinned: true });
    await dbRun(points, "DELETE FROM pokemon_owned WHERE user_id = 'a5' AND id = (SELECT MAX(id) FROM pokemon_owned WHERE user_id = 'a5')");
    const calls = await click(`poke_trade_accept|${id}`, { user: "b5" });
    assert.match(only(calls, "update").content, /Le Pokémon proposé n'est plus disponible/);
    assert.equal(await status(id), "FAILED");
  });
});

describe("la comparaison de /pk comparer", () => {
  const rata = () => species("Rattata").id;
  const chen = () => species("Chenipan").id;
  async function pair() {
    const a = newUser();
    const b = newUser();
    const mine = await ownMany("Rattata", 3, a);
    const theirs = await ownMany("Chenipan", 3, b);
    return { a, b, mine, theirs };
  }
  const rows = (payload) => payload.components.map((row) => row.toJSON());
  const trades = () => dbAll(points, "SELECT * FROM pokemon_trades");
  const choose = (customId, user, value) => click(customId, { user, values: [String(value)], run: handlePokemonSelect });
  const propose = (a, b, { give: given = rata(), get: taken = chen(), ...options } = {}) => click(`poke_cmpgo|${b}|${given}|${taken}|0`, { user: a, ...options });

  it("une page : la comparaison relue, au nom du dresseur comparé, sans texte résiduel", async () => {
    const { a, b } = await pair();
    const update = only(await click(`poke_cmp|${b}|0|0|0|0|next`, { user: a }), "update");
    assert.equal(update.content, null);
    assert.equal(embedOf(update).title, `🔁 Échanges avec Dresseur ${b}`);
    assert.match(embedOf(update).description, /1 échange possible/);
    assert.match(embedOf(update).description, /Rattata/);
  });

  it("la réserve d'évolution voyage dans les boutons : mise de côté avec 1, rendue avec 0", async () => {
    const a = newUser();
    const b = newUser();
    await ownMany("Rattata", 3, a);
    await ownMany("Chenipan", 3, b);
    const description = async (customId) => embedOf(only(await click(customId, { user: a }), "update")).description;
    assert.match(await description(`poke_cmp|${b}|0|0|0|0|next`), /Rattata/);
    assert.doesNotMatch(await description(`poke_cmp|${b}|0|0|1|0|next`), /Rattata/, "il manque Rattatac : les Rattata servent à évoluer");
    assert.match(await description(`poke_cmpt|0|0|next`), new RegExp(`<@${b}>`));
    assert.match(await description(`poke_cmpt|1|0|next`), /Tu n'as aucun doublon à offrir pour l'instant/, "tout est mis de côté : c'est toi qui n'as rien à donner");
    assert.match(await description(`poke_cmpn|${rata()}|0|0|next`), new RegExp(`<@${b}>`));
    const hidden = embedOf(only(await click(`poke_cmpn|${rata()}|1|0|next`, { user: a }), "update"));
    assert.match(hidden.description, /Tu n'en as pas en trop à leur donner/, "mis de côté : rien à donner, mais la liste reste lisible");
    assert.match(hidden.description, new RegExp(`<@${b}>`));
  });

  it("un dresseur parti du serveur se compare quand même : sa collection est toujours là", async () => {
    const a = newUser();
    await ownMany("Rattata", 2, a);
    await ownMany("Chenipan", 2, "gone");
    const update = only(await click("poke_cmp|gone|0|0|0|0|next", { user: a }), "update");
    assert.match(embedOf(update).title, /Échanges avec Dresseur inconnu/);
  });

  it("choisir un côté réécrit le message : l'autre menu et le bouton portent le choix", async () => {
    const { a, b } = await pair();
    const afterGive = only(await choose(`poke_cmpg|${b}|0|0|0`, a, rata()), "update");
    assert.deepEqual(embedOf(afterGive).fields, [{ name: "🤝 Échange choisi", value: "**Rattata** ⇄ *à choisir*" }]);
    const [giveRow, getRow, paging] = rows(afterGive);
    assert.equal(giveRow.components[0].options.find((option) => option.value === String(rata())).default, true, "le choix est coché");
    assert.equal(getRow.components[0].custom_id, `poke_cmpr|${b}|${rata()}|0|0`, "l'autre menu sait déjà ce qui a été choisi");
    assert.equal(paging.components.at(-1).disabled, true, "il manque encore un côté");

    const afterGet = only(await choose(`poke_cmpr|${b}|${rata()}|0|0`, a, chen()), "update");
    assert.deepEqual(embedOf(afterGet).fields, [{ name: "🤝 Échange choisi", value: "**Rattata** ⇄ **Chenipan**" }]);
    const go = rows(afterGet)[2].components.at(-1);
    assert.equal(go.custom_id, `poke_cmpgo|${b}|${rata()}|${chen()}|0`);
    assert.equal(go.disabled, false);
    assert.equal(rows(afterGet)[0].components[0].custom_id, `poke_cmpg|${b}|${chen()}|0|0`, "et le premier menu le sait aussi");
  });

  it("un choix qui n'est pas proposé est écarté, sans rien afficher de faux", async () => {
    const { a, b } = await pair();
    const update = only(await choose(`poke_cmpg|${b}|0|0|0`, a, species("Roucool").id), "update");
    assert.equal(embedOf(update).fields, undefined);
    assert.equal(rows(update)[2].components.at(-1).disabled, true);
  });

  it("proposer : l'offre naît publique, avec le moins précieux de chaque côté, et le clic est acquitté d'abord", async () => {
    const { a, b, mine, theirs } = await pair();
    const channel = fakeChannel();
    const calls = await propose(a, b, { channel });
    assert.equal(calls[0].method, "deferUpdate", "la lecture et la publication peuvent dépasser trois secondes");
    const [trade] = await trades();
    assert.equal(trade.status, "PENDING");
    assert.equal(trade.from_user_id, a);
    assert.equal(trade.to_user_id, b);
    assert.equal(trade.offer_pokemon_id, mine[2], "le plus récent des Rattata, comme le retirerait reserveDuplicates");
    assert.equal(trade.request_pokemon_id, theirs[2]);
    assert.equal(trade.channel_id, "c1");
    assert.equal(trade.message_id, "m1", "le message de l'offre est retenu");

    assert.equal(channel.sent.length, 1);
    const [sent] = channel.sent;
    assert.equal(sent.content, `<@${b}>`);
    assert.deepEqual(sent.allowedMentions, { users: [b] }, "seul le destinataire est mentionné");
    assert.deepEqual(buttonIds(sent), [`poke_trade_accept|${trade.id}`, `poke_trade_decline|${trade.id}`, `poke_trade_cancel|${trade.id}`]);
    assert.equal(embedOf(sent).description, `<@${a}> propose **#${mine[2]} Rattata ♂ (fertile)**\ncontre **#${theirs[2]} Chenipan ♂ (fertile)** de <@${b}>.`, "qui reçoit sait exactement ce qu'il aura");

    const done = last(calls, "editReply");
    assert.equal(done.content, `✅ Offre envoyée à <@${b}> dans <#c1>.`);
    assert.deepEqual([done.embeds, done.components], [[], []], "le message privé n'a plus rien à proposer");
    assert.deepEqual((await dbAll(points, "SELECT id FROM pokemon_owned WHERE user_id = ?", [a])).length, 3, "proposer ne retire rien : seul l'acceptation échange");
  });

  it("de bout en bout : l'offre se répond comme n'importe quelle autre, et les deux Pokédex gagnent une entrée", async () => {
    const { a, b } = await pair();
    await propose(a, b);
    const [{ id }] = await trades();
    const accepted = await click(`poke_trade_accept|${id}`, { user: b });
    assert.ok(only(accepted, "update").components[0].toJSON().components.every((button) => button.disabled));
    assert.equal((await trades())[0].status, "ACCEPTED");
    const dex = async (user) => (await dbAll(points, "SELECT species_id, COUNT(*) AS n FROM pokemon_owned WHERE user_id = ? GROUP BY species_id", [user])).map((row) => [row.species_id, row.n]);
    assert.deepEqual(await dex(a), [[chen(), 1], [rata(), 2]].sort((x, y) => x[0] - y[0]), "a reçoit un Chenipan, et garde ses Rattata");
    assert.deepEqual(await dex(b), [[chen(), 2], [rata(), 1]].sort((x, y) => x[0] - y[0]), "b reçoit un Rattata, et garde ses Chenipan");
  });

  it("un shiny déverrouillé n'est cédé que faute de normal à donner", async () => {
    const a = newUser();
    const b = newUser();
    await ownMany("Chenipan", 2, b);
    await own("Rattata", a, { obtained: 1, locked: 1 });
    await own("Rattata", a, { obtained: 2, shiny: 1, locked: 0 });
    await propose(a, b);
    assert.equal((await trades())[0].offer_is_shiny, 1, "le seul exemplaire libre est shiny : c'est lui qui part, et l'offre le montre");

    await dbRun(points, "DELETE FROM pokemon_trades");
    await own("Rattata", a, { obtained: 3 });
    await propose(a, b);
    assert.equal((await trades())[0].offer_is_shiny, 0, "un normal libre part avant un shiny");
  });

  it("un choix devenu impossible n'envoie rien : la comparaison est réécrite et dit ce qui a changé", async () => {
    const { a, b, theirs } = await pair();
    await dbRun(points, "DELETE FROM pokemon_owned WHERE user_id = ? AND id != ?", [b, theirs[0]]);
    const channel = fakeChannel();
    const calls = await propose(a, b, { channel });
    assert.equal(last(calls, "editReply").content, `⚠️ <@${b}> n'a plus ce Pokémon à donner. Choisis ton échange à nouveau.`);
    assert.equal(channel.sent.length, 0);
    assert.equal((await trades()).length, 0);

    const { a: a2, b: b2, mine } = await pair();
    await dbRun(points, "DELETE FROM pokemon_owned WHERE user_id = ? AND id != ?", [a2, mine[0]]);
    const mineGone = await propose(a2, b2);
    assert.equal(last(mineGone, "editReply").content, "⚠️ Tu n'as plus ce Pokémon à donner. Choisis ton échange à nouveau.");

    const { a: a3, b: b3 } = await pair();
    const nothing = await propose(a3, b3, { give: 0, get: 0 });
    assert.match(last(nothing, "editReply").content, /^⚠️ Ces deux Pokémon ne sont plus proposés/, "un clic fabriqué sans rien choisi");
    assert.equal((await trades()).length, 0);
  });

  it("sans la permission de publier dans le salon : refus privé, rien n'est créé", async () => {
    const { a, b } = await pair();
    const calls = await propose(a, b, { channel: fakeChannel({ allowed: false }) });
    const refusal = last(calls, "followUp");
    assert.equal(refusal.content, "❌ Je ne peux pas publier d'embed dans <#c1>.");
    assert.equal(refusal.flags, EPHEMERAL);
    assert.equal((await trades()).length, 0, "le refus vient avant la création de l'offre");
  });

  it("un salon qui refuse l'envoi, code Discord à l'appui : l'offre est annulée plutôt qu'oubliée dans la base", async () => {
    const { a, b } = await pair();
    const refused = Object.assign(new Error("Missing Permissions"), { code: 50013 });
    const calls = await propose(a, b, { channel: fakeChannel({ sendFails: refused }) });
    assert.equal(last(calls, "followUp").content, "❌ Je n'ai pas pu publier l'offre dans <#c1>. Tu peux réessayer.");
    assert.equal((await trades())[0].status, "CANCELLED");
  });

  it("une coupure pendant l'envoi : l'offre est annulée aussi, avec un avis prudent, et un nouvel essai aboutit", async () => {
    const { a, b } = await pair();
    const calls = await propose(a, b, { channel: fakeChannel({ sendFails: new Error("fetch failed") }) });
    assert.equal(last(calls, "followUp").content, "⚠️ L'envoi a échoué, mais il a peut-être abouti : va voir le salon avant de réessayer.");
    assert.equal((await trades())[0].status, "CANCELLED", "ouverte, une offre sans message bloquerait tout nouvel essai");

    const channel = fakeChannel();
    await propose(a, b, { channel });
    assert.equal(channel.sent.length, 1, "le nouvel essai publie l'offre : l'échec précédent ne l'a pas bloqué");
    assert.deepEqual((await trades()).map((trade) => trade.status), ["CANCELLED", "PENDING"]);
  });

  it("une panne en vérifiant les doublons : l'offre est fermée, rien n'est envoyé, le refus le dit", async () => {
    const { a, b } = await pair();
    const original = points.get;
    points.get = function (sql, ...rest) {
      if (/MIN\(id\) AS first/.test(sql)) return rest.at(-1)(new Error("panne de lecture"));
      return original.call(this, sql, ...rest);
    };
    const channel = fakeChannel();
    try {
      const calls = await propose(a, b, { channel });
      assert.equal(last(calls, "followUp").content, "❌ Impossible de créer l'échange.");
    } finally {
      points.get = original;
    }
    assert.equal(channel.sent.length, 0);
    assert.deepEqual((await trades()).map((trade) => trade.status), ["CANCELLED"], "aucune offre ouverte que personne ne verra");
  });

  it("deux clics rapprochés ne publient qu'une offre : la plus ancienne reste, l'autre se retire et le dit", async () => {
    const { a, b } = await pair();
    const channel = fakeChannel();
    const [first, second] = await Promise.all([propose(a, b, { channel }), propose(a, b, { channel })]);
    const open = (await trades()).filter((trade) => trade.status === "PENDING");
    assert.equal(open.length, 1);
    assert.equal((await trades()).filter((trade) => trade.status === "CANCELLED").length, 1);
    assert.equal(channel.sent.length, 1, "un seul message, une seule mention");
    const refusals = [first, second].flatMap((calls) => calls.filter((entry) => entry.method === "followUp"));
    assert.equal(refusals.length, 1);
    assert.equal(refusals[0].payload.content, `⏳ Tu as déjà proposé cet échange à <@${b}> : il attend sa réponse.`);

    const later = await propose(a, b, { channel });
    assert.match(last(later, "followUp").content, /Tu as déjà proposé cet échange/);
    assert.equal(channel.sent.length, 1, "un troisième clic n'ajoute rien");
    assert.equal((await trades()).filter((trade) => trade.status === "PENDING").length, 1);
  });

  it("une offre refusée ou expirée ne bloque pas une nouvelle proposition des mêmes Pokémon", async () => {
    const { a, b } = await pair();
    await propose(a, b);
    const [{ id }] = await trades();
    await click(`poke_trade_decline|${id}`, { user: b });
    const channel = fakeChannel();
    await propose(a, b, { channel });
    assert.equal(channel.sent.length, 1);
    assert.deepEqual((await trades()).map((trade) => trade.status), ["DECLINED", "PENDING"]);
    await dbRun(points, "UPDATE pokemon_trades SET expires_at = ? WHERE status = 'PENDING'", [Date.now() - 1]);
    await propose(a, b, { channel });
    assert.equal(channel.sent.length, 2, "une offre expirée ne compte plus");
  });

  it("une panne d'écriture : rien n'est envoyé, le refus le dit", async () => {
    const { a, b } = await pair();
    await dbRun(points, "CREATE TRIGGER panne BEFORE INSERT ON pokemon_trades BEGIN SELECT RAISE(ABORT, 'panne'); END");
    const channel = fakeChannel();
    try {
      const calls = await propose(a, b, { channel });
      assert.equal(last(calls, "followUp").content, "❌ Impossible de créer l'échange.");
    } finally {
      await dbRun(points, "DROP TRIGGER panne");
    }
    assert.equal(channel.sent.length, 0);
    assert.equal((await trades()).length, 0);
  });

  it("« avec qui échanger » et « qui a besoin » se relisent à chaque page", async () => {
    const { a, b } = await pair();
    const partners = only(await click("poke_cmpt|0|0|next", { user: a }), "update");
    assert.match(embedOf(partners).description, new RegExp(`<@${b}> · \\*\\*1\\*\\* échange · 🎁 1 · 📥 1`));
    const needers = only(await click(`poke_cmpn|${rata()}|0|0|next`, { user: a }), "update");
    assert.match(embedOf(needers).title, /Qui a besoin de Rattata/);
    assert.match(embedOf(needers).description, new RegExp(`<@${b}> · peut te donner \\*\\*1\\*\\* espèce en retour`));

    const unknown = only(await click("poke_cmpn|99999|0|0|next", { user: a }), "reply");
    assert.equal(unknown.content, "❌ Espèce inconnue.");
    assert.equal(unknown.flags, EPHEMERAL);

    await dbRun(points, "DELETE FROM pokemon_owned WHERE user_id = ?", [a]);
    const unowned = embedOf(only(await click(`poke_cmpn|${rata()}|0|0|next`, { user: a }), "update"));
    assert.match(unowned.description, new RegExp(`<@${b}>`), "une espèce qu'on ne possède plus se cherche encore");
    assert.doesNotMatch(unowned.description, /en retour/);
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
    await Promise.all(ids.map((id, index) => dbRun(points, "UPDATE pokemon_owned SET showcase_pos = ? WHERE id = ?", [index + 1, id])));
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
