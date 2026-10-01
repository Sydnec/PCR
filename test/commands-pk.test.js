// Les commandes Discord : leur déclaration (ce que Discord accepte à
// l'enregistrement — un seul champ trop long et TOUTES les commandes sont
// refusées au démarrage) et le jeu sous /pk, sous-commande par sous-commande.
// Ce que fait le jeu lui-même est vérifié ailleurs : ici, on vérifie ce que la
// commande en dit au dresseur — éphémère ou public, tutoiement, chiffres des
// refus — et que ses boutons mènent bien quelque part.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MessageFlags } from "discord.js";
import { createSandbox, openDatabases, dbRun, dbAll, dbGet, speciesByName, withRandom } from "./helpers.js";
import { fakeUser, runCommand, runAutocomplete, payloadOf, lastOf, textOf } from "./fake-discord.js";

const sandbox = createSandbox({ config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } } });
process.env.POKEMON_CHANNEL_ID = "123";
const { points } = await openDatabases();
const data = await import("../modules/pokemon/data.js");
const items = await import("../modules/pokemon/items.js");
const economy = await import("../modules/economy.js");
const collection = await import("../modules/pokemon/collection.js");
const { getPokemonConfig, getSafariConfig } = await import("../modules/pokemon/config.js");
const pk = (await import("../commands/pk.js")).default;
const sub = async (name) => (await import(`../commands/pk/${name}.js`)).default;

const GEN1 = { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } };
const EPHEMERAL = MessageFlags.Ephemeral;
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const species = (name) => speciesByName(data.allSpecies, name);
const call = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value))));
const setBalance = (amount, user = "u1") =>
  dbRun(points, "INSERT INTO points (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = ?", [user, amount, amount]);
const balance = (user = "u1") => call(economy.getBalance, user);
const grant = (key, quantity, user = "u1") => call(items.grantItem, user, key, quantity, { source: "test" });
async function own(name, { user = "u1", shiny = 0, sex = "M", obtained = 1, locked = 0, sterile = 0 } = {}) {
  const { lastID } = await dbRun(
    points,
    "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at, locked, sterile) VALUES (?, ?, ?, ?, 'test', ?, ?, ?)",
    [user, species(name).id, shiny, sex, obtained, locked, sterile]
  );
  return lastID;
}
const ownMany = async (name, quantity, options = {}) => {
  const ids = [];
  for (let index = 0; index < quantity; index++) ids.push(await own(name, { obtained: index + 1, ...options }));
  return ids;
};

beforeEach(async () => {
  for (const table of [
    "points", "pokemon_owned", "pokemon_inventory", "pokemon_item_log", "pokemon_lottery", "pokemon_trades", "pokemon_eggs",
    "pokemon_safari_sessions", "pokemon_safari_parks", "pokemon_showcase_shares", "pokemon_sales", "points_log",
  ]) {
    await dbRun(points, `DELETE FROM ${table}`);
  }
  sandbox.writeConfig(GEN1);
});

// ====================== LA DÉCLARATION ======================

const commandFiles = fs.readdirSync(path.join(ROOT, "commands")).filter((file) => file.endsWith(".js"));
const NAME = /^[-_\p{L}\p{N}]{1,32}$/u;

// Les règles de Discord, rappelées une fois : au-delà, c'est l'enregistrement de
// toutes les commandes qui échoue.
function checkOption(option, where, problems) {
  if (!NAME.test(option.name) || option.name !== option.name.toLowerCase()) problems.push(`${where} : nom « ${option.name} » invalide`);
  if (!option.description || option.description.length > 100) problems.push(`${where} : description de ${option.description?.length ?? 0} caractères`);
  if (option.choices && option.choices.length > 25) problems.push(`${where} : ${option.choices.length} choix`);
  if (option.autocomplete && option.choices) problems.push(`${where} : autocomplétion et choix ensemble`);
  const children = option.options ?? [];
  if (children.length > 25) problems.push(`${where} : ${children.length} options`);
  const required = children.filter((child) => child.type > 2).map((child) => Boolean(child.required));
  if (required.some((flag, index) => flag && required.slice(0, index).includes(false))) problems.push(`${where} : une option obligatoire suit une facultative`);
  for (const child of children) checkOption(child, `${where} ${child.name}`, problems);
}

describe("la déclaration des commandes", () => {
  it("chaque fichier de commands/ se charge, avec de quoi se déclarer et s'exécuter", async () => {
    for (const file of commandFiles) {
      const module = await import(`../commands/${file}`);
      const command = module.default || module;
      assert.ok(command.data?.toJSON, `${file} : pas de data`);
      assert.equal(typeof command.execute, "function", `${file} : pas d'execute`);
    }
  });

  it("aucun nom n'est pris deux fois, et Discord accepte chaque commande", async () => {
    const names = new Set();
    const problems = [];
    for (const file of commandFiles) {
      const command = (await import(`../commands/${file}`)).default;
      const json = command.data.toJSON();
      assert.ok(!names.has(json.name), `${json.name} est déclarée deux fois`);
      names.add(json.name);
      checkOption(json, `/${json.name}`, problems);
      assert.ok(JSON.stringify(json).length < 8000, `/${json.name} dépasse 8 000 caractères`);
    }
    assert.deepEqual(problems, []);
  });

  it("toutes les sous-commandes du jeu sont câblées au routeur /pk, et rien d'autre", async () => {
    const files = fs.readdirSync(path.join(ROOT, "commands/pk")).map((file) => file.replace(/\.js$/, "")).sort();
    const declared = pk.data.toJSON().options.map((option) => option.name).sort();
    assert.deepEqual(declared, files);
    assert.equal(declared.length, 16);
  });

  it("toutes les commandes d'administration sont câblées au routeur /admin", async () => {
    const admin = (await import("../commands/admin.js")).default;
    const files = fs.readdirSync(path.join(ROOT, "commands/admin")).map((file) => file.replace(/\.js$/, "")).sort();
    assert.deepEqual(admin.data.toJSON().options.map((option) => option.name).sort(), files);
  });

  it("une sous-commande dont une option s'autocomplète sait le faire", async () => {
    for (const option of pk.data.toJSON().options) {
      const module = await sub(option.name);
      const needs = (list) => list.some((child) => child.autocomplete || needs(child.options ?? []));
      if (needs(option.options ?? [])) assert.equal(typeof module.autocomplete, "function", `/pk ${option.name}`);
    }
  });

  it("les commandes d'administration se cachent aux non-administrateurs", async () => {
    const admin = (await import("../commands/admin.js")).default.data.toJSON();
    assert.equal(admin.default_member_permissions, String(0x8), "permission Administrateur");
  });

  it("chaque bouton du jeu (poke_*) posé dans le code a son cas dans le routeur", () => {
    const sources = ["modules/pokemon", "commands/pk"].flatMap((dir) =>
      fs.readdirSync(path.join(ROOT, dir)).filter((file) => file.endsWith(".js")).map((file) => path.join(ROOT, dir, file))
    );
    const used = new Set();
    for (const file of sources) {
      for (const match of fs.readFileSync(file, "utf8").matchAll(/setCustomId\(\s*[`"](poke_[a-z_]+)/g)) used.add(match[1]);
    }
    const router = fs.readFileSync(path.join(ROOT, "modules/pokemon/interactions.js"), "utf8");
    const missing = [...used].filter((id) => !router.includes(`"${id}"`));
    assert.deepEqual(missing, [], "un bouton sans cas répondrait « l'interaction a échoué »");
    assert.ok(used.size >= 15, `${used.size} boutons trouvés : le scan doit en voir beaucoup`);
  });

  it("les clics du jeu et ceux de ses menus sont bien envoyés au routeur du jeu", () => {
    const router = fs.readFileSync(path.join(ROOT, "events/client/interactionCreate.js"), "utf8");
    assert.match(router, /customId\.startsWith\('poke_'\)[\s\S]{0,200}handlePokemonButton/);
    assert.match(router, /isStringSelectMenu[\s\S]{0,200}startsWith\('poke_'\)[\s\S]{0,200}handlePokemonSelect/);
  });
});

// ====================== LE ROUTEUR /pk ======================

describe("le routeur /pk", () => {
  it("une sous-commande inconnue répond, au lieu de laisser Discord dire « sans réponse »", async () => {
    const calls = await runCommand(pk, { sub: "n_existe_pas" });
    const reply = payloadOf(calls, "reply");
    assert.match(reply.content, /`n_existe_pas` est introuvable/);
    assert.equal(reply.flags, EPHEMERAL);
  });

  it("un groupe se reconnaît à son nom de groupe", async () => {
    const calls = await runCommand(pk, { group: "vitrine", sub: "voir", options: {} });
    assert.match(payloadOf(calls, "reply").content, /Ta vitrine est vide/);
  });

  it("l'autocomplétion d'une sous-commande qui n'en a pas rend une liste vide", async () => {
    const calls = await runAutocomplete(pk, { sub: "classement", focused: { name: "x", value: "" } });
    assert.deepEqual(payloadOf(calls, "respond"), []);
  });

  it("une erreur dans une sous-commande est journalisée, jamais propagée", async () => {
    const { slash } = await import("./fake-discord.js");
    const { interaction } = slash({ sub: "classement" });
    interaction.deferReply = async () => {
      throw new Error("Discord ne répond pas");
    };
    const original = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args.join(" "));
    try {
      await pk.execute(interaction, {});
    } finally {
      console.error = original;
    }
    assert.ok(logged.some((line) => line.includes("Discord ne répond pas")), "l'erreur est journalisée");
  });
});

// ====================== LECTURES ======================

describe("/pk pokedex et /pk boite", () => {
  it("le Pokédex répond en privé : différé, puis l'embed avec ses boutons", async () => {
    await ownMany("Rattata", 2);
    const calls = await runCommand(pk, { sub: "pokedex" });
    assert.deepEqual(payloadOf(calls, "deferReply"), { flags: EPHEMERAL });
    const reply = payloadOf(calls, "editReply");
    assert.match(textOf(reply), /Pokédex de user-u1/);
    assert.equal(reply.components.length, 1);
  });

  it("le Pokédex d'un autre dresseur se lit par son option", async () => {
    await own("Roucool", { user: "u2" });
    const calls = await runCommand(pk, { sub: "pokedex", users: { membre: fakeUser("u2") } });
    assert.match(textOf(payloadOf(calls, "editReply")), /Pokédex de user-u2/);
  });

  it("la boîte : privée, filtrée par espèce quand on le demande", async () => {
    await ownMany("Rattata", 2);
    await own("Roucool");
    const all = payloadOf(await runCommand(pk, { sub: "boite" }), "reply");
    assert.equal(all.flags, EPHEMERAL);
    assert.match(textOf(all), /Roucool/);
    const filtered = payloadOf(await runCommand(pk, { sub: "boite", options: { pokemon: String(species("Rattata").id) } }), "reply");
    assert.doesNotMatch(textOf(filtered), /Roucool/);
  });

  it("une espèce tapée à la main qui n'existe pas est refusée en privé", async () => {
    const reply = payloadOf(await runCommand(pk, { sub: "boite", options: { pokemon: "99999" } }), "reply");
    assert.match(reply.content, /Choisis une proposition dans la liste d'autocomplétion/);
    assert.equal(reply.flags, EPHEMERAL);
  });

  it("l'autocomplétion de la boîte propose les espèces possédées, avec leur nombre, filtrées par la saisie", async () => {
    await ownMany("Rattata", 3);
    await own("Roucool");
    const all = payloadOf(await runAutocomplete(pk, { sub: "boite", focused: { name: "pokemon", value: "" } }), "respond");
    assert.deepEqual(all.map((choice) => choice.name).sort(), ["Rattata (×3)", "Roucool (×1)"]);
    const filtered = payloadOf(await runAutocomplete(pk, { sub: "boite", focused: { name: "pokemon", value: "rat" } }), "respond");
    assert.deepEqual(filtered.map((choice) => choice.value), [String(species("Rattata").id)]);
  });

  it("l'autocomplétion lit la boîte du membre visé par sa valeur brute, pas par un objet résolu", async () => {
    await own("Roucool", { user: "u2" });
    const choices = payloadOf(await runAutocomplete(pk, { sub: "boite", options: { membre: "u2" }, focused: { name: "pokemon", value: "" } }), "respond");
    assert.deepEqual(choices.map((choice) => choice.name), ["Roucool (×1)"]);
  });
});

describe("/pk classement, info, inventaire, web", () => {
  it("le classement : sans personne, un message ; avec des dresseurs, médailles, shiny et captures", async () => {
    assert.match(lastOf(await runCommand(pk, { sub: "classement" }), "editReply").content, /Aucun Pokémon n'a encore été capturé/);
    await ownMany("Rattata", 2, { user: "u2" });
    await own("Roucool", { user: "u2", shiny: 1, obtained: 5 });
    await own("Rattata", { user: "u3" });
    const text = textOf(payloadOf(await runCommand(pk, { sub: "classement" }), "editReply"));
    assert.match(text, /🥇 \*\*user-u2\*\* — 2\/151 espèces · ✨ 1 · 3 captures/);
    assert.match(text, /🥈 \*\*user-u3\*\* — 1\/151 espèces · 1 captures/);
  });

  it("la fiche d'une espèce est privée ; une espèce inconnue est refusée", async () => {
    const ok = payloadOf(await runCommand(pk, { sub: "info", options: { pokemon: String(species("Roucool").id) } }), "reply");
    assert.equal(ok.flags, EPHEMERAL);
    assert.match(textOf(ok), /Roucool/);
    const unknown = payloadOf(await runCommand(pk, { sub: "info", options: { pokemon: "99999" } }), "reply");
    assert.match(unknown.content, /Pokémon inconnu/);
  });

  it("une espèce d'une génération fermée, tapée à la main, est refusée", async () => {
    const closed = data.allSpeciesData().find((entry) => entry.generation === 2);
    const reply = payloadOf(await runCommand(pk, { sub: "info", options: { pokemon: String(closed.id) } }), "reply");
    assert.match(reply.content, /Pokémon inconnu/);
  });

  it("l'autocomplétion de /pk info cherche par nom, avec le numéro du Pokédex", async () => {
    const choices = payloadOf(await runAutocomplete(pk, { sub: "info", focused: { name: "pokemon", value: "roucool" } }), "respond");
    assert.ok(choices.length >= 1);
    assert.match(choices[0].name, /#\d+ Roucool/);
    assert.equal(choices[0].value, String(species("Roucool").id));
    assert.ok(payloadOf(await runAutocomplete(pk, { sub: "info", focused: { name: "pokemon", value: "" } }), "respond").length <= 25);
  });

  it("l'inventaire : privé, tutoie le dresseur, et dit les objets d'un autre à la troisième personne", async () => {
    await grant("ball_super", 2);
    const mine = payloadOf(await runCommand(pk, { sub: "inventaire" }), "reply");
    assert.equal(mine.flags, EPHEMERAL);
    assert.match(textOf(mine), /Super Ball|Super/);
    await grant("pepite", 1, "u2");
    const theirs = payloadOf(await runCommand(pk, { sub: "inventaire", users: { membre: fakeUser("u2") } }), "reply");
    assert.match(textOf(theirs), /Pépite/);
  });

  it("le jeu désactivé ferme l'inventaire, la loterie, la revente, la vitrine, les œufs et le safari", async () => {
    sandbox.writeConfig({ pokemon: { ...GEN1.pokemon, enabled: false } });
    for (const [sub, group] of [["inventaire"], ["loterie"], ["safari"], ["pondre", "oeuf"], ["pokemon", "revendre"], ["voir", "vitrine"]]) {
      const reply = payloadOf(await runCommand(pk, { sub: group ? sub : sub, group: group ?? null, options: {} }), "reply");
      assert.match(reply.content, /désactivé|fermé/, `${group ?? sub}`);
      assert.equal(reply.flags, EPHEMERAL);
    }
  });

  it("/pk web : le site n'est pas en ligne dans ce processus, et la commande le dit", async () => {
    const reply = payloadOf(await runCommand(pk, { sub: "web" }), "reply");
    assert.match(reply.content, /Le site n'est pas en ligne pour le moment/);
    assert.equal(reply.flags, EPHEMERAL);
  });
});

describe("/pk loterie", () => {
  it("un gain s'affiche en privé, puis « déjà joué » avec l'heure du prochain tirage", async () => {
    const first = await withRandom([0, 0, 0], () => runCommand(pk, { sub: "loterie" }));
    assert.deepEqual(payloadOf(first, "deferReply"), { flags: EPHEMERAL });
    assert.ok(payloadOf(first, "editReply").embeds.length === 1);
    const second = payloadOf(await runCommand(pk, { sub: "loterie" }), "editReply");
    assert.match(textOf(second), /<t:\d+:[a-zA-Z]>/, "l'heure du prochain tirage");
  });

  it("des mains vides sont une issue de la loterie, pas une erreur", async () => {
    const calls = await withRandom([0.999], () => runCommand(pk, { sub: "loterie" }));
    assert.equal(payloadOf(calls, "editReply").embeds.length, 1);
  });

  it("une loterie fermée par la configuration le dit sans embed", async () => {
    sandbox.writeConfig({ pokemon: { ...GEN1.pokemon, lottery: { enabled: false } } });
    const calls = await runCommand(pk, { sub: "loterie" });
    assert.match(payloadOf(calls, "editReply").content, /^❌ La loterie est fermée/);
  });
});

describe("/pk doublons", () => {
  it("les doublons du dresseur : privés, avec leurs boutons", async () => {
    await ownMany("Rattata", 3);
    const calls = await runCommand(pk, { sub: "doublons" });
    assert.deepEqual(payloadOf(calls, "deferReply"), { flags: EPHEMERAL });
    const reply = payloadOf(calls, "editReply");
    assert.match(textOf(reply), /Rattata/);
    assert.equal(reply.components.length, 1);
  });

  it("avec l'option « évolutions », ce qu'il faut pour compléter le Pokédex est mis de côté", async () => {
    await ownMany("Rattata", 3);
    const reply = payloadOf(await runCommand(pk, { sub: "doublons", options: { evolutions: true } }), "editReply");
    assert.doesNotMatch(textOf(reply), /Rattata ×/);
  });

  it("avec une espèce : qui l'a en double", async () => {
    await ownMany("Rattata", 3, { user: "u2" });
    const reply = payloadOf(await runCommand(pk, { sub: "doublons", options: { pokemon: String(species("Rattata").id) } }), "editReply");
    assert.match(textOf(reply), /u2/);
  });

  it("une espèce illisible est refusée avant de différer", async () => {
    const calls = await runCommand(pk, { sub: "doublons", options: { pokemon: "99999" } });
    assert.match(payloadOf(calls, "reply").content, /Choisis une espèce dans la liste d'autocomplétion/);
    assert.ok(!calls.some((entry) => entry.method === "deferReply"));
  });

  it("l'autocomplétion dit explicitement quand rien ne correspond", async () => {
    const empty = payloadOf(await runAutocomplete(pk, { sub: "doublons", focused: { name: "pokemon", value: "zzzzzz" } }), "respond");
    assert.deepEqual(empty, [{ name: "Aucune espèce ne correspond", value: "—" }]);
  });
});

// ====================== ACTIONS ======================

describe("/pk verrou", () => {
  const lock = (id, name = "Rattata") => runCommand(pk, { sub: "verrou", options: { espece: String(species(name).id), individu: `#${id}` } });

  it("bascule le verrou et le dit, avec ce que ça change", async () => {
    const [id] = await ownMany("Rattata", 2);
    const on = payloadOf(await lock(id), "reply");
    assert.match(on.content, /est verrouillé : il ne sera ni revendu, ni échangé, ni sacrifié/);
    assert.equal(on.flags, EPHEMERAL);
    const off = payloadOf(await lock(id), "reply");
    assert.match(off.content, /est déverrouillé/);
    assert.equal((await dbGet(points, "SELECT locked FROM pokemon_owned WHERE id = ?", [id])).locked, 0);
  });

  it("le Pokémon d'un autre, ou d'une autre espèce : refus en privé, rien ne bouge", async () => {
    const stranger = await own("Rattata", { user: "u2" });
    const refused = payloadOf(await lock(stranger), "reply");
    assert.match(refused.content, /^❌ .*n'est pas dans cette boîte/);
    assert.equal((await dbGet(points, "SELECT locked FROM pokemon_owned WHERE id = ?", [stranger])).locked, 0);
    const [mine] = await ownMany("Roucool", 1);
    assert.match(payloadOf(await lock(mine, "Rattata"), "reply").content, /n'est pas un Rattata/);
  });

  it("l'autocomplétion se fait en deux temps : l'espèce, puis les individus de cette espèce", async () => {
    await ownMany("Rattata", 2);
    await own("Rattata", { locked: 1, obtained: 5 });
    const species1 = payloadOf(await runAutocomplete(pk, { sub: "verrou", focused: { name: "espece", value: "" } }), "respond");
    assert.deepEqual(species1.map((choice) => choice.name), ["Rattata (×3, dont 1 🛡️)"]);
    const individuals = payloadOf(await runAutocomplete(pk, { sub: "verrou", options: { espece: String(species("Rattata").id) }, focused: { name: "individu", value: "" } }), "respond");
    assert.equal(individuals.length, 3);
    assert.ok(individuals.some((choice) => choice.name.includes("verrouillé")));
    const noSpecies = payloadOf(await runAutocomplete(pk, { sub: "verrou", focused: { name: "individu", value: "" } }), "respond");
    assert.match(noSpecies[0].name, /Choisis d'abord l'espèce/);
  });
});

describe("/pk revendre", () => {
  const sellPokemon = (options) => runCommand(pk, { group: "revendre", sub: "pokemon", options });
  const sellItem = (options) => runCommand(pk, { group: "revendre", sub: "objet", options });

  it("des Pokémon d'une espèce : les normaux partent, un reste, le prix est crédité", async () => {
    await ownMany("Rattata", 3);
    const calls = await sellPokemon({ espece: String(species("Rattata").id), quantite: 2 });
    assert.deepEqual(payloadOf(calls, "deferReply"), { flags: EPHEMERAL });
    const reply = payloadOf(calls, "editReply").content;
    assert.match(reply, /^✅ Tu revends \*\*2× Rattata[^*]*\*\* pour \*\*[\d\s]+\*\* points\.$/);
    assert.ok((await balance()) > 0);
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_owned")).length, 1);
  });

  it("le dernier de l'espèce ne part pas : refus avec les chiffres", async () => {
    await ownMany("Rattata", 2);
    const reply = payloadOf(await sellPokemon({ espece: String(species("Rattata").id), quantite: 2 }), "editReply").content;
    assert.match(reply, /^❌ /);
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_owned")).length, 2);
    assert.equal(await balance(), 0);
  });

  it("un individu précis se choisit un par un ; un shiny ne se revend pas, et le refus le dit", async () => {
    const normal = await own("Rattata", { obtained: 1 });
    const spare = await own("Rattata", { obtained: 2 });
    const shiny = await own("Rattata", { shiny: 1, obtained: 3 });
    const refused = payloadOf(await sellPokemon({ espece: String(species("Rattata").id), individu: `#${shiny}` }), "editReply").content;
    assert.match(refused, /^❌ /);
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_owned")).length, 3, "le shiny reste dans la boîte");
    assert.equal(await balance(), 0);

    const sold = payloadOf(await sellPokemon({ espece: String(species("Rattata").id), individu: `#${spare}` }), "editReply").content;
    assert.match(sold, /^✅ Tu revends \*\*1× Rattata/);
    assert.deepEqual((await dbAll(points, "SELECT id FROM pokemon_owned ORDER BY id")).map((row) => row.id), [normal, shiny]);
    assert.ok((await balance()) > 0);
  });

  it("la proposition « rien à revendre » n'est pas une saisie : refus avant de différer", async () => {
    const calls = await sellPokemon({ espece: "—" });
    assert.match(payloadOf(calls, "reply").content, /Choisis une proposition dans la liste d'autocomplétion/);
    const item = await sellItem({ objet: "—" });
    assert.match(payloadOf(item, "reply").content, /Choisis une proposition/);
  });

  it("une espèce tapée à la main qui n'existe pas est refusée", async () => {
    const reply = payloadOf(await sellPokemon({ espece: "99999" }), "editReply").content;
    assert.match(reply, /Choisis une proposition dans la liste d'autocomplétion/);
  });

  it("des objets : le prix à la pièce, crédité, et l'inventaire diminue", async () => {
    await grant("pepite", 3);
    const reply = payloadOf(await sellItem({ objet: "pepite", quantite: 2 }), "editReply").content;
    assert.match(reply, /^✅ Tu revends .*\*\*2× Pépite\*\* pour \*\*[\d\s]+\*\* points\.$/);
    assert.equal(await call(items.getItemCount, "u1", "pepite"), 1);
    assert.ok((await balance()) > 0);
  });

  it("un objet qui ne se revend pas, ou qu'on n'a pas en assez grand nombre : refus avec les chiffres", async () => {
    await grant("pepite", 1);
    const short = payloadOf(await sellItem({ objet: "pepite", quantite: 5 }), "editReply").content;
    assert.match(short, /^❌ /);
    assert.equal(await call(items.getItemCount, "u1", "pepite"), 1);
    assert.match(payloadOf(await sellItem({ objet: "ticket_safari" }), "editReply").content, /^❌ /);
  });

  it("l'autocomplétion des objets annonce le prix à la pièce, sans proposer ce qui ne se vend pas", async () => {
    await grant("pepite", 2);
    await grant("ticket_safari", 1);
    const choices = payloadOf(await runAutocomplete(pk, { group: "revendre", sub: "objet", focused: { name: "objet", value: "" } }), "respond");
    assert.ok(choices.some((choice) => choice.value === "pepite" && /×2 — [\d\s]+ pts pièce/.test(choice.name)));
  });

  it("l'autocomplétion des espèces : les doublons et le prix ; vide, une proposition qui l'explique", async () => {
    const empty = payloadOf(await runAutocomplete(pk, { group: "revendre", sub: "pokemon", focused: { name: "espece", value: "" } }), "respond");
    assert.deepEqual(empty, [{ name: "Tu n'as rien à revendre pour le moment", value: "—" }]);
    await ownMany("Rattata", 3);
    const filled = payloadOf(await runAutocomplete(pk, { group: "revendre", sub: "pokemon", focused: { name: "espece", value: "" } }), "respond");
    assert.match(filled[0].name, /^Rattata — 2 en trop, [\d\s]+ pts pièce$/);
    const noSpecies = payloadOf(await runAutocomplete(pk, { group: "revendre", sub: "pokemon", focused: { name: "individu", value: "" } }), "respond");
    assert.match(noSpecies[0].name, /Choisis d'abord l'espèce/);
  });
});

describe("/pk vitrine", () => {
  const showcase = (subName, options = {}, extra = {}) => runCommand(pk, { group: "vitrine", sub: subName, options, ...extra });

  it("une vitrine vide le dit, avec la commande pour l'emplir et le nombre de places", async () => {
    const reply = payloadOf(await showcase("voir"), "reply");
    assert.match(reply.content, new RegExp(`jusqu'à ${getPokemonConfig().showcase.slots} Pokémon avec \`/pk vitrine ajouter\``));
    assert.equal(reply.flags, EPHEMERAL);
  });

  it("expose un Pokémon, puis le montre : titre avec le compte, bouton de partage", async () => {
    const [id] = await ownMany("Rattata", 2);
    const added = await showcase("ajouter", { espece: String(species("Rattata").id), individu: `#${id}` });
    const reply = lastOf(added, "editReply");
    assert.match(reply.content ?? JSON.stringify(reply), /rejoint ta vitrine/);
    assert.match(JSON.stringify(reply), new RegExp(`Ta vitrine · 1/${getPokemonConfig().showcase.slots}`));
    assert.ok(JSON.stringify(reply.components?.map((row) => row.toJSON())).includes("poke_showcase_share"), "sa propre vitrine porte le bouton de partage");
  });

  it("déjà exposé sans place demandée : refus qui dit comment le déplacer", async () => {
    const [id] = await ownMany("Rattata", 2);
    await showcase("ajouter", { espece: String(species("Rattata").id), individu: `#${id}` });
    const again = payloadOf(await showcase("ajouter", { espece: String(species("Rattata").id), individu: `#${id}` }), "reply");
    assert.match(again.content, /est déjà dans ta vitrine\. Pour le changer de place, précise l'option « place »/);
  });

  it("avec une place, un Pokémon déjà exposé change de place", async () => {
    const [a, b] = await ownMany("Rattata", 2);
    for (const id of [a, b]) await showcase("ajouter", { espece: String(species("Rattata").id), individu: `#${id}` });
    const moved = await showcase("ajouter", { espece: String(species("Rattata").id), individu: `#${b}`, place: 1 });
    assert.match(JSON.stringify(lastOf(moved, "editReply")), /change de place/);
    assert.deepEqual((await call(collection.getIndividual, b)).showcase_pos, 1);
  });

  it("retirer : dit s'il y était, et la vitrine est relue ensuite", async () => {
    const [id] = await ownMany("Rattata", 2);
    await showcase("ajouter", { espece: String(species("Rattata").id), individu: `#${id}` });
    const removed = await showcase("retirer", { pokemon: `#${id}` });
    assert.match(payloadOf(removed, "reply").content, /quitte ta vitrine/);
    assert.match(payloadOf(await showcase("retirer", { pokemon: `#${id}` }), "reply").content, /n'est pas dans ta vitrine/);
    assert.match(payloadOf(await showcase("retirer", { pokemon: "n'importe quoi" }), "reply").content, /Choisis le Pokémon dans la liste d'autocomplétion/);
  });

  it("voir la vitrine d'un autre : son nom, sans bouton de partage ; les bots n'en ont pas", async () => {
    const id = await own("Rattata", { user: "u2" });
    await dbRun(points, "UPDATE pokemon_owned SET showcase_pos = 1 WHERE id = ?", [id]);
    const calls = await showcase("voir", {}, { users: { membre: fakeUser("u2", { username: "Sacha" }) } });
    const reply = lastOf(calls, "editReply");
    assert.match(JSON.stringify(reply), /Vitrine de Nom u2/);
    assert.ok(!JSON.stringify(reply.components?.map((row) => row.toJSON()) ?? []).includes("poke_showcase_share"));
    const bot = payloadOf(await showcase("voir", {}, { users: { membre: fakeUser("b1", { bot: true }) } }), "reply");
    assert.match(bot.content, /Les bots n'exposent pas de Pokémon/);
  });

  it("l'autocomplétion de la vitrine propose les Pokémon exposés, ou dit qu'elle est vide", async () => {
    const empty = payloadOf(await runAutocomplete(pk, { group: "vitrine", sub: "retirer", focused: { name: "pokemon", value: "" } }), "respond");
    assert.deepEqual(empty, [{ name: "Ta vitrine est vide", value: "—" }]);
    const [id] = await ownMany("Rattata", 2);
    await showcase("ajouter", { espece: String(species("Rattata").id), individu: `#${id}` });
    const filled = payloadOf(await runAutocomplete(pk, { group: "vitrine", sub: "retirer", focused: { name: "pokemon", value: String(id) } }), "respond");
    assert.deepEqual(filled.map((choice) => choice.value), [`#${id}`]);
  });
});

describe("/pk comparer", () => {
  const compare = (options = {}, users = {}, extra = {}) => runCommand(pk, { sub: "comparer", options, users, ...extra });
  const partner = (id = "u2") => ({ membre: fakeUser(id) });
  const rowsOf = (payload) => payload.components.map((row) => row.toJSON());
  const idsOf = (payload) => rowsOf(payload).flatMap((row) => row.components.map((component) => component.custom_id));

  it("deux dresseurs : privé, ce que chacun peut donner, et un bouton pour proposer", async () => {
    await ownMany("Rattata", 2);
    await ownMany("Chenipan", 2, { user: "u2" });
    const calls = await compare({ evolutions: false }, partner());
    assert.deepEqual(payloadOf(calls, "deferReply"), { flags: EPHEMERAL });
    const reply = payloadOf(calls, "editReply");
    const text = textOf(reply);
    assert.match(text, /Échanges avec Dresseur u2/);
    assert.match(text, /1 échange possible/);
    assert.match(text, /Tu peux donner.*Rattata/);
    assert.match(text, /Tu peux recevoir.*Chenipan/);

    const [giveRow, getRow, buttons] = rowsOf(reply);
    assert.equal(giveRow.components[0].custom_id, "poke_cmpg|u2|0|0|0");
    assert.equal(getRow.components[0].custom_id, "poke_cmpr|u2|0|0|0");
    assert.deepEqual(giveRow.components[0].options.map((option) => [option.label, option.value, option.description]), [["Rattata", String(species("Rattata").id), "1 peut partir"]]);
    const go = buttons.components.at(-1);
    assert.equal(go.custom_id, "poke_cmpgo|u2|0|0|0");
    assert.equal(go.label, "Proposer cet échange");
    assert.equal(go.disabled, true, "rien n'est encore choisi");
    assert.equal(rowsOf(reply).length, 3);
  });

  it("sans échange possible, seule la liste s'affiche : rien à choisir, et le refus dit pourquoi", async () => {
    await ownMany("Rattata", 2);
    await own("Roucool", { user: "u2" });
    const oneSided = payloadOf(await compare({ evolutions: false }, partner()), "editReply");
    assert.match(textOf(oneSided), /tu as de quoi compléter le Pokédex de <@u2>, qui n'a aucun doublon qui te manque/);
    assert.deepEqual(oneSided.components, [], "ni menu ni bouton");

    await dbRun(points, "DELETE FROM pokemon_owned");
    await own("Rattata");
    await ownMany("Chenipan", 2, { user: "u2" });
    const otherWay = payloadOf(await compare({ evolutions: false }, partner()), "editReply");
    assert.match(textOf(otherWay), /<@u2> a de quoi compléter ton Pokédex, mais tu n'as aucun doublon qui lui manque/);
    assert.deepEqual(otherWay.components, []);

    await dbRun(points, "DELETE FROM pokemon_owned");
    await own("Rattata");
    await own("Chenipan", { user: "u2" });
    const neither = payloadOf(await compare({ evolutions: false }, partner()), "editReply");
    assert.match(textOf(neither), /Aucun échange possible : ni toi ni <@u2> n'avez de doublon qui manque à l'autre/);
    assert.deepEqual(neither.components, []);
  });

  it("l'option « évolutions » est active par défaut, et la désactiver rend ce qui était mis de côté", async () => {
    await ownMany("Rattata", 3);
    await ownMany("Ronflex", 2);
    await ownMany("Kangourex", 2, { user: "u2" });
    const byDefault = payloadOf(await compare({}, partner()), "editReply");
    assert.match(textOf(byDefault), /Ronflex/);
    assert.doesNotMatch(textOf(byDefault), /Rattata/, "il manque Rattatac : ses Rattata sont mis de côté");
    assert.match(textOf(byDefault), /🧬/, "la note dit ce qui est mis de côté");
    assert.ok(idsOf(byDefault).includes("poke_cmpg|u2|0|1|0"), "la réserve (1) voyage dans les menus");
    const raw = payloadOf(await compare({ evolutions: false }, partner()), "editReply");
    assert.ok(idsOf(raw).includes("poke_cmpg|u2|0|0|0"), "et son absence (0) aussi");
    assert.match(textOf(raw), /Rattata/);
    assert.doesNotMatch(textOf(raw), /🧬/);
  });

  it("un shiny déverrouillé est proposé, signalé ✨", async () => {
    await own("Roucool", { shiny: 1, locked: 0 });
    await own("Roucool", { obtained: 2, shiny: 1, locked: 0 });
    await ownMany("Machopeur", 2);
    await ownMany("Kangourex", 2, { user: "u2" });
    const text = textOf(payloadOf(await compare({ evolutions: false }, partner()), "editReply"));
    assert.match(text, /Roucool\*\* ✨/);
  });

  it("refuse en privé, avant de différer : soi-même, un bot, les deux options, une espèce illisible", async () => {
    const self = await compare({}, { membre: fakeUser("u1") });
    assert.match(payloadOf(self, "reply").content, /Tu ne peux pas te comparer à toi-même/);
    const bot = await compare({}, { membre: fakeUser("b1", { bot: true }) });
    assert.match(payloadOf(bot, "reply").content, /Les bots ne collectionnent pas/);
    const both = await compare({ pokemon: String(species("Rattata").id) }, partner());
    assert.match(payloadOf(both, "reply").content, /un dresseur \*\*ou\*\* une espèce, pas les deux/);
    const unknown = await compare({ pokemon: "99999" });
    assert.match(payloadOf(unknown, "reply").content, /Choisis une espèce dans la liste d'autocomplétion/);
    for (const calls of [self, bot, both, unknown]) {
      assert.equal(payloadOf(calls, "reply").flags, EPHEMERAL);
      assert.ok(!calls.some((entry) => entry.method === "deferReply"), "le refus vient avant la réponse différée");
    }
  });

  it("sans option : avec qui échanger, celui qui permet le plus d'échanges d'abord", async () => {
    await ownMany("Rattata", 3);
    await ownMany("Roucool", 2);
    for (const name of ["Chenipan", "Aspicot"]) await ownMany(name, 2, { user: "p-f" });
    await ownMany("Chenipan", 2, { user: "p-a" });
    await own("Roucool", { user: "p-a" });
    await own("Rattata", { user: "p-c" });
    const calls = await compare({ evolutions: false });
    assert.deepEqual(payloadOf(calls, "deferReply"), { flags: EPHEMERAL });
    const reply = payloadOf(calls, "editReply");
    const text = textOf(reply);
    assert.ok(text.indexOf("<@p-f>") < text.indexOf("<@p-a>"), "p-f permet deux échanges, p-a un seul");
    assert.match(text, /<@p-f> · \*\*2\*\* échanges · 🎁 2 · 📥 2/);
    assert.match(text, /<@p-a> · \*\*1\*\* échange · 🎁 1 · 📥 1/);
    assert.doesNotMatch(text, /<@p-c>/, "il a déjà un Rattata : rien à lui donner");
    assert.doesNotMatch(text, /<@u1>/);
    assert.deepEqual(idsOf(reply), ["poke_cmpt|0|0|prev", "poke_cmpt_noop|0", "poke_cmpt|0|0|next"]);
  });

  it("sans option et sans personne : le dit, au lieu d'une liste vide — sans accuser les autres quand c'est soi qui n'a rien à donner", async () => {
    await own("Rattata");
    await ownMany("Chenipan", 2, { user: "u2" });
    const noOffer = textOf(payloadOf(await compare({ evolutions: false }), "editReply"));
    assert.match(noOffer, /Tu n'as aucun doublon à offrir pour l'instant/);
    assert.doesNotMatch(noOffer, /Personne n'a de quoi/);

    await own("Rattata", { obtained: 2 });
    await own("Rattata", { user: "u2" });
    const nobodyWants = textOf(payloadOf(await compare({ evolutions: false }), "editReply"));
    assert.match(nobodyWants, /Personne n'a de quoi échanger avec toi pour l'instant/, "u2 a déjà un Rattata : tu as de quoi offrir, mais personne n'en veut");
  });

  it("avec une espèce : à qui elle manque, et ce que chacun donnerait en retour", async () => {
    await ownMany("Rattata", 3);
    await own("Roucool");
    await ownMany("Chenipan", 2, { user: "n-a" });
    await own("Roucool", { user: "n-b" });
    await own("Rattata", { user: "n-c" });
    const calls = await compare({ pokemon: String(species("Rattata").id), evolutions: false });
    assert.deepEqual(payloadOf(calls, "deferReply"), { flags: EPHEMERAL });
    const reply = payloadOf(calls, "editReply");
    const text = textOf(reply);
    assert.match(text, /Qui a besoin de Rattata/);
    assert.match(text, /Tu peux donner \*\*2\*\* Rattata/);
    assert.match(text, /<@n-a> · peut te donner \*\*1\*\* espèce en retour/);
    assert.match(text, /<@n-b> · rien à te donner en retour/);
    assert.doesNotMatch(text, /<@n-c>/, "il en a déjà un");
    assert.ok(text.indexOf("<@n-a>") < text.indexOf("<@n-b>"), "l'échange avant le cadeau");
    assert.deepEqual(idsOf(reply)[1], `poke_cmpn_noop|${species("Rattata").id}`);
  });

  it("une espèce qu'on ne peut pas donner : le refus dit pourquoi, avec les chiffres", async () => {
    const run = async (options = {}) => payloadOf(await compare({ pokemon: String(species("Rattata").id), ...options }), "editReply").content;
    assert.match(await run(), /^❌ Tu n'as pas de \*\*Rattata\*\* à donner/);
    await own("Rattata");
    assert.match(await run(), /Tu n'as qu'un \*\*Rattata\*\* : il t'en faut au moins 2/);
    await dbRun(points, "DELETE FROM pokemon_owned");
    await ownMany("Rattata", 3, { locked: 1 });
    assert.match(await run(), /Tes \*\*3\*\* Rattata sont verrouillés 🛡️ : déverrouille-en un avec \/pk verrou/);
    await dbRun(points, "DELETE FROM pokemon_owned");
    await ownMany("Rattata", 3);
    assert.match(await run(), /Tes \*\*2\*\* Rattata en trop sont mis de côté 🧬.*`evolutions: False`/);
    const text = textOf(payloadOf(await compare({ pokemon: String(species("Rattata").id), evolutions: false }), "editReply"));
    assert.match(text, /Qui a besoin de Rattata/, "sans la réserve, il se propose");
  });

  it("l'autocomplétion ne propose que ce qu'on peut donner ; vide, elle l'explique", async () => {
    const empty = payloadOf(await runAutocomplete(pk, { sub: "comparer", focused: { name: "pokemon", value: "" } }), "respond");
    assert.deepEqual(empty, [{ name: "Aucun doublon à offrir : ils servent peut-être à tes évolutions", value: "—" }]);
    await ownMany("Ronflex", 3);
    await ownMany("Rattata", 3);
    await own("Roucool");
    const choices = payloadOf(await runAutocomplete(pk, { sub: "comparer", focused: { name: "pokemon", value: "" } }), "respond");
    assert.deepEqual(choices, [{ name: "Ronflex ×2 en trop", value: String(species("Ronflex").id) }], "les Rattata servent à évoluer, Roucool n'a pas de doublon");
    const raw = payloadOf(await runAutocomplete(pk, { sub: "comparer", options: { evolutions: false }, focused: { name: "pokemon", value: "ratt" } }), "respond");
    assert.deepEqual(raw.map((choice) => choice.name), ["Rattata ×2 en trop"], "la saisie filtre, et la réserve se désactive");
    const none = payloadOf(await runAutocomplete(pk, { sub: "comparer", options: { evolutions: false }, focused: { name: "pokemon", value: "zzz" } }), "respond");
    assert.deepEqual(none, [{ name: "Aucun de tes doublons ne correspond à « zzz »", value: "—" }], "il y a des doublons : c'est la saisie qui ne retient rien");
    await dbRun(points, "DELETE FROM pokemon_owned");
    const nothing = payloadOf(await runAutocomplete(pk, { sub: "comparer", options: { evolutions: false }, focused: { name: "pokemon", value: "zzz" } }), "respond");
    assert.deepEqual(nothing, [{ name: "Tu n'as aucun doublon à offrir", value: "—" }]);
  });

  it("l'autocomplétion cherche comme les autres : sans accents ni casse", async () => {
    await ownMany("Salamèche", 2);
    const typed = async (value) => payloadOf(await runAutocomplete(pk, { sub: "comparer", options: { evolutions: false }, focused: { name: "pokemon", value } }), "respond");
    assert.deepEqual((await typed("salameche")).map((choice) => choice.name), ["Salamèche ×1 en trop"]);
    assert.deepEqual((await typed("SALAM")).map((choice) => choice.value), [String(species("Salamèche").id)]);
  });

  it("les chiffres des refus se lisent à la française", async () => {
    await dbRun(
      points,
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1200)
       INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at, locked)
       SELECT 'u1', ?, 0, 'M', 'test', i, 1 FROM n`,
      [species("Rattata").id]
    );
    const text = payloadOf(await compare({ pokemon: String(species("Rattata").id), evolutions: false }), "editReply").content;
    assert.match(text, /Tes \*\*1\u202f200\*\* Rattata sont verrouillés/);
  });
});

describe("/pk echange", () => {
  const trade = (options, users = { membre: fakeUser("u2") }, extra = {}) => runCommand(pk, { sub: "echange", options, users, ...extra });
  const offer = (mine, theirs) => ({
    membre: "u2",
    je_donne: String(species("Rattata").id),
    mon_individu: `#${mine}`,
    je_recois: String(species("Roucool").id),
    son_individu: `#${theirs}`,
  });

  it("propose l'échange : message public qui mentionne le dresseur, boutons, offre enregistrée avec le message", async () => {
    const [mine] = await ownMany("Rattata", 2);
    const [theirs] = await ownMany("Roucool", 2, { user: "u2" });
    const calls = await trade(offer(mine, theirs), undefined, { channelId: "salon-9" });
    assert.deepEqual(payloadOf(calls, "deferReply"), undefined, "pas d'éphémère : l'offre est publique");
    const reply = payloadOf(calls, "editReply");
    assert.equal(reply.content, "<@u2>");
    assert.equal(reply.components.length, 1);
    const [row] = await dbAll(points, "SELECT * FROM pokemon_trades");
    assert.equal(row.status, "PENDING");
    assert.equal(row.channel_id, "salon-9");
    assert.equal(row.offer_pokemon_id, mine);
    assert.equal(row.request_pokemon_id, theirs);
    assert.equal(row.message_id, "reply-2", "le message de l'offre est retenu pour l'éditer plus tard");
  });

  it("avec soi-même ou avec un bot : refus en privé, aucune offre", async () => {
    const [mine] = await ownMany("Rattata", 2);
    const [theirs] = await ownMany("Roucool", 2);
    const self = await trade({ ...offer(mine, theirs), membre: "u1" }, { membre: fakeUser("u1") });
    assert.match(payloadOf(self, "reply").content, /Tu ne peux pas échanger avec toi-même/);
    const botCalls = await trade({ ...offer(mine, theirs), membre: "b1" }, { membre: fakeUser("b1", { bot: true }) });
    assert.ok(payloadOf(botCalls, "reply").content.startsWith("❌"));
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_trades")).length, 0);
  });

  it("le dernier de l'espèce, de chaque côté, est refusé avec le nom de celui qu'on garde", async () => {
    const [mine] = await ownMany("Rattata", 1);
    const [theirs] = await ownMany("Roucool", 2, { user: "u2" });
    assert.match(payloadOf(await trade(offer(mine, theirs)), "reply").content, /est ton dernier Rattata : il reste toujours au moins un Pokémon de chaque espèce/);
    const [two] = await ownMany("Rattata", 2, { user: "u1" });
    await dbRun(points, "DELETE FROM pokemon_owned WHERE user_id = 'u2'");
    const [last] = await ownMany("Roucool", 1, { user: "u2" });
    assert.match(payloadOf(await trade(offer(two, last)), "reply").content, /est le dernier Roucool de <@u2> : il lui en reste toujours un/);
  });

  it("un verrouillé n'est pas proposable, de chaque côté, et le refus dit comment faire", async () => {
    const [mine] = await ownMany("Rattata", 2, { locked: 1 });
    const [theirs] = await ownMany("Roucool", 2, { user: "u2" });
    assert.match(payloadOf(await trade(offer(mine, theirs)), "reply").content, /est verrouillé 🛡️ : déverrouille-le avec \/pk verrou pour l'échanger/);
    await dbRun(points, "UPDATE pokemon_owned SET locked = 0");
    await dbRun(points, "UPDATE pokemon_owned SET locked = 1 WHERE user_id = 'u2'");
    assert.match(payloadOf(await trade(offer(mine, theirs)), "reply").content, /est verrouillé 🛡️ chez <@u2> : il ne s'échange pas/);
  });

  it("un Pokémon qui n'est pas celui qu'on croit : refus qui le nomme", async () => {
    const [mine] = await ownMany("Rattata", 2);
    const [theirs] = await ownMany("Roucool", 2, { user: "u2" });
    const wrongSpecies = await trade({ ...offer(mine, theirs), je_donne: String(species("Roucool").id) });
    assert.match(payloadOf(wrongSpecies, "reply").content, /n'est pas un Roucool/);
    const stolen = await trade({ ...offer(mine, mine) });
    assert.match(payloadOf(stolen, "reply").content, /n'est pas dans cette boîte/);
  });

  it("l'autocomplétion : ce qu'on peut donner (avec l'évolution gratuite annoncée), puis chez le destinataire", async () => {
    await ownMany("Machopeur", 2);
    await own("Rattata");
    const mine = payloadOf(await runAutocomplete(pk, { sub: "echange", focused: { name: "je_donne", value: "" } }), "respond");
    assert.deepEqual(mine.map((choice) => choice.name), ["Machopeur ×1 en trop — évoluera gratuitement en Mackogneur chez l'autre"]);
    const none = payloadOf(await runAutocomplete(pk, { sub: "echange", focused: { name: "je_recois", value: "" } }), "respond");
    assert.match(none[0].name, /Choisis d'abord le dresseur/);
    await ownMany("Roucool", 2, { user: "u2" });
    const theirs = payloadOf(await runAutocomplete(pk, { sub: "echange", options: { membre: "u2" }, focused: { name: "je_recois", value: "" } }), "respond");
    assert.deepEqual(theirs.map((choice) => choice.name), ["Roucool ×1 en trop"]);
    const noSpecies = payloadOf(await runAutocomplete(pk, { sub: "echange", options: { membre: "u2" }, focused: { name: "son_individu", value: "" } }), "respond");
    assert.match(noSpecies[0].name, /Choisis d'abord l'espèce dans l'option « je_recois »/);
  });
});

describe("/pk evolution", () => {
  const evolution = (options) => runCommand(pk, { sub: "evolution", options });
  const evo = (name) => ({ espece: String(species(name).id) });

  it("propose le bouton d'évolution avec le coût, quand on a de quoi payer", async () => {
    await ownMany("Rattata", 3);
    const calls = await evolution(evo("Rattata"));
    assert.deepEqual(payloadOf(calls, "deferReply"), { flags: EPHEMERAL });
    const reply = payloadOf(calls, "editReply");
    assert.match(textOf(reply), /peut évoluer en \*\*Rattatac\*\*/);
    assert.match(textOf(reply), /Coût[\s\S]*1 \*\*?Rattata|\*\*1\*\* Rattata sacrifié/);
    const ids = reply.components.flatMap((row) => row.toJSON().components.map((button) => button.custom_id));
    assert.deepEqual(ids, [`poke_evo|${species("Rattata").id}|*|random`]);
  });

  it("un Machopeur reçu en échange : évolution gratuite annoncée, même seul, et le bouton le désigne", async () => {
    const id = await own("Machopeur");
    await dbRun(points, "UPDATE pokemon_owned SET origin = 'echange' WHERE id = ?", [id]);
    const reply = payloadOf(await evolution({ ...evo("Machopeur"), individu: `#${id}` }), "editReply");
    assert.match(textOf(reply), /Reçu en échange : l'évolution est \*\*gratuite\*\*/);
    const [button] = reply.components.flatMap((row) => row.toJSON().components);
    assert.equal(button.label, "Faire évoluer (gratuit)");
    assert.equal(button.custom_id, `poke_evo|${species("Machopeur").id}|#${id}|random`);

    const choices = payloadOf(await runAutocomplete(pk, { sub: "evolution", options: evo("Machopeur"), focused: { name: "individu", value: "" } }), "respond");
    assert.deepEqual(choices.map((choice) => choice.value), [`#${id}`], "le dernier de l'espèce se propose, puisque cette évolution est gratuite");
    const species_ = payloadOf(await runAutocomplete(pk, { sub: "evolution", focused: { name: "espece", value: "" } }), "respond");
    assert.ok(species_.some((choice) => choice.value === String(species("Machopeur").id)));

    await dbRun(points, "UPDATE pokemon_owned SET origin = 'test' WHERE id = ?", [id]);
    const paid = payloadOf(await evolution({ ...evo("Machopeur"), individu: `#${id}` }), "editReply");
    assert.doesNotMatch(textOf(paid), /gratuite/, "jamais échangé : rien de gratuit");
  });

  it("avec un individu précis, le bouton le désigne ; verrouillé, l'écran le dit", async () => {
    const ids = await ownMany("Rattata", 3);
    await dbRun(points, "UPDATE pokemon_owned SET locked = 1 WHERE id = ?", [ids[2]]);
    const reply = payloadOf(await evolution({ ...evo("Rattata"), individu: `#${ids[2]}` }), "editReply");
    assert.match(textOf(reply), new RegExp(`#${ids[2]} est verrouillé`));
    const buttons = reply.components.flatMap((row) => row.toJSON().components.map((button) => button.custom_id));
    assert.ok(buttons[0].startsWith(`poke_evo|${species("Rattata").id}|#${ids[2]}|`));
  });

  it("un lignage à embranchement propose le hasard ou le choix, avec leurs prix", async () => {
    await ownMany("Évoli", 3);
    const reply = payloadOf(await evolution(evo("Évoli")), "editReply");
    const labels = reply.components.flatMap((row) => row.toJSON().components.map((button) => button.label));
    assert.match(labels[0], /Évolution aléatoire \(1\s500 pts\)/);
    assert.match(labels[1], /Choisir l'évolution \(3\s000 pts\)/);
  });

  it("il manque des exemplaires : aucun bouton, et l'écran dit combien", async () => {
    await ownMany("Rattata", 2);
    const reply = payloadOf(await evolution(evo("Rattata")), "editReply");
    assert.deepEqual(reply.components ?? [], []);
    assert.match(textOf(reply), /\*\*3\*\* Rattata/);
  });

  it("Super Bonbon et Métamorph apparaissent comme chemins quand ils font la différence", async () => {
    await ownMany("Rattata", 2);
    await grant("super_bonbon", 3);
    const withCandy = payloadOf(await evolution(evo("Rattata")), "editReply");
    const buttons = withCandy.components.flatMap((row) => row.toJSON().components.map((button) => button.custom_id));
    assert.ok(buttons.includes(`poke_evo|${species("Rattata").id}|*|random|super_bonbon`));
    await ownMany("Métamorph", 2);
    const withDitto = payloadOf(await evolution(evo("Rattata")), "editReply");
    const dittoButtons = withDitto.components.flatMap((row) => row.toJSON().components.map((button) => button.custom_id));
    assert.ok(dittoButtons.some((id) => id.endsWith(`|${collection.DITTO_HELPER}`)));
  });

  it("une espèce qui n'évolue pas ou une saisie fausse : refus avant de différer", async () => {
    const none = await evolution(evo("Mewtwo"));
    assert.match(payloadOf(none, "reply").content, /^❌ Mewtwo n'a pas d'évolution/);
    assert.ok(!none.some((entry) => entry.method === "deferReply"));
    assert.match(payloadOf(await evolution({ espece: "99999" }), "reply").content, /autocomplétion/);
    const stranger = await own("Rattata", { user: "u2" });
    assert.match(payloadOf(await evolution({ ...evo("Rattata"), individu: `#${stranger}` }), "reply").content, /n'est pas dans cette boîte/);
  });

  it("l'autocomplétion : ce qui peut évoluer, ou ce qui manque, ou « rien »", async () => {
    const empty = payloadOf(await runAutocomplete(pk, { sub: "evolution", focused: { name: "espece", value: "" } }), "respond");
    assert.deepEqual(empty, [{ name: "Aucun Pokémon de ta collection ne peut évoluer", value: "—" }]);
    await ownMany("Rattata", 2);
    const missing = payloadOf(await runAutocomplete(pk, { sub: "evolution", focused: { name: "espece", value: "" } }), "respond");
    assert.match(missing[0].name, /^⚠️ Rattata : 3 exemplaires requis, tu en as 2$/);
    await own("Rattata", { obtained: 9 });
    const ok = payloadOf(await runAutocomplete(pk, { sub: "evolution", focused: { name: "espece", value: "" } }), "respond");
    assert.deepEqual(ok.map((choice) => choice.name), ["Rattata (×3)"]);
    const individuals = payloadOf(await runAutocomplete(pk, { sub: "evolution", options: { espece: String(species("Rattata").id) }, focused: { name: "individu", value: "" } }), "respond");
    assert.equal(individuals.length, 3);
  });
});

describe("/pk oeuf", () => {
  const egg = (subName, options = {}) => runCommand(pk, { group: "oeuf", sub: subName, options });

  it("sans œuf, la commande explique comment en obtenir un", async () => {
    const reply = payloadOf(await egg("voir"), "reply");
    assert.match(reply.content, /Tu ne couves aucun œuf/);
    assert.equal(reply.flags, EPHEMERAL);
  });

  it("pondre : valide les parents (revalidés, tapés à la main ou périmés), puis dit le résultat", async () => {
    const calls = await egg("pondre", { parent1: "99999:0", parent2: "#99999" });
    assert.match(payloadOf(calls, "editReply").content, /^❌ /);
    const [m] = await ownMany("Rattata", 1, { sex: "M" });
    const [f] = await ownMany("Rattata", 1, { sex: "F" });
    const refused = await egg("pondre", { parent1: `#${m}`, parent2: `#${f}` });
    assert.match(payloadOf(refused, "editReply").content, /^❌ /, "la première génération n'a pas de bébé");
  });
});

describe("/pk safari", () => {
  const safari = (options = {}) => runCommand(pk, { sub: "safari", options });
  const openPark = async () =>
    (await dbRun(points, "INSERT INTO pokemon_safari_parks (status, opened_at, expires_at, reserved_for) VALUES ('OPEN', ?, ?, NULL)", [Date.now(), Date.now() + 7_200_000])).lastID;

  it("fermé par la configuration", async () => {
    sandbox.writeConfig({ pokemon: { ...GEN1.pokemon, safari: { enabled: false } } });
    assert.match(payloadOf(await safari(), "reply").content, /parc safari est fermé/);
  });

  it("l'entrée payante : débitée, et la visite s'affiche", async () => {
    await setBalance(getSafariConfig().entryPrice + 10);
    const calls = await safari();
    assert.deepEqual(payloadOf(calls, "deferReply"), { flags: EPHEMERAL });
    assert.ok(payloadOf(calls, "editReply").embeds.length >= 1);
    assert.equal(await balance(), 10);
  });

  it("sans assez de points : refus avec les chiffres, rien n'est débité", async () => {
    await setBalance(50);
    const reply = payloadOf(await safari(), "editReply").content;
    assert.match(reply, /^❌ /);
    assert.equal(await balance(), 50);
  });

  it("une visite en cours se rouvre, sans repayer", async () => {
    await setBalance(getSafariConfig().entryPrice * 3);
    await safari();
    const before = await balance();
    const again = payloadOf(await safari(), "editReply");
    assert.ok(again.embeds.length >= 1);
    assert.equal(await balance(), before);
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_safari_sessions")).length, 1);
  });

  it("un parc offert est ouvert : on le dit plutôt que de faire payer", async () => {
    await setBalance(100000);
    await openPark();
    const reply = payloadOf(await safari(), "editReply").content;
    assert.match(reply, /ton entrée est offerte/);
    assert.equal(await balance(), 100000);
  });
});

describe("les commandes ne fabriquent ni ne perdent rien", () => {
  it("une série de commandes de jeu laisse le total de Pokémon et de points cohérent", async () => {
    await setBalance(5000);
    const before = {
      owned: (await dbAll(points, "SELECT id FROM pokemon_owned")).length,
      balance: await balance(),
    };
    await ownMany("Rattata", 4);
    await runCommand(pk, { group: "revendre", sub: "pokemon", options: { espece: String(species("Rattata").id), quantite: 2 } });
    const sold = (await dbAll(points, "SELECT id FROM pokemon_owned")).length;
    assert.equal(sold, before.owned + 2, "quatre reçus, deux vendus");
    assert.ok((await balance()) > before.balance, "la revente a crédité");
  });
});
