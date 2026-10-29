// /zarbi : un message écrit en Zarbi, dessiné dans une image publique, avec les seules
// lettres que le dresseur possède. Le reste du message ne se vérifie pas.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { PNG } from "pngjs";
import { createSandbox, openDatabases, dbRun } from "./helpers.js";
import { payloadOf, runCommand } from "./fake-discord.js";

const GEN1 = { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } };
// Chaque test a sa taille de case : le cache des illustrations est rangé par taille,
// et un test ne doit pas lire ce qu'un autre a téléchargé.
let cellSize = 32;
const gen2 = () => ({ pokemon: { generation: 2, unownText: { imageCell: ++cellSize, lettersPerLine: 4 } } });
const sandbox = createSandbox({ config: gen2() });
const { points } = await openDatabases();
const zarbi = (await import("../commands/zarbi.js")).default;
const data = await import("../modules/pokemon/data.js");
const unownText = await import("../modules/pokemon/unown-text.js");

const unown = data.unownSpecies();
const own = (letters, user = "u1") =>
  Promise.all(
    [...letters].map((form) =>
      dbRun(
        points,
        "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at, form) VALUES (?, ?, 0, NULL, 'test', 1, ?)",
        [user, unown.id, form]
      )
    )
  );
const write = (texte, user = "u1") => runCommand(zarbi, { user, options: { texte } });
const methods = (calls) => calls.map((entry) => entry.method);

// Une illustration d'un pixel opaque, ou une panne réseau.
const SPRITE = PNG.sync.write(Object.assign(new PNG({ width: 1, height: 1 }), { data: Buffer.from([10, 20, 30, 255]) }));
let original;
let fetched;
let offline;
beforeEach(async () => {
  sandbox.writeConfig(gen2());
  await dbRun(points, "DELETE FROM pokemon_owned");
  fetched = [];
  offline = false;
  original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    if (offline) throw new Error("hors ligne");
    return { ok: true, status: 200, arrayBuffer: async () => SPRITE };
  };
});
afterEach(() => {
  globalThis.fetch = original;
});

describe("/zarbi", () => {
  it("publie le message en image : une case par lettre, une case vide entre deux mots, des lignes de `lettersPerLine` cases", async () => {
    await own("abc");
    const calls = await write("Ab cab");
    assert.deepEqual(methods(calls), ["deferReply", "editReply"]);
    assert.equal(payloadOf(calls, "deferReply")?.flags, undefined, "publique : tout le salon la voit");
    const [file] = payloadOf(calls, "editReply").files;
    assert.equal(file.name, "zarbi.png");
    // « ab » et « cab » ne tiennent pas ensemble sur une ligne de 4 : deux lignes, la plus
    // longue de 3 cases, et un quart de case de marge autour.
    const png = PNG.sync.read(file.attachment);
    const margin = Math.round(cellSize / 4);
    assert.deepEqual([png.width, png.height], [3 * cellSize + 2 * margin, 2 * cellSize + 2 * margin]);
    assert.deepEqual([...png.data.subarray(((margin + 1) * png.width + margin + 1) * 4, ((margin + 1) * png.width + margin + 1) * 4 + 4)], [10, 20, 30, 255], "la lettre est dessinée");
    // Une illustration par lettre distincte : A est l'image par défaut de Zarbi.
    assert.deepEqual(fetched.map((url) => url.split("/").at(-1)).sort(), ["201-b.png", "201-c.png", "201.png"]);
  });

  it("seules les lettres comptent : accents, ponctuation, chiffres, emojis et mentions ne demandent rien", async () => {
    await own("jadoremngupi");
    const calls = await write("J'adore manger du pain 😂 <:pikachu:123> <a:danse:456> <@42> <#7> <t:1700000000:R> 2026 !");
    assert.deepEqual(methods(calls), ["deferReply", "editReply"], "ni le K de « pikachu », ni le T de la date");

    await own("ct");
    assert.deepEqual(methods(await write("Cœur été")), ["deferReply", "editReply"], "« œ » s'écrit OE, « é » s'écrit E");
  });

  it("des lettres manquent : refus privé qui les nomme et les compte, rien n'est publié", async () => {
    await own("a");
    await own("bc", "u2");
    const calls = await write("Bac à sable");
    assert.deepEqual(methods(calls), ["reply"]);
    const reply = payloadOf(calls, "reply");
    assert.equal(reply.flags, MessageFlags.Ephemeral);
    assert.equal(reply.content, "❌ Il te manque 5 lettres de Zarbi pour ce message : **B**, **C**, **E**, **L**, **S** (tu en as 1 sur 6).");
    assert.deepEqual(fetched, [], "aucune illustration téléchargée");

    assert.equal(payloadOf(await write("Ab", "u3"), "reply").content, "❌ Il te manque 2 lettres de Zarbi pour ce message : **A**, **B** (tu en as 0 sur 2).");
    await own("a", "u3");
    assert.equal(payloadOf(await write("Ab", "u3"), "reply").content, "❌ Il te manque 1 lettre de Zarbi pour ce message : **B** (tu en as 1 sur 2).");
  });

  it("un message sans lettre, ou trop long : refus privé, chiffré", async () => {
    await own("a");
    const empty = payloadOf(await write("😂 <:pikachu:123> 42 !"), "reply");
    assert.equal(empty.flags, MessageFlags.Ephemeral);
    assert.equal(empty.content, "❌ Ton message n'a aucune lettre à écrire en Zarbi.");

    sandbox.writeConfig({ pokemon: { generation: 2, unownText: { maxLetters: 3 } } });
    const long = payloadOf(await write("aa aa"), "reply");
    assert.equal(long.flags, MessageFlags.Ephemeral);
    assert.equal(long.content, "❌ Ton message a 4 lettres : 3 au plus.");
    assert.deepEqual(fetched, []);
  });

  it("génération fermée : refus privé, qui dit quand Zarbi arrive", async () => {
    await own("a");
    sandbox.writeConfig(GEN1);
    const reply = payloadOf(await write("a"), "reply");
    assert.equal(reply.flags, MessageFlags.Ephemeral);
    assert.equal(reply.content, `❌ Zarbi n'est pas encore dans le Pokédex : il arrive avec la ${unown.generation}ᵉ génération.`);
  });

  it("une illustration injoignable : la réponse publique disparaît, le refus est privé", async () => {
    await own("ab");
    offline = true;
    const saved = console.error;
    console.error = () => {};
    let calls;
    try {
      calls = await write("ab");
    } finally {
      console.error = saved;
    }
    assert.deepEqual(methods(calls), ["deferReply", "deleteReply", "followUp"]);
    const refusal = payloadOf(calls, "followUp");
    assert.equal(refusal.flags, MessageFlags.Ephemeral);
    assert.equal(refusal.content, "❌ Les Zarbi ne répondent pas, réessaie dans un instant.");
  });
});

describe("la mise en lignes", () => {
  const lines = (text, perLine) => unownText.unownLines(unownText.unownWords(text), perLine).map((line) => line.map((key) => key ?? "_").join(""));

  it("un mot qui ne tient pas passe à la ligne, un mot plus long qu'une ligne se coupe", () => {
    assert.deepEqual(lines("ab cd ef", 5), ["ab_cd", "ef"]);
    assert.deepEqual(lines("a abcdefghij b", 4), ["a", "abcd", "efgh", "ij_b"]);
    assert.deepEqual(lines("abcd", 4), ["abcd"]);
  });

  it("tout ce qui n'est pas une lettre sépare les mots, sans case vide en trop", () => {
    assert.deepEqual(unownText.unownWords("  J'ai -- 3 POMMES!!  "), ["j", "ai", "pommes"]);
    assert.deepEqual(unownText.unownWords("Ça, c'est Œdipe"), ["ca", "c", "est", "oedipe"]);
    assert.deepEqual(unownText.unownWords("Σ ж 😂"), [], "pas de Zarbi pour les autres alphabets");
  });
});
