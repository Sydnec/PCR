// /admin : la garde du routeur (l'administration ne se rouvre pas par un réglage de
// serveur) et chaque sous-commande — points, objets, réglages à chaud, tables de
// tirage, pot commun, apparitions, parc, purge. Tout répond en éphémère, et un
// refus donne les chiffres.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { createSandbox, openDatabases, dbRun, dbAll, dbGet, speciesByName } from "./helpers.js";
import { fakeUser, fakeChannel, fakeGuild, runCommand, runAutocomplete, payloadOf, textOf } from "./fake-discord.js";

const GEN1 = { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } };
const sandbox = createSandbox({ config: GEN1 });
process.env.POKEMON_CHANNEL_ID = "123";
process.env.DEFAULT_ROLE_ID = "role-default";
process.env.POKEMON_ROLE_ID = "role-pokemon";
const { points } = await openDatabases();
const admin = (await import("../commands/admin.js")).default;
const data = await import("../modules/pokemon/data.js");
const items = await import("../modules/pokemon/items.js");
const economy = await import("../modules/economy.js");
const { getPokemonConfig, getSafariConfig } = await import("../modules/pokemon/config.js");
const { getConfig } = await import("../modules/config.js");

const EPHEMERAL = MessageFlags.Ephemeral;
const species = (name) => speciesByName(data.allSpecies, name);
const call = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value))));
const setBalance = (amount, user) =>
  dbRun(points, "INSERT INTO points (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = ?", [user, amount, amount]);
const balance = (user) => call(economy.getBalance, user);
const count = (key, user) => call(items.getItemCount, user, key);
const asAdmin = (config = {}) => ({ admin: true, ...config });
const run = (sub, config = {}, bot = {}) => runCommand(admin, asAdmin({ sub, ...config }), bot);
const quiet = async (work) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await work();
  } finally {
    console.error = original;
  }
};

// Un serveur dont le rôle par défaut est porté par `members` (bots compris).
const community = (members) =>
  fakeGuild({
    roles: [{ id: "role-default", name: "Dresseurs" }],
    members: members.map((member) => ({ roles: ["role-default"], ...member })),
  });
const roleTarget = (guild, id = "role-default") => ({ role: guild.roles.cache.get(id) ?? { id, name: "?" } });

beforeEach(async () => {
  for (const table of ["points", "pokemon_inventory", "pokemon_item_log", "pokemon_spawns", "pokemon_safari_parks", "pokemon_owned", "points_log", "pokemon_redistributions"]) {
    await dbRun(points, `DELETE FROM ${table}`).catch(() => {});
  }
  await dbRun(points, "UPDATE pokemon_state SET spawning = 0, message_count = 0, spawn_paused_until = 0 WHERE id = 1");
  sandbox.removeConfig();
  sandbox.writeConfig(GEN1);
});

describe("le routeur /admin", () => {
  it("un non-administrateur est refusé en privé, sans que rien ne s'exécute", async () => {
    const calls = await runCommand(admin, { sub: "points", admin: false, options: { montant: 100 }, mentionables: { cible: { user: fakeUser("u2") } } });
    const reply = payloadOf(calls, "reply");
    assert.equal(reply.content, "❌ Cette commande est réservée aux administrateurs.");
    assert.equal(reply.flags, EPHEMERAL);
    assert.ok(!calls.some((entry) => entry.method === "deferReply"));
    assert.equal(await balance("u2"), 0);
  });

  it("l'autocomplétion est fermée aussi : elle énumère la configuration vivante", async () => {
    const calls = await runAutocomplete(admin, { sub: "config", admin: false, focused: { name: "cle", value: "" } });
    assert.deepEqual(payloadOf(calls, "respond"), []);
    const open = await runAutocomplete(admin, { sub: "config", admin: true, focused: { name: "cle", value: "pokemon.capture" } });
    assert.ok(payloadOf(open, "respond").length > 0);
  });

  it("un administrateur : la réponse est différée en privé, une fois pour toutes", async () => {
    const calls = await run("potcommun", { options: { simulation: true }, guild: community([]) });
    assert.deepEqual(payloadOf(calls, "deferReply"), { flags: EPHEMERAL });
    assert.ok(calls.some((entry) => entry.method === "editReply"));
  });

  it("une sous-commande inconnue répond (déploiement partiel)", async () => {
    const calls = await quiet(() => run("n_existe_pas"));
    assert.match(payloadOf(calls, "reply").content, /`n_existe_pas` est introuvable/);
  });

  it("une sous-commande qui plante est nommée dans la réponse, jamais un « erreur » anonyme", async () => {
    const calls = await quiet(() => run("points", { options: { montant: 5 } }));
    assert.match(payloadOf(calls, "editReply").content, /^❌ Erreur pendant `\/admin points`, voir les logs\.$/);
  });
});

describe("/admin points", () => {
  const points$ = (amount, target, extra = {}) => run("points", { options: { montant: amount }, mentionables: { cible: target }, ...extra });

  it("donne à un dresseur : l'ancien et le nouveau solde", async () => {
    await setBalance(1000, "u2");
    const calls = await points$(500, { user: fakeUser("u2") });
    assert.match(payloadOf(calls, "editReply").content, /^✅ \*\*\+500\*\* points pour \*\*user-u2\*\*\.\nSolde : \*\*1[\s]000\*\* → \*\*1[\s]500\*\*$/);
    assert.equal(await balance("u2"), 1500);
  });

  it("retire sans plancher, et avertit d'un solde négatif", async () => {
    await setBalance(100, "u2");
    const reply = payloadOf(await points$(-300, { user: fakeUser("u2") }), "editReply").content;
    assert.match(reply, /\*\*-300\*\* points/);
    assert.match(reply, /⚠️ négatif, ses achats sont bloqués jusqu'à ce qu'il remonte/);
    assert.equal(await balance("u2"), -200);
  });

  it("un montant nul ne change rien et le dit", async () => {
    const reply = payloadOf(await points$(0, { user: fakeUser("u2") }), "editReply").content;
    assert.equal(reply, "❌ Un montant de 0 ne changerait rien.");
  });

  it("un rôle entier d'un coup, bots exclus, total distribué annoncé", async () => {
    const guild = community([{ id: "m1" }, { id: "m2" }, { id: "b1", bot: true }]);
    const reply = payloadOf(await points$(100, roleTarget(guild), { guild }), "editReply").content;
    assert.match(reply, /\*\*\+100\*\* points pour \*\*2\*\* membre\(s\) du rôle \*\*Dresseurs\*\*/);
    assert.match(reply, /Total distribué : \*\*\+200\*\* points/);
    assert.equal(await balance("m1"), 100);
    assert.equal(await balance("m2"), 100);
    assert.equal(await balance("b1"), 0, "un bot ne touche rien");
  });

  it("un rôle que personne ne porte, ou introuvable : refus qui le dit", async () => {
    const empty = fakeGuild({ roles: [{ id: "role-default", name: "Dresseurs" }], members: [] });
    assert.match(payloadOf(await points$(10, roleTarget(empty), { guild: empty }), "editReply").content, /^❌ Personne ne porte le rôle \*\*Dresseurs\*\*/);
    const guild = community([{ id: "m1" }]);
    assert.match(payloadOf(await points$(10, { role: { id: "inconnu" } }, { guild }), "editReply").content, /^❌ Ce rôle est introuvable sur ce serveur/);
  });
});

describe("/admin item", () => {
  const item$ = (options, target, extra = {}) => run("item", { options, mentionables: { cible: target }, ...extra });

  it("donne un objet : avant, après, et le sac suit", async () => {
    const reply = payloadOf(await item$({ objet: "pepite", quantite: 3 }, { user: fakeUser("u2") }), "editReply").content;
    assert.match(reply, /^✅ \*\*\+3\*\* .*Pépite\*\* pour \*\*user-u2\*\*\.\nIl en a maintenant \*\*3\*\*\.$/);
    assert.equal(await count("pepite", "u2"), 3);
  });

  it("un objet qui n'est pas au catalogue, ou une quantité nulle : refus", async () => {
    assert.match(payloadOf(await item$({ objet: "n_importe_quoi" }, { user: fakeUser("u2") }), "editReply").content, /^❌ `n_importe_quoi` n'est pas un objet du catalogue/);
    assert.equal(payloadOf(await item$({ objet: "pepite", quantite: 0 }, { user: fakeUser("u2") }), "editReply").content, "❌ Une quantité de 0 ne changerait rien.");
  });

  it("retirer a un plancher : un sac trop léger refuse avec les chiffres, rien ne bouge", async () => {
    await call(items.grantItem, "u2", "pepite", 2, { source: "test" });
    const reply = payloadOf(await item$({ objet: "pepite", quantite: -5 }, { user: fakeUser("u2") }), "editReply").content;
    assert.match(reply, /n'a que \*\*2\*\* .*Pépite, impossible d'en retirer \*\*5\*\*/);
    assert.equal(await count("pepite", "u2"), 2);
    const done = payloadOf(await item$({ objet: "pepite", quantite: -2 }, { user: fakeUser("u2") }), "editReply").content;
    assert.match(done, /Il en a maintenant \*\*0\*\*/);
  });

  it("un rôle : chacun est servi, ceux qui n'en avaient pas assez sont comptés à part, rien ne leur est retiré", async () => {
    const guild = community([{ id: "m1" }, { id: "m2" }, { id: "m3" }]);
    await call(items.grantItem, "m1", "pepite", 3, { source: "test" });
    await call(items.grantItem, "m2", "pepite", 1, { source: "test" });
    const reply = payloadOf(await item$({ objet: "pepite", quantite: -2 }, roleTarget(guild), { guild }), "editReply").content;
    assert.match(reply, /\*\*-2\*\* .*Pépite\*\* pour \*\*1\*\* membre\(s\) du rôle \*\*Dresseurs\*\*/);
    assert.match(reply, /⚠️ \*\*2\*\* n'en avaient pas \*\*2\*\* : rien ne leur a été retiré/);
    assert.equal(await count("pepite", "m1"), 1);
    assert.equal(await count("pepite", "m2"), 1);
  });

  it("l'autocomplétion cherche par clé ou par nom, vingt-cinq au plus", async () => {
    const filtered = payloadOf(await runAutocomplete(admin, asAdmin({ sub: "item", focused: { name: "objet", value: "pépite" } })), "respond");
    assert.ok(filtered.some((choice) => choice.value === "pepite"));
    const all = payloadOf(await runAutocomplete(admin, asAdmin({ sub: "item", focused: { name: "objet", value: "" } })), "respond");
    assert.ok(all.length <= 25 && all.length > 0);
  });
});

describe("/admin config et config-voir", () => {
  it("modifie un réglage : avant → après, et le jeu le lit aussitôt", async () => {
    const before = getPokemonConfig().capture.minCatchRate;
    const reply = payloadOf(await run("config", { options: { cle: "pokemon.capture.minCatchRate", valeur: "20" } }), "editReply").content;
    assert.match(reply, /^✅ `pokemon\.capture\.minCatchRate`\n`10` → `20`\nAppliqué immédiatement/);
    assert.equal(before, 10);
    assert.equal(getPokemonConfig().capture.minCatchRate, 20, "relu à chaque usage, sans redémarrage");
  });

  it("refuse avec les bornes : valeur hors limites, mauvais type, clé inconnue", async () => {
    for (const [cle, valeur] of [["pokemon.capture.minCatchRate", "9999"], ["pokemon.capture.minCatchRate", "beaucoup"], ["pokemon.nexiste.pas", "1"]]) {
      const reply = payloadOf(await run("config", { options: { cle, valeur } }), "editReply").content;
      assert.match(reply, /^❌ /, `${cle} = ${valeur}`);
    }
    assert.equal(getPokemonConfig().capture.minCatchRate, 10);
  });

  it("une surcharge illisible est nommée comme cause quand l'écriture bute dessus", async () => {
    sandbox.writeRaw("{ceci n'est pas du json");
    const reply = payloadOf(await run("config", { options: { cle: "pokemon.capture.minCatchRate", valeur: "20" } }), "editReply").content;
    assert.match(reply, /^❌ /);
    assert.ok(reply.split("\n").length >= 2, "la cause est dite sur la ligne suivante");
    sandbox.removeConfig();
  });

  it("config-voir sans clé liste les réglages, tronqué sous la limite de Discord", async () => {
    const reply = payloadOf(await run("config-voir"), "editReply").content;
    assert.ok(reply.length <= 2000, `${reply.length} caractères`);
    assert.match(reply, /`[a-zA-Z.]+` = /);
    assert.match(reply, /autre\(s\) — précise une clé/);
  });

  it("config-voir d'un réglage : la valeur actuelle, et le défaut quand elle en diffère", async () => {
    const same = payloadOf(await run("config-voir", { options: { cle: "pokemon.capture.minCatchRate" } }), "editReply").content;
    assert.match(same, /Actuel : .*10[\s\S]*\(c'est la valeur par défaut\)/);
    await run("config", { options: { cle: "pokemon.capture.minCatchRate", valeur: "25" } });
    const changed = payloadOf(await run("config-voir", { options: { cle: "pokemon.capture.minCatchRate" } }), "editReply").content;
    assert.match(changed, /Actuel : .*25[\s\S]*Défaut : .*10/);
  });

  it("config-voir d'une branche liste ses feuilles, jamais un bloc que Discord refuserait", async () => {
    const reply = payloadOf(await run("config-voir", { options: { cle: "pokemon.capture" } }), "editReply").content;
    assert.match(reply, /^\*\*`pokemon\.capture`\*\*\n`pokemon\.capture\./);
    assert.ok(reply.length <= 2000);
  });

  it("config-voir d'une clé inconnue : refus", async () => {
    assert.match(payloadOf(await run("config-voir", { options: { cle: "pokemon.zzz" } }), "editReply").content, /^❌ /);
  });

  it("config-voir prévient d'une surcharge illisible : c'est là qu'on viendrait constater qu'un réglage « n'a pas pris »", async () => {
    sandbox.writeRaw("{illisible");
    const reply = payloadOf(await run("config-voir", { options: { cle: "pokemon.capture.minCatchRate" } }), "editReply").content;
    assert.ok(reply.split("\n").length > 2);
    assert.match(reply, /pokemon\.capture\.minCatchRate/);
  });

  it("les réglages de ce test restent hors du dépôt : config.json vit dans le dossier jetable", () => {
    assert.ok(sandbox.configFile.startsWith(process.env.PCR_DATA_DIR));
    assert.equal(getConfig().pokemon.capture.minCatchRate, 10);
  });
});

describe("/admin poids", () => {
  it("toutes les tables : des embeds qui respectent les limites de Discord", async () => {
    const calls = await run("poids");
    const embeds = [payloadOf(calls, "editReply"), ...calls.filter((entry) => entry.method === "followUp").map((entry) => entry.payload)].flatMap((payload) => payload.embeds.map((embed) => embed.toJSON()));
    assert.ok(embeds.length >= 1);
    assert.match(embeds[0].title, /Tables de tirage pondéré/);
    for (const embed of embeds) {
      const size = (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0) + embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
      assert.ok(size <= 6000, `${size} caractères dans un embed`);
      assert.ok(embed.fields.length <= 25);
      for (const field of embed.fields) assert.ok(field.value.length <= 1024, `${field.name} : ${field.value.length}`);
    }
    assert.match(embeds.at(-1).footer.text, /\/admin config/);
  });

  it("une seule table : ses lignes, avec les probabilités, et une table inconnue est refusée", async () => {
    const one = payloadOf(await run("poids", { options: { table: "loterie" } }), "editReply");
    const text = textOf(one);
    assert.match(text, /TOTAL/);
    assert.match(text, /\d+,\d+ %|100 %/, "les pourcentages sont à la française");
    assert.equal(payloadOf(await run("poids", { options: { table: "zzz" } }), "editReply").content, "❌ Table inconnue.");
  });
});

describe("/admin potcommun", () => {
  it("la simulation calcule sans toucher aux soldes", async () => {
    const guild = community([{ id: "m1" }, { id: "m2" }, { id: "m3" }]);
    await setBalance(10000, "m1");
    await setBalance(100, "m2");
    await setBalance(100, "m3");
    const reply = payloadOf(await run("potcommun", { options: { simulation: true }, guild }), "editReply");
    assert.match(reply.content, /^🔎 Simulation — \*\*aucun solde n'a bougé\*\*/);
    assert.equal(reply.embeds.length, 1);
    assert.deepEqual([await balance("m1"), await balance("m2"), await balance("m3")], [10000, 100, 100]);
  });

  it("le vrai pot redistribue sans créer ni perdre un point, et le dit sans un mot aux joueurs", async () => {
    const guild = community([{ id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "b1", bot: true }]);
    await setBalance(10000, "m1");
    await setBalance(1000, "m2");
    await setBalance(0, "m3");
    const total = async () => (await dbAll(points, "SELECT SUM(balance) AS total FROM points"))[0].total;
    const before = await total();
    const reply = payloadOf(await run("potcommun", { guild }), "editReply");
    assert.match(reply.content, /^✅ Pot commun déclenché, sans un mot aux joueurs\./);
    assert.match(reply.content, /L'échéance hebdomadaire n'a pas bougé/);
    assert.equal(await total(), before, "la masse de points est conservée");
    assert.ok((await balance("m3")) > 0, "celui qui n'avait rien reçoit sa part");
    assert.ok((await balance("m1")) < 10000, "le plus riche cotise");
    assert.equal(await balance("b1"), 0, "un bot ne cotise ni ne touche");
  });

  it("personne à servir, ou personne qui ait de quoi cotiser : refus qui le dit", async () => {
    assert.match(payloadOf(await run("potcommun", { guild: community([]) }), "editReply").content, /^❌ Personne ne porte le rôle/);
    const guild = community([{ id: "m1" }, { id: "m2" }]);
    assert.match(payloadOf(await run("potcommun", { guild }), "editReply").content, /^❌ Personne n'a de quoi cotiser/);
  });
});

describe("/admin pokespawn", () => {
  const botWith = (channel) => ({ channels: { fetch: async () => channel } });
  const spawnRows = () => dbAll(points, "SELECT species_id, is_shiny, status FROM pokemon_spawns");

  it("déclenche une apparition précise, annoncée dans le salon", async () => {
    const channel = fakeChannel();
    const reply = payloadOf(await run("pokespawn", { options: { espece: String(species("Roucool").id), annonce: "🎃 Halloween !" } }, botWith(channel)), "editReply");
    assert.equal(reply.content, "✅ Spawn déclenché : **Roucool**.");
    assert.equal((await spawnRows()).at(0).species_id, species("Roucool").id);
    assert.equal(channel.sent.length, 1);
    assert.match(textOf(channel.sent[0]), /Halloween/);
  });

  it("shiny forcé, et mention du rôle forcée", async () => {
    const channel = fakeChannel();
    const reply = payloadOf(await run("pokespawn", { options: { espece: String(species("Roucool").id), shiny: true, ping: true } }, botWith(channel)), "editReply");
    assert.match(reply.content, /\(shiny\)/);
    assert.equal((await spawnRows()).at(0).is_shiny, 1);
    assert.match(channel.sent[0].content, /<@&role-pokemon>/);
  });

  it("sans espèce : une apparition aléatoire", async () => {
    const reply = payloadOf(await run("pokespawn", {}, botWith(fakeChannel())), "editReply");
    assert.equal(reply.content, "✅ Spawn déclenché : **espèce aléatoire**.");
    assert.equal((await spawnRows()).length, 1);
  });

  it("une génération fermée ne s'ouvre pas en douce par un événement", async () => {
    const closed = data.allSpeciesData().find((entry) => entry.generation === 2);
    const reply = payloadOf(await run("pokespawn", { options: { espece: String(closed.id) } }, botWith(fakeChannel())), "editReply");
    assert.match(reply.content, new RegExp(`^❌ \\*\\*${closed.name}\\*\\* est de génération 2, et le jeu s'arrête pour l'instant à la génération 1`));
    assert.match(payloadOf(await run("pokespawn", { options: { espece: "99999" } }, botWith(fakeChannel())), "editReply").content, /Espèce inconnue/);
    assert.deepEqual(await spawnRows(), []);
  });

  it("un créneau déjà pris : « réessaie », sans second Pokémon", async () => {
    await dbRun(points, "UPDATE pokemon_state SET spawning = 1 WHERE id = 1");
    const reply = payloadOf(await run("pokespawn", {}, botWith(fakeChannel())), "editReply");
    assert.match(reply.content, /Un spawn est déjà en cours de création/);
    assert.deepEqual(await spawnRows(), []);
  });

  it("sans salon configuré, la commande le dit", async () => {
    const saved = process.env.POKEMON_CHANNEL_ID;
    delete process.env.POKEMON_CHANNEL_ID;
    try {
      assert.match(payloadOf(await run("pokespawn"), "editReply").content, /POKEMON_CHANNEL_ID.*n'est pas configuré/);
      assert.match(payloadOf(await run("safarispawn"), "editReply").content, /POKEMON_CHANNEL_ID.*n'est pas configuré/);
    } finally {
      process.env.POKEMON_CHANNEL_ID = saved;
    }
  });

  it("l'autocomplétion marque les espèces hors pool et les légendaires", async () => {
    const choices = payloadOf(await runAutocomplete(admin, asAdmin({ sub: "pokespawn", focused: { name: "espece", value: "mewtwo" } })), "respond");
    assert.match(choices[0].name, /^#150 Mewtwo ⭐$/);
    const traded = payloadOf(await runAutocomplete(admin, asAdmin({ sub: "pokespawn", focused: { name: "espece", value: "mackogneur" } })), "respond");
    assert.match(traded[0].name, /\(hors pool\)/);
  });
});

describe("/admin safarispawn", () => {
  const botWith = (channel) => ({ channels: { fetch: async () => channel } });
  const parks = () => dbAll(points, "SELECT status, reserved_for FROM pokemon_safari_parks");

  it("ouvre un parc public, et suspend les apparitions par défaut", async () => {
    const reply = payloadOf(await run("safarispawn", {}, botWith(fakeChannel())), "editReply");
    assert.match(reply.content, /^✅ Parc safari \*\*#\d+\*\* ouvert\./);
    assert.deepEqual((await parks()).map((row) => row.status), ["OPEN"]);
    assert.ok((await dbGet(points, "SELECT spawn_paused_until FROM pokemon_state WHERE id = 1")).spawn_paused_until > Date.now());
  });

  it("réservé à un dresseur : le salon continue sa vie normale", async () => {
    const reply = payloadOf(await run("safarispawn", { users: { joueur: fakeUser("u2") } }, botWith(fakeChannel())), "editReply");
    assert.match(reply.content, /ouvert pour \*\*user-u2\*\*/);
    assert.doesNotMatch(reply.content, /suspendues/);
    assert.equal((await parks())[0].reserved_for, "u2");
  });

  it("un seul parc public à la fois", async () => {
    await run("safarispawn", {}, botWith(fakeChannel()));
    const again = payloadOf(await run("safarispawn", {}, botWith(fakeChannel())), "editReply");
    assert.match(again.content, /^❌ Un parc safari est déjà ouvert/);
    assert.equal((await parks()).length, 1);
  });

  it("la durée du parc est celle du réglage", async () => {
    await run("safarispawn", {}, botWith(fakeChannel()));
    const [park] = await dbAll(points, "SELECT opened_at, expires_at FROM pokemon_safari_parks");
    assert.equal(Math.round((park.expires_at - park.opened_at) / 3_600_000), getSafariConfig().parkDurationHours);
  });
});

describe("/admin purge", () => {
  // Les liens Discord portent des identifiants numériques.
  const messagesOf = (count) => Array.from({ length: count }, (_, index) => ({ id: String(1000 + index) }));
  const roomOf = (messages = []) => fakeChannel({ id: "2", messages });
  const purge = (options, channel) => run("purge", { options, channel, channelId: "2" });
  const link = (channelId, messageId) => `https://discord.com/channels/1/${channelId}/${messageId}`;

  it("sans paramètre, la commande demande lequel", async () => {
    assert.equal(payloadOf(await purge({}, roomOf()), "editReply").content, "Veuillez entrer un paramètre");
  });

  it("supprime le nombre demandé, jamais plus de cent", async () => {
    const channel = roomOf(messagesOf(150));
    assert.match(payloadOf(await purge({ nombre: 5 }, channel), "editReply").content, /^5 message\(s\) supprimé\(s\)\.$/);
    assert.equal(channel.fetched[0].limit, 5);
    const big = roomOf(messagesOf(150));
    await purge({ nombre: 100 }, big);
    assert.equal(big.fetched[0].limit, 100);
    assert.equal(big.deleted.length, 100);
  });

  it("jusqu'à un lien : la borne se vérifie AVANT de supprimer quoi que ce soit", async () => {
    const channel = roomOf(messagesOf(10));
    for (const lien of ["n'importe quoi", link("9", "1005"), "https://example.com/channels/1/2/1005", "https://discord.com/channels/1/2/abc"]) {
      assert.match(payloadOf(await purge({ lien }, channel), "editReply").content, /^❌ Lien invalide/, lien);
    }
    assert.deepEqual(channel.deleted, [], "un lien mal collé ne vide pas le salon");
  });

  it("un message borne introuvable : dit sans supprimer", async () => {
    const channel = roomOf(messagesOf(3));
    const reply = payloadOf(await purge({ lien: link("2", "424242") }, channel), "editReply").content;
    assert.match(reply, /^❌ Ce message est introuvable dans ce salon/);
    assert.deepEqual(channel.deleted, []);
  });

  it("rien après le message du lien : « aucun message à supprimer »", async () => {
    const channel = roomOf([{ id: "1000" }]);
    channel.messages.fetch = async (arg) => (typeof arg === "string" ? { id: arg } : new Map());
    assert.match(payloadOf(await purge({ lien: link("2", "1000") }, channel), "editReply").content, /^Aucun message à supprimer après ce lien/);
  });

  it("supprime ce qui suit le message du lien, et prévient quand la limite de cent est atteinte", async () => {
    const channel = roomOf(messagesOf(120));
    const calls = await purge({ lien: link("2", "1000") }, channel);
    assert.match(payloadOf(calls, "editReply").content, /^100 message\(s\) supprimé\(s\) jusqu'au lien indiqué\.\n⚠️ Limite de 100 messages atteinte/);
    assert.equal(channel.deleted.length, 100);
  });
});

describe("/admin restart", () => {
  let exit;
  afterEach(() => {
    process.exit = exit;
  });

  it("répond, déconnecte le bot, puis quitte", async () => {
    exit = process.exit;
    const codes = [];
    process.exit = (code) => codes.push(code);
    let destroyed = false;
    const calls = await run("restart", {}, { destroy: async () => (destroyed = true) });
    assert.equal(payloadOf(calls, "editReply").content, "Redémarrage en cours...");
    assert.equal(destroyed, true);
    assert.deepEqual(codes, [0]);
  });
});
