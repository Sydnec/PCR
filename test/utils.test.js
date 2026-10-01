// Les utilitaires du bot : la garde d'administration, les rôles en libre-service
// (une réaction ne doit jamais accorder un rôle de modération), le journal (une
// entrée = une ligne, quoi qu'on y mette), et le découpage des messages.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EmbedBuilder, PermissionsBitField } from "discord.js";
import axios from "axios";
import { createSandbox } from "./helpers.js";

createSandbox();
const utils = await import("../modules/utils.js");
const Flags = PermissionsBitField.Flags;

const memberWith = (...flags) => ({ permissions: new PermissionsBitField(flags) });

// Capture ce qu'une fonction écrit sur la console.
async function captured(method, run) {
  const original = console[method];
  const lines = [];
  console[method] = (...args) => lines.push(args);
  try {
    await run();
  } finally {
    console[method] = original;
  }
  return lines;
}

describe("la garde d'administration", () => {
  it("seul un membre qui a la permission Administrateur passe", () => {
    assert.equal(utils.isAdmin(memberWith(Flags.Administrator)), true);
    assert.equal(utils.isAdmin(memberWith(Flags.ManageGuild, Flags.ManageRoles)), false);
    assert.equal(utils.isAdmin(memberWith()), false);
  });

  it("hors d'un serveur (pas de membre) : refusé, jamais une exception", () => {
    assert.equal(utils.isAdmin(null), false);
    assert.equal(utils.isAdmin(undefined), false);
    assert.equal(utils.isAdmin({}), false);
    assert.equal(utils.isAdmin({ permissions: null }), false);
  });
});

describe("les rôles en libre-service", () => {
  const role = (name, position, extra = {}) => ({
    id: `id-${name}`,
    name,
    position,
    managed: false,
    permissions: new PermissionsBitField(0n),
    ...extra,
  });
  const guildOf = (roles) => ({ roles: { cache: new Map(roles.map((entry) => [entry.id, entry])) } });
  const ping = role("ping", 10);
  process.env.PING_ROLE_ID = ping.id;
  const names = (list) => list.map((entry) => entry.name).sort();

  it("seuls les rôles situés sous le rôle de ping peuvent s'obtenir", async () => {
    const guild = guildOf([ping, role("🔔 sous", 5), role("🎮 au-dessus", 11), role("🎲 à égalité", 10)]);
    assert.deepEqual(names(utils.selfServiceRoles(guild)), ["🔔 sous"]);
  });

  it("un rôle géré par une intégration est exclu", () => {
    const guild = guildOf([ping, role("🤖 bot", 5, { managed: true }), role("🔔 libre", 4)]);
    assert.deepEqual(names(utils.selfServiceRoles(guild)), ["🔔 libre"]);
  });

  it("un rôle qui porte une permission sensible n'est jamais attribuable, quel que soit son rang", () => {
    const sensitive = [
      Flags.Administrator, Flags.ManageGuild, Flags.ManageRoles, Flags.ManageChannels, Flags.ManageMessages, Flags.ManageWebhooks,
      Flags.ManageNicknames, Flags.ManageEmojisAndStickers, Flags.KickMembers, Flags.BanMembers, Flags.ModerateMembers, Flags.MentionEveryone,
    ];
    const roles = sensitive.map((flag, index) => role(`🛡️ ${index}`, 5, { permissions: new PermissionsBitField(flag) }));
    const guild = guildOf([ping, role("🔔 libre", 4), ...roles, role("🎤 voix", 3, { permissions: new PermissionsBitField(Flags.Speak) })]);
    assert.deepEqual(names(utils.selfServiceRoles(guild)), ["🎤 voix", "🔔 libre"]);
  });

  it("sans serveur, ou sans rôle de ping, personne ne reçoit rien", async () => {
    assert.deepEqual(utils.selfServiceRoles(null), []);
    const guild = guildOf([role("🔔 libre", 4)]);
    let result;
    const lines = await captured("error", () => {
      result = utils.selfServiceRoles(guild);
    });
    assert.deepEqual(result, []);
    assert.ok(lines.some((args) => args.join(" ").includes("PING_ROLE_ID introuvable")), "l'oubli est journalisé");
  });

  it("une réaction n'accorde que le rôle dont le nom commence par son emoji", () => {
    const guild = guildOf([ping, role("🔔 Ping", 5), role("🎮 Jeux", 4), role("🔔 Autre", 3), role("🔨 Modération", 9, { permissions: new PermissionsBitField(Flags.BanMembers) })]);
    assert.deepEqual(names(utils.rolesForReactionEmoji(guild, "🔔")), ["🔔 Autre", "🔔 Ping"]);
    assert.deepEqual(names(utils.rolesForReactionEmoji(guild, "🔨")), [], "l'emoji d'un rôle de modération n'accorde rien");
    assert.deepEqual(utils.rolesForReactionEmoji(guild, "🍕"), []);
    assert.deepEqual(utils.rolesForReactionEmoji(guild, null), []);
    assert.deepEqual(utils.rolesForReactionEmoji(guild, ""), []);
  });
});

describe("petites fonctions", () => {
  afterEach(() => {
    delete process.env.ENV;
  });

  it("une commande se coupe au premier blanc", () => {
    assert.deepEqual(utils.getCommand("!poll question longue ici"), ["!poll", "question longue ici"]);
    assert.deepEqual(utils.getCommand("!seul"), ["!seul"]);
    assert.deepEqual(utils.getCommand(), [""]);
    assert.deepEqual(utils.getCommand("!a   b"), ["!a", "b"]);
  });

  it("la production se reconnaît à ENV", () => {
    assert.equal(utils.environmentIsProd(), false);
    process.env.ENV = "production";
    assert.equal(utils.environmentIsProd(), true);
    process.env.ENV = "development";
    assert.equal(utils.environmentIsProd(), false);
  });

  it("l'identifiant d'un rôle se lit par son nom, -1 s'il n'existe pas", () => {
    const guild = { roles: { cache: new Map([["1", { id: "1", name: "Admin" }]]) } };
    guild.roles.cache.find = (predicate) => [...guild.roles.cache.values()].find(predicate);
    assert.equal(utils.getRoleID("Admin", guild), "1");
    assert.equal(utils.getRoleID("Inconnu", guild), -1);
  });
});

describe("le journal : une entrée, une ligne", () => {
  it("date chaque ligne et garde les arguments suivants", async () => {
    const lines = await captured("log", () => utils.log("bonjour", 42));
    assert.equal(lines.length, 1);
    assert.match(lines[0][0], /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} -$/);
    assert.deepEqual(lines[0].slice(1), ["bonjour", 42]);
  });

  it("des retours à la ligne ou des séquences de contrôle ne fabriquent pas de fausses lignes", async () => {
    const lines = await captured("log", () => utils.log("pseudo\n01/01/2000 00:00:00 - Faux journal\r\nsuite", "x\u001b[2Jy", "a\u2028b\u0085c"));
    const text = lines[0].slice(1).join(" ");
    // eslint-disable-next-line no-control-regex -- ce sont eux qu'on vérifie absents
    assert.doesNotMatch(text, /[\n\r\u001b\u2028\u0085]/);
    assert.match(text, /pseudo 01\/01\/2000 00:00:00 - Faux journal\s+suite/);
  });

  it("une erreur garde sa pile : seul le texte est assaini", async () => {
    const failure = new Error("panne");
    const lines = await captured("error", () => utils.handleException("Contexte :", failure));
    assert.equal(lines[0][1], "Contexte :");
    assert.equal(lines[0][2], failure);
    assert.match(lines[0][2].stack, /\n\s+at /);
  });

  it("handleException accepte plusieurs arguments, et même aucun", async () => {
    assert.equal((await captured("error", () => utils.handleException("a", "b", new Error("c")))).length, 1);
    assert.equal((await captured("error", () => utils.handleException())).length, 1);
  });
});

describe("couper un message (splitMessage)", () => {
  it("un texte court tient en un seul morceau, terminé par un retour à la ligne", () => {
    assert.deepEqual(utils.splitMessage("a\nb"), ["a\nb\n"]);
  });

  it("aucun morceau ne dépasse la limite, et aucune ligne n'est coupée ni perdue", () => {
    const lines = Array.from({ length: 300 }, (_, index) => `ligne ${index} ${"x".repeat(index % 40)}`);
    const parts = utils.splitMessage(lines.join("\n"), 500);
    assert.ok(parts.length > 1);
    for (const part of parts) assert.ok(part.length <= 500, `${part.length} caractères`);
    assert.deepEqual(parts.join("").split("\n").filter(Boolean), lines);
  });

  it("la limite par défaut est celle de Discord : 2000", () => {
    const parts = utils.splitMessage(Array.from({ length: 200 }, () => "y".repeat(49)).join("\n"));
    assert.ok(parts.every((part) => part.length <= 2000));
    assert.ok(parts.length >= 5);
  });

  // Une première ligne plus longue que la limite pousse d'abord un message vide :
  // Discord refuse d'envoyer « rien ». Seule la liste des fils s'en sert, avec des
  // noms de fils (100 caractères au plus) : jamais atteint en pratique.
  it.todo("une ligne plus longue que la limite ne produit pas de message vide");
});

describe("couper un embed trop long (splitEmbed)", () => {
  // Construit depuis les données brutes : le constructeur de champs refuse déjà
  // plus de 1024 caractères, mais un embed relu d'un message, lui, n'est pas validé.
  const embed = (fields) => new EmbedBuilder({ title: "Titre", description: "Desc", color: 0x123456, footer: { text: "pied" }, fields });

  it("un embed dont les champs tiennent est rendu tel quel", () => {
    const original = embed([{ name: "a", value: "court" }]);
    const result = utils.splitEmbed(original);
    assert.equal(result.length, 1);
    assert.equal(result[0], original);
    assert.deepEqual(utils.splitEmbed(new EmbedBuilder().setTitle("sans champs")).length, 1);
  });

  it("un champ de plus de 1024 caractères est réparti sur plusieurs embeds, sans perdre une ligne", () => {
    const lines = Array.from({ length: 120 }, (_, index) => `entrée numéro ${index} ${"z".repeat(20)}`);
    const result = utils.splitEmbed(embed([{ name: "Liste", value: lines.join("\n"), inline: false }]));
    assert.ok(result.length >= 2);
    const fields = result.flatMap((entry) => entry.data.fields ?? []);
    for (const field of fields) assert.ok(field.value.length <= 1024, `${field.value.length} caractères`);
    assert.deepEqual(fields.flatMap((field) => field.value.split("\n")).filter(Boolean), lines);
    assert.equal(result[0].data.title, "Titre", "le titre n'est que sur le premier");
    assert.equal(result[1].data.title, undefined);
    assert.ok(result.every((entry) => entry.data.footer?.text === "pied" && entry.data.color === 0x123456));
    assert.equal(fields[0].name, "Liste");
    assert.ok(fields.slice(1).every((field) => field.name === "Liste (suite)"));
  });

  it("les champs courts qui accompagnent un champ trop long sont conservés", () => {
    const long = Array.from({ length: 80 }, (_, index) => `ligne ${index} ${"q".repeat(30)}`).join("\n");
    const result = utils.splitEmbed(embed([{ name: "court", value: "ok" }, { name: "long", value: long }]));
    const names = result.flatMap((entry) => (entry.data.fields ?? []).map((field) => field.name));
    assert.ok(names.includes("court"));
    assert.ok(names.includes("long"));
  });
});

describe("messages programmés pour suppression (dbAddDeleteMessage)", () => {
  const fakeDb = ({ existing = null, getError = null, runError = null } = {}) => {
    const runs = [];
    return {
      runs,
      get: (sql, params, cb) => cb(getError, existing),
      run: (sql, params, cb) => {
        runs.push({ sql, params });
        cb(runError);
      },
    };
  };

  it("un message nouveau est inséré", async () => {
    const db = fakeDb();
    const lines = await captured("log", () => utils.dbAddDeleteMessage("m1", "https://lien", 1_800_000_000_000, db));
    assert.match(db.runs[0].sql, /INSERT INTO messages/);
    assert.deepEqual(db.runs[0].params, ["m1", "https://lien", 1_800_000_000_000]);
    assert.match(lines[0].join(" "), /Message programmé pour suppression le .* : https:\/\/lien/);
    assert.doesNotMatch(lines[0].join(" "), /\(MàJ\)/);
  });

  it("un message déjà connu voit son échéance mise à jour, pas dupliquée", async () => {
    const db = fakeDb({ existing: { id: "m1" } });
    const lines = await captured("log", () => utils.dbAddDeleteMessage("m1", "https://lien", 123, db));
    assert.match(db.runs[0].sql, /UPDATE messages SET expire_at/);
    assert.deepEqual(db.runs[0].params, [123, "m1"]);
    assert.match(lines[0].join(" "), /\(MàJ\)/);
  });

  it("une base qui échoue est journalisée, sans lever", async () => {
    const readFail = fakeDb({ getError: new Error("lecture") });
    const readLines = await captured("error", () => utils.dbAddDeleteMessage("m1", "l", 1, readFail));
    assert.equal(readLines.length, 1);
    assert.equal(readFail.runs.length, 0);
    const writeFail = fakeDb({ runError: new Error("écriture") });
    const writeLines = await captured("error", () => utils.dbAddDeleteMessage("m1", "l", 1, writeFail));
    assert.equal(writeLines.length, 1);
  });
});

describe("les fêtes du jour (fetchFetesDuJour)", () => {
  const original = axios.get;
  afterEach(() => {
    axios.get = original;
  });

  it("lit les titres de la page, nettoyés, sans doublon ni titre de trois lettres ou moins", async () => {
    let requested;
    axios.get = async (url, options) => {
      requested = { url, options };
      return {
        data: `<div id="journeesDuJour">
          <article><h2 itemprop="name">  Journée   mondiale
            du câlin </h2></article>
          <article><h2>Journée mondiale du câlin</h2></article>
          <article><h2>Fin</h2></article>
          <article><h2>Journée de la     lenteur</h2></article>
        </div><h2>Hors section : ignoré</h2>`,
      };
    };
    const result = await utils.fetchFetesDuJour(3, 9);
    assert.equal(requested.url, "https://www.journee-mondiale.com/date/03-09.htm");
    assert.match(requested.options.headers["User-Agent"], /PCR-bot/);
    assert.deepEqual(result, ["Journée mondiale du câlin", "Journée de la lenteur"]);
  });

  it("une page sans section ne donne rien", async () => {
    axios.get = async () => ({ data: "<html><body><h2>Rien</h2></body></html>" });
    assert.deepEqual(await utils.fetchFetesDuJour(31, 12), []);
  });

  it("un site injoignable remonte l'erreur à l'appelant", async () => {
    axios.get = async () => {
      throw new Error("réseau");
    };
    await assert.rejects(() => utils.fetchFetesDuJour(1, 1), /réseau/);
  });
});

describe("les réactions d'un sondage (autoAddEmojis)", () => {
  const messageOf = (content, { author = "user", emojis = [] } = {}) => {
    const reactions = [];
    const calls = { edit: [], sent: [], deleted: false };
    return {
      reactions,
      calls,
      content,
      author: { id: author },
      guild: { emojis: { cache: { find: (predicate) => emojis.find(predicate) } } },
      react: (emoji) => reactions.push(emoji),
      edit: (text) => calls.edit.push(text),
      delete: async () => {
        calls.deleted = true;
      },
      thread: { send: async (text) => (calls.sent.push(text), { react: (emoji) => reactions.push(emoji) }) },
    };
  };

  it("des lignes qui portent déjà un emoji : on réagit avec, sans toucher au message", async () => {
    const message = messageOf("🍕 pizza\n🍔 burger");
    await utils.autoAddEmojis(message);
    assert.deepEqual(message.reactions, ["🍕", "🍔"]);
    assert.deepEqual(message.calls.edit, []);
    assert.equal(message.calls.deleted, false);
  });

  it("des lignes sans emoji sont numérotées : le message du bot est édité, les réactions suivent", async () => {
    process.env.CLIENT_ID = "bot-1";
    const message = messageOf("pizza\nburger\nsalade", { author: "bot-1" });
    await utils.autoAddEmojis(message);
    assert.equal(message.calls.edit.length, 1);
    assert.match(message.calls.edit[0], /1️⃣ pizza\n2️⃣ burger\n3️⃣ salade/);
    assert.deepEqual(message.reactions, ["1️⃣", "2️⃣", "3️⃣"]);
  });

  it("le message d'un membre est republié par le bot dans son fil, puis supprimé", async () => {
    process.env.CLIENT_ID = "bot-1";
    const message = messageOf("pizza\nburger", { author: "membre-1" });
    await utils.autoAddEmojis(message);
    assert.equal(message.calls.sent.length, 1);
    assert.match(message.calls.sent[0], /1️⃣ pizza\n2️⃣ burger/);
    assert.equal(message.calls.deleted, true);
    assert.deepEqual(message.reactions, ["1️⃣", "2️⃣"]);
  });

  it("un titre (#) n'est pas une option et ne prend pas de numéro", async () => {
    process.env.CLIENT_ID = "bot-1";
    const message = messageOf("# Titre\npizza\nburger", { author: "bot-1" });
    await utils.autoAddEmojis(message);
    assert.deepEqual(message.reactions, ["1️⃣", "2️⃣"]);
    assert.match(message.calls.edit[0], /^ # Titre\n/);
  });

  it("une panne est journalisée, sans lever", async () => {
    const message = messageOf("pizza");
    message.thread = null;
    const lines = await captured("error", () => utils.autoAddEmojis(message));
    assert.equal(lines.length, 1);
  });
});
