// Ce qui se passe à chaque message du serveur — les points gagnés, les statistiques,
// le compteur du jeu — et la réécriture des liens X/Instagram, avec son bouton de
// traduction. Les points sont l'économie entière : une récompense par heure, qui
// baisse avec le rang du message dans la journée, et que deux messages simultanés
// ne doivent pas toucher deux fois.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { createSandbox, openDatabases, dbRun, dbGet, dbAll, sleep, speciesByName } from "./helpers.js";

const sandbox = createSandbox({ config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } } });
process.env.POKEMON_CHANNEL_ID = "123";
const { points, stats } = await openDatabases();
const { execute } = await import("../events/client/messageCreate.js");
const links = await import("../modules/links.js");
const data = await import("../modules/pokemon/data.js");
const { getConfig } = await import("../modules/config.js");

const species = (name) => speciesByName(data.allSpecies, name);
const GEN1 = { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } };
const HOUR = 3_600_000;
const today = () => new Date().toISOString().slice(0, 10);
const distribution = () => getConfig().messagePointsDistribution;

// Un message : son auteur, son contenu, son salon — et un serveur, sauf en MP.
function message(content, { user = "u1", bot = false, guild = true, channel = null } = {}) {
  const sent = [];
  const deleted = [];
  const room = channel ?? {
    id: "chan-1",
    send: async (payload) => {
      sent.push(payload);
      return { id: "copy-1", edit: async (edit) => sent.push({ edit }) };
    },
  };
  return {
    sent,
    deleted,
    author: { id: user, bot },
    content,
    channel: room,
    guild: guild ? { id: "g" } : null,
    client: { channels: { fetch: async () => room } },
    delete: async () => deleted.push(true),
  };
}
const send = async (...args) => {
  const msg = message(...args);
  await execute(msg);
  await sleep(40);
  return msg;
};
const row = (user = "u1") => dbGet(points, "SELECT * FROM points WHERE user_id = ?", [user]);
const balance = async (user = "u1") => (await row(user))?.balance ?? 0;
const back = (user, ms) => dbRun(points, "UPDATE points SET last_message_at = last_message_at - ? WHERE user_id = ?", [ms, user]);

beforeEach(async () => {
  for (const table of ["points", "pokemon_eggs", "pokemon_owned", "points_log"]) await dbRun(points, `DELETE FROM ${table}`);
  for (const table of ["message_stats", "word_stats", "emoji_stats"]) await dbRun(stats, `DELETE FROM ${table}`);
  await dbRun(points, "UPDATE pokemon_state SET message_count = 0, spawning = 1 WHERE id = 1");
  sandbox.writeConfig(GEN1);
});

describe("les points des messages", () => {
  it("le premier message du jour rapporte le plus ; la ligne retient l'heure, le rang et le jour", async () => {
    const before = Date.now();
    await send("bonjour");
    const state = await row();
    assert.equal(state.balance, distribution()[1]);
    assert.equal(state.messages_today_count, 1);
    assert.equal(state.last_reset_date, today());
    assert.ok(state.last_message_at >= before);
  });

  it("un message de plus dans l'heure ne rapporte rien et ne change aucun compteur", async () => {
    await send("un");
    const first = await row();
    await send("deux");
    await send("trois");
    assert.deepEqual(await row(), first);
  });

  it("chaque heure écoulée donne le rang suivant, de moins en moins bien payé, puis le tarif par défaut", async () => {
    const expected = [1, 2, 3, 4, 5, 6, 7, 8].map((rank) => distribution()[rank] ?? distribution().default);
    for (let rank = 1; rank <= 8; rank++) {
      if (rank > 1) await back("u1", HOUR + 1000);
      await send(`message ${rank}`);
      assert.equal(await balance(), expected.slice(0, rank).reduce((sum, value) => sum + value, 0), `après le rang ${rank}`);
      assert.equal((await row()).messages_today_count, rank);
    }
    assert.ok(distribution()[1] > distribution()[2] && distribution()[2] > distribution()[3], "la récompense baisse avec le rang");
  });

  it("une heure pile après la dernière récompense, la suivante est accordée ; une minute avant, non", async () => {
    await send("un");
    await back("u1", HOUR - 60_000);
    await send("trop tôt");
    assert.equal(await balance(), distribution()[1]);
    await back("u1", 120_000);
    await send("assez tard");
    assert.equal(await balance(), distribution()[1] + distribution()[2]);
  });

  it("un nouveau jour repart du rang 1, même moins d'une heure après un message de la veille", async () => {
    await send("hier soir");
    await dbRun(points, "UPDATE points SET last_reset_date = '2000-01-01', messages_today_count = 5 WHERE user_id = 'u1'");
    await send("ce matin");
    const state = await row();
    assert.equal(state.messages_today_count, 1, "le compteur est remis à zéro");
    assert.equal(state.balance, distribution()[1] * 2);
    assert.equal(state.last_reset_date, today());
  });

  it("chacun a son compteur", async () => {
    await send("a", { user: "u1" });
    await send("b", { user: "u2" });
    assert.equal(await balance("u1"), distribution()[1]);
    assert.equal(await balance("u2"), distribution()[1]);
  });

  it("dix messages simultanés du même dresseur : une seule récompense", async () => {
    await Promise.all(Array.from({ length: 10 }, (_, index) => execute(message(`message ${index}`))));
    await sleep(200);
    const state = await row();
    assert.equal(state.balance, distribution()[1]);
    assert.equal(state.messages_today_count, 1);
  });

  it("un bot ne gagne rien, ne compte nulle part", async () => {
    await send("je suis un bot", { user: "bot-1", bot: true });
    assert.equal(await row("bot-1"), undefined);
    assert.deepEqual(await dbAll(stats, "SELECT * FROM message_stats"), []);
  });

  it("le barème se règle à chaud : un rang à zéro retombe sur le tarif par défaut, et un tarif nul ne paie rien", async () => {
    sandbox.writeConfig({ ...GEN1, messagePointsDistribution: { 1: 10, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, default: 0 } });
    await send("un");
    assert.equal(await balance(), 10);
    await back("u1", HOUR + 1000);
    await send("deux");
    assert.equal(await balance(), 10, "le rang 2 vaut zéro, donc le tarif par défaut, ici nul");
    assert.equal((await row()).messages_today_count, 1, "rien n'est consigné quand il n'y a rien à payer");
  });

  it("un config.json illisible n'arrête pas les points : le barème par défaut s'applique", async () => {
    sandbox.writeRaw("{illisible");
    await send("un");
    assert.equal(await balance(), 750);
  });
});

describe("les statistiques de messages", () => {
  it("compte le message par dresseur, salon et jour, et pour le serveur entier", async () => {
    await send("un");
    await send("deux");
    const rows = await dbAll(stats, "SELECT user_id, channel_id, date, count FROM message_stats ORDER BY user_id");
    assert.deepEqual(rows, [
      { user_id: "__global__", channel_id: "__global__", date: today(), count: 2 },
      { user_id: "u1", channel_id: "chan-1", date: today(), count: 2 },
    ]);
  });

  it("compte les mots de plus de deux lettres, en minuscules et sans ponctuation", async () => {
    await send("Salut, SALUT ! Un petit mot de l'été... et 420 chats-noirs.");
    const words = Object.fromEntries((await dbAll(stats, "SELECT word, count FROM word_stats")).map((entry) => [entry.word, entry.count]));
    assert.equal(words.salut, 2);
    assert.equal(words.petit, 1);
    assert.equal(words["l'été"], 1, "l'apostrophe et les accents font partie du mot");
    assert.equal(words["chats-noirs"], 1);
    assert.equal(words["420"], 1);
    assert.equal(words.un, undefined, "trop court");
    assert.equal(words.de, undefined);
  });

  it("compte les emojis du dresseur et ceux du serveur", async () => {
    await send("super 🎉🎉 et 😀");
    const all = await dbAll(stats, "SELECT user_id, emoji, count FROM emoji_stats ORDER BY user_id, emoji");
    const of = (user, emoji) => all.find((entry) => entry.user_id === user && entry.emoji === emoji)?.count;
    assert.equal(of("u1", "🎉"), 2);
    assert.equal(of("__global__", "🎉"), 2);
    assert.equal(of("u1", "😀"), 1);
  });
});

describe("le compteur du jeu", () => {
  it("un message du serveur compte pour les apparitions, un message privé non", async () => {
    await send("salon", { guild: true });
    await send("privé", { guild: false });
    assert.equal((await dbGet(points, "SELECT message_count FROM pokemon_state WHERE id = 1")).message_count, 1);
  });

  it("un message du serveur rapproche aussi l'œuf de son auteur de l'éclosion", async () => {
    await dbRun(points, "INSERT INTO pokemon_eggs (user_id, species_id, father_species_id, mother_species_id, shiny_parents, status, messages, hatch_messages, laid_at, hatch_at) VALUES ('u1', ?, ?, ?, 0, 'INCUBATING', 0, 200, ?, ?)", [species("Rattata").id, species("Rattata").id, species("Rattata").id, Date.now(), Date.now() + 10 * HOUR]);
    await send("un message");
    await send("un autre");
    assert.equal((await dbGet(points, "SELECT messages FROM pokemon_eggs WHERE user_id = 'u1'")).messages, 2);
  });
});

describe("la réécriture des liens dans un message", () => {
  let original;
  beforeEach(() => {
    original = globalThis.fetch;
    sandbox.writeConfig({ ...GEN1, links: { translation: { enabled: false } } });
  });
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("republie le message avec le miroir, sous la mention de son auteur, sans la notifier ; l'original est supprimé", async () => {
    const msg = await send("regardez https://x.com/sacha/status/123456 c'est drôle");
    assert.equal(msg.sent.length, 1);
    assert.equal(msg.sent[0].content, "<@u1> a envoyé :\nregardez https://vxtwitter.com/sacha/status/123456 c'est drôle");
    assert.deepEqual(msg.sent[0].allowedMentions, { parse: [] });
    assert.equal(msg.deleted.length, 1);
  });

  it("un message sans lien à réécrire reste tel quel", async () => {
    const msg = await send("rien à voir https://example.com/page");
    assert.deepEqual(msg.sent, []);
    assert.deepEqual(msg.deleted, []);
  });

  it("un message qui ferait dépasser 2 000 caractères n'est pas copié : l'original reste", async () => {
    const msg = await send(`https://x.com/a/status/1 ${"x".repeat(1990)}`);
    assert.deepEqual(msg.sent, []);
    assert.deepEqual(msg.deleted, []);
  });

  it("si la publication échoue, l'original n'est jamais supprimé : rien ne se perd", async () => {
    const msg = message("https://x.com/a/status/1");
    msg.channel.send = async () => {
      throw new Error("Missing Permissions");
    };
    const original = console.error;
    console.error = () => {};
    try {
      await execute(msg);
      await sleep(60);
    } finally {
      console.error = original;
    }
    assert.deepEqual(msg.deleted, []);
  });
});

// ====================== LES LIENS ======================

describe("rewriteSocialLinks", () => {
  const rewrite = (text) => links.rewriteSocialLinks(text);

  it("X et Twitter, avec ou sans www, vont vers vxtwitter.com ; seul l'hôte change", () => {
    for (const host of ["x.com", "www.x.com", "twitter.com", "www.twitter.com"]) {
      const result = rewrite(`https://${host}/sacha/status/99?s=20#haut`);
      assert.equal(result.text, "https://vxtwitter.com/sacha/status/99?s=20#haut", host);
      assert.deepEqual(result.tweetIds, ["99"]);
    }
  });

  it("les reels Instagram vont vers kkinstagram.com, rien d'autre d'Instagram", () => {
    assert.equal(rewrite("https://www.instagram.com/reel/abc/").text, "https://kkinstagram.com/reel/abc/");
    assert.equal(rewrite("https://instagram.com/p/abc/"), null);
    assert.equal(rewrite("https://instagram.com/sacha"), null);
    assert.deepEqual(rewrite("https://instagram.com/reel/abc").tweetIds, []);
  });

  it("le tweet se lit dans les deux formes d'adresse, et un même tweet collé deux fois n'a qu'un identifiant", () => {
    assert.deepEqual(rewrite("https://x.com/i/web/status/5").tweetIds, ["5"]);
    assert.deepEqual(rewrite("https://twitter.com/a/statuses/6").tweetIds, ["6"]);
    assert.deepEqual(rewrite("https://x.com/a/status/7 https://x.com/b/status/8 https://x.com/a/status/7").tweetIds, ["7", "8"]);
    assert.deepEqual(rewrite("https://x.com/sacha").tweetIds, [], "un profil n'est pas un tweet");
  });

  it("l'hôte se compare exactement : les adresses qui y ressemblent ne sont jamais réécrites", () => {
    const imposters = [
      "https://x.com.pirate.net/a/status/1",
      "https://pirate.net/x.com/a/status/1",
      "https://notx.com/a/status/1",
      "https://x.com@pirate.net/a/status/1",
      "https://twitter.com.evil.example/",
      "https://ixcom.example/",
      "https://x.co/a/status/1",
    ];
    for (const link of imposters) assert.equal(rewrite(link), null, link);
  });

  it("la casse, le point final de l'hôte et le port ne trompent pas", () => {
    assert.equal(rewrite("HTTPS://X.COM/a/status/1").text, "https://vxtwitter.com/a/status/1");
    assert.equal(rewrite("https://x.com./a/status/1").text, "https://vxtwitter.com/a/status/1");
    assert.equal(rewrite("https://x.com:443/a/status/1").text, "https://vxtwitter.com/a/status/1");
  });

  it("ce qui entoure le lien dans la phrase ne lui appartient pas", () => {
    assert.equal(rewrite("voir https://x.com/a/status/1, merci").text, "voir https://vxtwitter.com/a/status/1, merci");
    assert.equal(rewrite("(https://x.com/a/status/1)").text, "(https://vxtwitter.com/a/status/1)");
    assert.equal(rewrite("`https://x.com/a/status/1`").text, "`https://vxtwitter.com/a/status/1`");
    assert.equal(rewrite("[https://x.com/a/status/1]").text, "[https://vxtwitter.com/a/status/1]");
  });

  it("un lien entre chevrons garde son aperçu coupé : on n'y touche pas", () => {
    assert.equal(rewrite("<https://x.com/a/status/1>"), null);
    assert.equal(rewrite("<https://x.com/a/status/1> et https://x.com/b/status/2").text, "<https://x.com/a/status/1> et https://vxtwitter.com/b/status/2");
  });

  it("un lien masqué ne se republie jamais sous le nom du bot : le texte peut mentir sur la destination", () => {
    assert.equal(rewrite("[x.com](https://evil.example/phishing) https://x.com/a/status/1"), null);
    assert.equal(rewrite("[clique](<https://evil.example>) https://x.com/a/status/1"), null);
    assert.equal(rewrite("[clique]( http://evil.example ) https://x.com/a/status/1"), null);
  });

  it("sans lien, avec un lien http, ou avec un autre site : rien à faire", () => {
    assert.equal(rewrite(""), null);
    assert.equal(rewrite("bonjour"), null);
    assert.equal(rewrite("http://x.com/a/status/1"), null, "seul https est reconnu");
    assert.equal(rewrite("https://example.com/x.com/status/1"), null);
    assert.equal(rewrite(undefined), null);
  });

  it("les autres liens du message restent tels quels", () => {
    const result = rewrite("https://example.com/a?x=1 puis https://x.com/b/status/3 et https://youtube.com/watch?v=1");
    assert.equal(result.text, "https://example.com/a?x=1 puis https://vxtwitter.com/b/status/3 et https://youtube.com/watch?v=1");
  });
});

describe("le bouton « Traduire »", () => {
  let original;
  const calls = [];
  const tweets = {};
  beforeEach(() => {
    sandbox.writeConfig({ ...GEN1, links: { translation: { enabled: true, maxTweets: 3 } } });
    original = globalThis.fetch;
    calls.length = 0;
    for (const key of Object.keys(tweets)) delete tweets[key];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      const [, id] = /status\/(\d+)/.exec(String(url));
      const entry = tweets[id];
      if (entry instanceof Error) throw entry;
      if (entry === 404) return { status: 404, ok: false };
      if (entry === 500) return { status: 500, ok: false };
      return { status: 200, ok: true, json: async () => ({ tweet: entry }) };
    };
  });
  afterEach(() => {
    globalThis.fetch = original;
  });
  const labelsOf = (row) => row?.toJSON().components.map((button) => button.label);
  const idsOf = (row) => row?.toJSON().components.map((button) => button.custom_id);
  const quiet = async (work) => {
    const saved = console.error;
    console.error = () => {};
    try {
      return await work();
    } finally {
      console.error = saved;
    }
  };

  it("un tweet en français, ou sans texte, n'a pas de bouton", async () => {
    tweets["1"] = { text: "Bonjour", lang: "fr", author: { screen_name: "sacha" } };
    tweets["2"] = { text: "", lang: "en" };
    tweets["3"] = { text: "🎉", lang: "zxx" };
    assert.equal(await links.translateButtons(["1"]), null);
    assert.equal(await links.translateButtons(["2"]), null);
    assert.equal(await links.translateButtons(["3"]), null);
  });

  it("un tweet étranger a son bouton, qui porte l'identifiant", async () => {
    tweets["10"] = { text: "Hello", lang: "en", author: { screen_name: "sacha" } };
    const row = await links.translateButtons(["10"]);
    assert.deepEqual(labelsOf(row), ["Traduire"]);
    assert.deepEqual(idsOf(row), ["tweet_translate|10"]);
  });

  it("plusieurs tweets : chaque bouton dit lequel, par son auteur, ou par sa place quand l'auteur ne suffit pas", async () => {
    tweets["11"] = { text: "Hello", lang: "en", author: { screen_name: "sacha" } };
    tweets["12"] = { text: "Hola", lang: "es", author: { screen_name: "ondine" } };
    tweets["13"] = { text: "Ciao", lang: "it", author: { screen_name: "sacha" } };
    assert.deepEqual(labelsOf(await links.translateButtons(["11", "12"])), ["Traduire @sacha", "Traduire @ondine"]);
    assert.deepEqual(labelsOf(await links.translateButtons(["11", "13"])), ["Traduire le tweet 1", "Traduire le tweet 2"]);
  });

  it("au plus le nombre de tweets réglé, et jamais une API muette qui bloque la copie", async () => {
    for (const id of ["21", "22", "23", "24"]) tweets[id] = { text: "Hello", lang: "en", author: { screen_name: `u${id}` } };
    assert.equal(idsOf(await links.translateButtons(["21", "22", "23", "24"])).length, 3);
    tweets["25"] = new Error("délai dépassé");
    tweets["26"] = 500;
    tweets["27"] = 404;
    assert.equal(await quiet(() => links.translateButtons(["25", "26", "27"])), null);
  });

  it("coupé par la configuration, plus aucun bouton ; sans tweet, rien à demander", async () => {
    sandbox.writeConfig({ ...GEN1, links: { translation: { enabled: false } } });
    tweets["30"] = { text: "Hello", lang: "en", author: { screen_name: "sacha" } };
    assert.equal(await links.translateButtons(["30"]), null);
    assert.equal(calls.length, 0, "aucune requête quand c'est coupé");
    sandbox.writeConfig({ ...GEN1, links: { translation: { enabled: true } } });
    assert.equal(await links.translateButtons([]), null);
  });

  const click = async (customId) => {
    const replies = [];
    const interaction = {
      customId,
      deferReply: async (payload) => replies.push({ method: "deferReply", payload }),
      editReply: async (payload) => replies.push({ method: "editReply", payload }),
      reply: async (payload) => replies.push({ method: "reply", payload }),
    };
    await links.replyTweetTranslation(interaction);
    return replies;
  };

  it("un identifiant qui n'est pas un numéro ne part jamais vers l'API", async () => {
    for (const customId of ["tweet_translate|abc", "tweet_translate|1/../x", "tweet_translate|", "tweet_translate"]) {
      const replies = await click(customId);
      assert.deepEqual(replies[0], { method: "reply", payload: { content: "Ce bouton n'est plus valable.", flags: MessageFlags.Ephemeral } }, customId);
    }
    assert.equal(calls.length, 0);
  });

  it("la traduction répond en privé : texte échappé, auteur, langue d'origine", async () => {
    tweets["40"] = {
      text: "Hello",
      lang: "en",
      author: { screen_name: "sacha", name: "Sacha" },
      translation: { text: "Bonjour *tout* le monde", source_lang: "en" },
    };
    const replies = await click("tweet_translate|40");
    assert.deepEqual(replies[0], { method: "deferReply", payload: { flags: MessageFlags.Ephemeral } });
    const embed = replies[1].payload.embeds[0].toJSON();
    assert.equal(embed.description, "Bonjour \\*tout\\* le monde");
    assert.equal(embed.author.name, "Sacha (@sacha)");
    assert.equal(embed.author.url, "https://x.com/sacha/status/40");
    assert.equal(embed.footer.text, "Traduction automatique · original en anglais");
    assert.match(calls.at(-1), /api\.fxtwitter\.com\/status\/40\/fr$/);
  });

  it("ce que Discord mettrait en forme est échappé, sauf les liens", async () => {
    tweets["41"] = {
      text: "orig",
      lang: "en",
      translation: { text: "# Titre\n> citation\n- liste\n1. un\n<@123> [piège](https://evil.example) voir https://exemple.fr/a_b_c.", source_lang: "en" },
    };
    const embed = (await click("tweet_translate|41"))[1].payload.embeds[0].toJSON();
    assert.match(embed.description, /^\\# Titre\n\\> citation\n\\- liste\n1\\\. un\n\\<@123> \\\[piège]\(https:\/\/evil\.example\) voir https:\/\/exemple\.fr\/a_b_c\.$/);
  });

  it("une traduction trop longue est coupée sans casser un lien en deux", async () => {
    tweets["42"] = { text: "orig", lang: "en", translation: { text: `${"a".repeat(4090)} https://exemple.fr/un-long-lien-qui-depasse`, source_lang: "en" } };
    const description = (await click("tweet_translate|42"))[1].payload.embeds[0].toJSON().description;
    assert.ok(description.length <= 4096);
    assert.ok(description.endsWith("…"));
    assert.doesNotMatch(description, /https?:\/\//, "le lien entamé est retiré en entier, pas laissé à moitié");
  });

  it("dit pourquoi il n'y a rien : tweet illisible, déjà en français, rien à traduire, API muette", async () => {
    tweets["50"] = 404;
    tweets["51"] = { text: "Salut", lang: "fr", translation: { text: "Salut" } };
    tweets["52"] = { text: "🎉 https://x.fr", lang: "en", translation: { text: "🎉 https://x.fr", source_lang: "en" } };
    tweets["53"] = { text: "Hello", lang: "en" };
    tweets["54"] = new Error("délai dépassé");
    const reply = async (id) => (await quiet(() => click(`tweet_translate|${id}`)))[1].payload.content;
    assert.match(await reply("50"), /n'est plus lisible : supprimé, ou son compte est protégé/);
    assert.match(await reply("51"), /déjà en français/);
    assert.match(await reply("52"), /rien à traduire/);
    assert.match(await reply("53"), /La traduction ne répond pas/);
    assert.match(await reply("54"), /La traduction ne répond pas/);
  });
});
