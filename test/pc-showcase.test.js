// Le rangement du site : la boîte PC (cases, noms de boîtes, surnoms) et la
// vitrine. Du décor — rien de tout ça ne change ce qu'on possède — mais une case
// perdue ou un Pokémon exposé en double se verrait tout de suite : les écritures
// sont gardées, et deux onglets ouverts ne s'écrasent pas.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbAll, dbGet, eventually } from "./helpers.js";

const sandbox = createSandbox({ config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } } });
const { points } = await openDatabases();
const pc = await import("../modules/pokemon/pc.js");
const showcase = await import("../modules/pokemon/showcase.js");
const { getPokemonConfig } = await import("../modules/pokemon/config.js");

const call = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value))));
const config = (patch) => sandbox.writeConfig({ pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" }, ...patch } });

async function give({ user = "u1", obtained = 1, pos = null, shown = null } = {}) {
  const { lastID } = await dbRun(
    points,
    "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at, pc_pos, showcase_pos) VALUES (?, 19, 0, 'M', 'test', ?, ?, ?)",
    [user, obtained, pos, shown]
  );
  return lastID;
}
const giveMany = async (count, options = {}) => {
  const ids = [];
  for (let index = 0; index < count; index++) ids.push(await give({ obtained: index + 1, ...options }));
  return ids;
};
const posOf = async (id) => (await dbGet(points, "SELECT pc_pos FROM pokemon_owned WHERE id = ?", [id])).pc_pos;
const shownIds = async (user = "u1") => (await call(showcase.getShowcase, user)).map((row) => row.id);

beforeEach(async () => {
  for (const table of ["pokemon_owned", "pokemon_pc_boxes", "pokemon_showcase_shares"]) await dbRun(points, `DELETE FROM ${table}`);
  config({});
});

describe("la configuration du PC", () => {
  it("les valeurs de base : 30 places, 6 colonnes, de 8 à 60 boîtes", () => {
    const { slotsPerBox, columns, minBoxes, maxBoxes } = pc.pcConfig();
    assert.deepEqual({ slotsPerBox, columns, minBoxes, maxBoxes }, { slotsPerBox: 30, columns: 6, minBoxes: 8, maxBoxes: 60 });
  });

  it("un réglage absurde retombe sur une valeur jouable, et le minimum ne dépasse pas le maximum", () => {
    config({ pc: { slotsPerBox: 0, columns: -3, minBoxes: 100, maxBoxes: 10, boxNameLength: 0, nicknameLength: 0 } });
    const result = pc.pcConfig();
    assert.ok(result.slotsPerBox >= 1 && result.columns >= 1 && result.boxNameLength >= 1 && result.nicknameLength >= 1);
    assert.ok(result.minBoxes <= result.maxBoxes);
    assert.equal(pc.defaultBoxName(0), "Boîte 1");
    assert.equal(pc.defaultBoxName(11), "Boîte 12");
  });
});

describe("la disposition (layoutPc)", () => {
  const row = (id, pos, obtained = id) => ({ id, user_id: "u1", pc_pos: pos, obtained_at: obtained });
  const posById = (layout) => Object.fromEntries(layout.map(({ row: r, pos }) => [r.id, pos]));

  it("chacun garde sa case, et un nouvel arrivant prend la première libre", () => {
    assert.deepEqual(posById(pc.layoutPc([row(1, 0), row(2, 2), row(3, null)])), { 1: 0, 2: 2, 3: 1 });
  });

  it("sans aucune place, l'ordre d'arrivée décide", () => {
    assert.deepEqual(posById(pc.layoutPc([row(1, null, 30), row(2, null, 10), row(3, null, 20)])), { 2: 0, 3: 1, 1: 2 });
  });

  it("une case disputée : le plus ancien la garde, l'autre prend la première libre — rien ne se perd", () => {
    const layout = pc.layoutPc([row(5, 3), row(2, 3), row(9, 3)]);
    assert.equal(posById(layout)[2], 3);
    assert.equal(new Set(layout.map(({ pos }) => pos)).size, 3, "trois cases distinctes");
    assert.equal(layout.length, 3);
  });

  it("une place invalide (négative, fractionnaire, absente) vaut « sans place »", () => {
    const layout = pc.layoutPc([row(1, -4), row(2, 1.5), row(3, undefined), row(4, "x")]);
    assert.deepEqual(layout.map(({ pos }) => pos).sort(), [0, 1, 2, 3]);
  });

  it("une collection vide n'a pas de disposition", () => {
    assert.deepEqual(pc.layoutPc([]), []);
  });
});

describe("lire le PC (getPc)", () => {
  it("un dresseur sans Pokémon a ses huit boîtes vides, aux noms par défaut", async () => {
    const result = await call(pc.getPc, "u1");
    assert.equal(result.boxes.length, 8);
    const { name, custom } = result.boxes[0];
    assert.deepEqual({ name, custom }, { name: "Boîte 1", custom: false });
    assert.deepEqual(result.layout, []);
  });

  it("range ceux qui n'ont pas de place, et retient ces places pour la lecture suivante", async () => {
    const ids = await giveMany(3);
    const result = await call(pc.getPc, "u1");
    assert.deepEqual(result.layout.map(({ pos }) => pos).sort(), [0, 1, 2]);
    await eventually(async () => assert.deepEqual((await Promise.all(ids.map(posOf))).sort(), [0, 1, 2]));
  });

  it("il y a toujours une boîte vide après la dernière occupée, jusqu'au maximum", async () => {
    await give({ pos: 30 * 8 });
    assert.equal((await call(pc.getPc, "u1")).boxes.length, 10, "boîte 9 occupée : une vide après");
    await dbRun(points, "DELETE FROM pokemon_owned");
    await give({ pos: 30 * 59 });
    assert.equal((await call(pc.getPc, "u1")).boxes.length, 60, "plafonné");
  });

  it("les boîtes renommées le disent", async () => {
    await call(pc.renameBox, "u1", 1, "Équipe");
    const result = await call(pc.getPc, "u1");
    const { name, custom } = result.boxes[1];
    assert.deepEqual({ name, custom }, { name: "Équipe", custom: true });
    assert.equal(result.boxes[0].custom, false);
  });

  it("chacun ne voit que ses Pokémon", async () => {
    await give({ user: "u2" });
    assert.deepEqual((await call(pc.getPc, "u1")).layout, []);
  });
});

describe("déplacer un Pokémon (movePokemon)", () => {
  it("vers une case libre", async () => {
    const [id] = await giveMany(1, { pos: 0 });
    assert.deepEqual(await call(pc.movePokemon, "u1", id, 7), { ok: true });
    assert.equal(await posOf(id), 7);
  });

  it("vers une case occupée : l'occupant prend la place qu'on quitte", async () => {
    const [a, b] = await giveMany(2);
    await dbRun(points, "UPDATE pokemon_owned SET pc_pos = id - ? WHERE user_id = 'u1'", [a]);
    assert.equal((await call(pc.movePokemon, "u1", a, 1)).ok, true);
    assert.equal(await posOf(a), 1);
    assert.equal(await posOf(b), 0, "échange de cases, comme dans les jeux");
  });

  it("rester sur sa case est un succès qui ne change rien", async () => {
    const [id] = await giveMany(1, { pos: 4 });
    assert.deepEqual(await call(pc.movePokemon, "u1", id, 4), { ok: true });
    assert.equal(await posOf(id), 4);
  });

  it("une case qui n'existe pas est refusée", async () => {
    const [id] = await giveMany(1, { pos: 0 });
    for (const target of [-1, 1.5, 30 * 60, Number.NaN, "3", null]) {
      const result = await call(pc.movePokemon, "u1", id, target);
      assert.deepEqual(result, { ok: false, reason: "Cette case n'existe pas." }, String(target));
    }
    assert.equal(await posOf(id), 0);
  });

  it("la dernière case de la dernière boîte existe", async () => {
    const [id] = await giveMany(1, { pos: 0 });
    assert.equal((await call(pc.movePokemon, "u1", id, 30 * 60 - 1)).ok, true);
  });

  it("le Pokémon d'un autre n'est pas à soi", async () => {
    const stranger = await give({ user: "u2", pos: 0 });
    const result = await call(pc.movePokemon, "u1", stranger, 5);
    assert.equal(result.ok, false);
    assert.match(result.reason, new RegExp(`#${stranger} n'est pas à toi`));
    assert.equal(await posOf(stranger), 0);
  });

  it("deux onglets qui déplacent le même Pokémon : le second est prévenu, rien n'est écrasé", async () => {
    const [id] = await giveMany(1, { pos: 0 });
    const results = await Promise.all([call(pc.movePokemon, "u1", id, 5), call(pc.movePokemon, "u1", id, 9)]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.match(results.find((result) => !result.ok).reason, /a bougé entre-temps : recharge ta boîte/);
    assert.ok([5, 9].includes(await posOf(id)));
  });
});

describe("ranger plusieurs Pokémon (movePokemonMany)", () => {
  const names = async (user = "u1") => (await call(pc.getPc, user)).boxes.map((box) => box.name);

  it("dans les cases libres de la boîte visée, dans l'ordre où ils sont rangés", async () => {
    const [a, b, c] = await giveMany(3, { pos: null });
    await dbRun(points, "UPDATE pokemon_owned SET pc_pos = ? WHERE id = ?", [2, a]);
    await dbRun(points, "UPDATE pokemon_owned SET pc_pos = ? WHERE id = ?", [0, b]);
    await dbRun(points, "UPDATE pokemon_owned SET pc_pos = ? WHERE id = ?", [1, c]);
    const other = await give({ pos: 60 });
    assert.deepEqual(await call(pc.movePokemonMany, "u1", [a, b, c], 2), { ok: true, moved: 3, skipped: 0 });
    assert.deepEqual([await posOf(b), await posOf(c), await posOf(a), await posOf(other)], [61, 62, 63, 60]);
  });

  it("déborde dans les boîtes suivantes, archivées exceptées", async () => {
    const moving = await giveMany(3, { pos: null });
    for (const [index, id] of moving.entries()) await dbRun(points, "UPDATE pokemon_owned SET pc_pos = ? WHERE id = ?", [index, id]);
    for (let slot = 0; slot < 29; slot++) await give({ pos: 30 + slot });
    await dbRun(points, "INSERT INTO pokemon_pc_boxes (user_id, box, name, archived) VALUES ('u1', 2, '', 1)");
    assert.equal((await call(pc.movePokemonMany, "u1", moving, 1)).ok, true);
    assert.deepEqual(await Promise.all(moving.map(posOf)), [59, 90, 91]);
  });

  it("ceux qui sont déjà dans la boîte visée y restent", async () => {
    const [a, b] = await giveMany(2, { pos: null });
    await dbRun(points, "UPDATE pokemon_owned SET pc_pos = 31 WHERE id = ?", [a]);
    await dbRun(points, "UPDATE pokemon_owned SET pc_pos = 0 WHERE id = ?", [b]);
    assert.deepEqual(await call(pc.movePokemonMany, "u1", [a, b], 1), { ok: true, moved: 1, skipped: 0 });
    assert.deepEqual([await posOf(a), await posOf(b)], [31, 30]);
  });

  it("faute de place jusqu'au plafond, rien ne bouge et le refus donne les chiffres", async () => {
    config({ pc: { slotsPerBox: 2, maxBoxes: 2, minBoxes: 1 } });
    const [a, b, c] = await giveMany(3, { pos: null });
    for (const [id, pos] of [[a, 0], [b, 1], [c, 2]]) await dbRun(points, "UPDATE pokemon_owned SET pc_pos = ? WHERE id = ?", [pos, id]);
    const result = await call(pc.movePokemonMany, "u1", [a, b], 1);
    assert.deepEqual(result, {
      ok: false,
      reason: "Il ne reste que 1 case libre à partir de « Boîte 2 » (boîtes archivées non comprises), et tu en ranges 2.",
    });
    assert.deepEqual([await posOf(a), await posOf(b), await posOf(c)], [0, 1, 2]);
  });

  it("le Pokémon d'un autre, une boîte qui n'existe pas ou une liste vide : refus, rien ne bouge", async () => {
    const [mine] = await giveMany(1, { pos: 0 });
    const stranger = await give({ user: "u2", pos: 0 });
    assert.match((await call(pc.movePokemonMany, "u1", [mine, stranger], 3)).reason, new RegExp(`#${stranger} n'est pas à toi`));
    assert.equal((await call(pc.movePokemonMany, "u1", [mine], 60)).reason, "Cette boîte n'existe pas.");
    assert.equal((await call(pc.movePokemonMany, "u1", [], 1)).reason, "Choisis au moins un Pokémon.");
    assert.deepEqual([await posOf(mine), await posOf(stranger)], [0, 0]);
    assert.ok((await names()).length >= 8);
  });
});

describe("déplacer une boîte (moveBox)", () => {
  const boxesOf = async (user = "u1") => (await call(pc.getPc, user)).boxes.map(({ name, archived }) => [name, archived]);

  it("la boîte change de rang avec son nom, son archivage et ses Pokémon ; celles d'entre les deux se décalent", async () => {
    const [a, b] = [await give({ pos: 30 }), await give({ pos: 31 })];
    const c = await give({ pos: 64 });
    const d = await give({ pos: 95 });
    await call(pc.renameBox, "u1", 1, "Gen1");
    await call(pc.renameBox, "u1", 2, "Eau");
    await call(pc.archiveBox, "u1", 2, true);
    assert.deepEqual(await call(pc.moveBox, "u1", 1, 3), { ok: true });
    assert.deepEqual([await posOf(a), await posOf(b), await posOf(c), await posOf(d)], [90, 91, 34, 65], "chacun garde sa case");
    assert.deepEqual((await boxesOf()).slice(0, 4), [["Boîte 1", false], ["Eau", true], ["Boîte 3", false], ["Gen1", false]]);
    assert.deepEqual(await dbAll(points, "SELECT box, name, archived FROM pokemon_pc_boxes ORDER BY box"), [
      { box: 1, name: "Eau", archived: 1 },
      { box: 3, name: "Gen1", archived: 0 },
    ], "pas de ligne vide qui traîne");

    assert.deepEqual(await call(pc.moveBox, "u1", 3, 1), { ok: true }, "et dans l'autre sens");
    assert.deepEqual([await posOf(a), await posOf(c), await posOf(d)], [30, 64, 95]);
    assert.deepEqual((await boxesOf()).slice(0, 4), [["Boîte 1", false], ["Gen1", false], ["Eau", true], ["Boîte 4", false]]);
  });

  it("un Pokémon sans place encore suit la boîte où la lecture le range", async () => {
    const id = await give({ pos: null });
    assert.equal((await call(pc.moveBox, "u1", 0, 2)).ok, true);
    assert.equal(await posOf(id), 60);
  });

  it("même rang : rien ne change ; une boîte qui n'existe pas est refusée", async () => {
    const id = await give({ pos: 3 });
    assert.deepEqual(await call(pc.moveBox, "u1", 0, 0), { ok: true });
    for (const [from, to] of [[0, 8], [-1, 2], [0, 1.5], [9, 0]]) {
      assert.deepEqual(await call(pc.moveBox, "u1", from, to), { ok: false, reason: "Cette boîte n'existe pas." }, `${from}→${to}`);
    }
    assert.equal(await posOf(id), 3);
  });

  it("si les réglages des boîtes ne s'écrivent pas, les Pokémon reviennent à leur place", async () => {
    const a = await give({ pos: 30 });
    const b = await give({ pos: 61 });
    await call(pc.renameBox, "u1", 1, "Gen1");
    await dbRun(points, "CREATE TRIGGER panne_insert BEFORE INSERT ON pokemon_pc_boxes BEGIN SELECT RAISE(ABORT, 'panne provoquée'); END");
    try {
      await assert.rejects(() => call(pc.moveBox, "u1", 1, 2), /panne provoquée/);
    } finally {
      await dbRun(points, "DROP TRIGGER panne_insert");
    }
    assert.deepEqual([await posOf(a), await posOf(b)], [30, 61]);
    assert.deepEqual((await boxesOf()).slice(1, 3), [["Gen1", false], ["Boîte 3", false]]);
  });
});

describe("noms de boîtes et surnoms", () => {
  it("une boîte inexistante est refusée", async () => {
    for (const box of [-1, 60, 1.5, "2", null]) {
      assert.deepEqual(await call(pc.renameBox, "u1", box, "x"), { ok: false, reason: "Cette boîte n'existe pas." }, String(box));
    }
  });

  it("le nom est nettoyé : une ligne, sans contrôle ni espaces superflus", async () => {
    const result = await call(pc.renameBox, "u1", 0, "  Mon\n\t équipe\u0007   préférée  ");
    assert.deepEqual(result, { ok: true, name: "Mon équipe préférée", custom: true });
  });

  it("le nom est coupé à la longueur réglée, par caractères : un emoji n'est pas coupé en deux", async () => {
    config({ pc: { boxNameLength: 4 } });
    assert.equal((await call(pc.renameBox, "u1", 0, "abcdefgh")).name, "abcd");
    assert.equal((await call(pc.renameBox, "u1", 0, "😀😀😀😀😀😀")).name, "😀😀😀😀");
  });

  it("un nom vide rend à la boîte son nom par défaut", async () => {
    await call(pc.renameBox, "u1", 3, "Équipe");
    const result = await call(pc.renameBox, "u1", 3, "   \n ");
    assert.deepEqual(result, { ok: true, name: "Boîte 4", custom: false });
    assert.equal((await dbAll(points, "SELECT * FROM pokemon_pc_boxes")).length, 0);
  });

  it("renommer deux fois remplace, sans doublon", async () => {
    await call(pc.renameBox, "u1", 2, "A");
    await call(pc.renameBox, "u1", 2, "B");
    const rows = await dbAll(points, "SELECT name FROM pokemon_pc_boxes WHERE user_id = 'u1' AND box = 2");
    assert.deepEqual(rows, [{ name: "B" }]);
  });

  it("chacun ses boîtes", async () => {
    await call(pc.renameBox, "u1", 0, "À moi");
    assert.equal((await call(pc.getPc, "u2")).boxes[0].name, "Boîte 1");
  });

  it("un surnom se donne, se nettoie, se coupe et s'efface", async () => {
    const id = await give();
    assert.deepEqual(await call(pc.renamePokemon, "u1", id, "  Ratou \n "), { ok: true, nickname: "Ratou", cut: false });
    assert.equal((await dbGet(points, "SELECT nickname FROM pokemon_owned WHERE id = ?", [id])).nickname, "Ratou");

    config({ pc: { nicknameLength: 3 } });
    const cut = await call(pc.renamePokemon, "u1", id, "Roudoudou");
    assert.deepEqual([cut.nickname, cut.cut], ["Rou", true], "la limite rogne, et le résultat le dit");

    assert.deepEqual(await call(pc.renamePokemon, "u1", id, ""), { ok: true, nickname: null, cut: false });
    assert.equal((await dbGet(points, "SELECT nickname FROM pokemon_owned WHERE id = ?", [id])).nickname, null);
  });

  it("le surnom d'un autre ne se change pas", async () => {
    const stranger = await give({ user: "u2" });
    const result = await call(pc.renamePokemon, "u1", stranger, "Volé");
    assert.equal(result.ok, false);
    assert.match(result.reason, /n'est pas à toi/);
    assert.equal((await dbGet(points, "SELECT nickname FROM pokemon_owned WHERE id = ?", [stranger])).nickname, null);
  });
});

// ====================== VITRINE ======================

describe("archiver une boîte (archiveBox)", () => {
  const archive = (box, archived = true, user = "u1") => call(pc.archiveBox, user, box, archived);
  const boxes = async () => (await call(pc.getPc, "u1")).boxes;
  const settings = () => dbAll(points, "SELECT box, name, archived FROM pokemon_pc_boxes ORDER BY box");

  it("archive une boîte occupée, et la rend aux autres", async () => {
    await give({ pos: 31 });
    assert.deepEqual(await archive(1), { ok: true, archived: true });
    assert.equal((await boxes())[1].archived, true);
    assert.equal((await boxes())[1].name, "Boîte 2", "sans nom à elle, le nom par défaut");
    assert.deepEqual(await archive(1, false), { ok: true, archived: false });
    assert.equal((await boxes())[1].archived, false);
    assert.deepEqual(await settings(), [], "sans nom ni archivage, plus rien à retenir");
  });

  it("refuse une boîte vide, ou qui n'existe pas, sans rien écrire", async () => {
    const empty = await archive(2);
    assert.equal(empty.ok, false);
    assert.match(empty.reason, /vide/);
    for (const box of [-1, 60, 1.5]) assert.match((await archive(box)).reason, /n'existe pas/, String(box));
    assert.deepEqual(await settings(), []);
  });

  it("l'archivage et le nom se gardent l'un l'autre", async () => {
    await give({ pos: 0 });
    await call(pc.renameBox, "u1", 0, "Vieux");
    await archive(0);
    assert.deepEqual(await settings(), [{ box: 0, name: "Vieux", archived: 1 }]);
    await call(pc.renameBox, "u1", 0, "");
    assert.deepEqual(await settings(), [{ box: 0, name: "", archived: 1 }], "renommer à vide ne désarchive pas");
    await call(pc.renameBox, "u1", 0, "Neuf");
    await archive(0, false);
    assert.deepEqual(await settings(), [{ box: 0, name: "Neuf", archived: 0 }], "désarchiver garde le nom");
  });

  it("un nouveau Pokémon évite les boîtes archivées", async () => {
    await give({ pos: 0 });
    await archive(0);
    const id = await give({ obtained: 2 });
    const { layout } = await call(pc.getPc, "u1");
    assert.equal(layout.find(({ row }) => row.id === id).pos, 30, "première case de la boîte 2");
  });

  it("un Pokémon chassé d'une case disputée ne part pas dans une boîte archivée", async () => {
    await give({ pos: 0, obtained: 1 });
    await archive(0);
    const loser = await give({ pos: 0, obtained: 2 });
    const { layout } = await call(pc.getPc, "u1");
    assert.equal(layout.find(({ row }) => row.id === loser).pos, 30);
  });

  it("un PC plein jusqu'au plafond range dans une boîte archivée plutôt que de perdre un Pokémon", async () => {
    config({ pc: { slotsPerBox: 2, minBoxes: 2, maxBoxes: 2 } });
    await give({ pos: 0 });
    await archive(0);
    await give({ pos: 2 });
    await give({ pos: 3 });
    const id = await give({ obtained: 9 });
    const { layout } = await call(pc.getPc, "u1");
    assert.equal(layout.find(({ row }) => row.id === id).pos, 1, "la case libre de la boîte archivée");
    const overflow = await give({ obtained: 10 });
    const full = await call(pc.getPc, "u1");
    assert.equal(full.layout.find(({ row }) => row.id === overflow).pos, 4, "au-delà du plafond, comme avant");
  });

  it("on peut ranger un Pokémon à la main dans une boîte archivée", async () => {
    await give({ pos: 30 });
    await archive(1);
    const id = await give({ pos: 0 });
    assert.deepEqual(await call(pc.movePokemon, "u1", id, 35), { ok: true });
    assert.equal(await posOf(id), 35);
  });

  it("la boîte vide de la fin n'est jamais une archivée", async () => {
    await give({ pos: 30 * 8 });
    assert.equal((await boxes()).length, 10);
    await archive(8);
    // La 10e boîte reste vide et ordinaire : rien à ajouter.
    assert.equal((await boxes()).length, 10);
    const id = (await call(pc.getPc, "u1")).layout[0].row.id;
    await call(pc.movePokemon, "u1", id, 30 * 9);
    await archive(9);
    const list = await boxes();
    assert.equal(list.length, 11, "la dernière vide est archivée : il en vient une");
    assert.equal(list.at(-1).archived, false);
  });

  it("chacun archive ses boîtes", async () => {
    await give({ pos: 0, user: "u2" });
    await archive(0, true, "u2");
    assert.equal((await boxes())[0].archived, false);
  });
});

describe("la vitrine : exposer et retirer", () => {
  it("six places de base, au moins une quoi qu'on règle", () => {
    assert.equal(showcase.showcaseSlots(), 6);
    config({ showcase: { slots: 0 } });
    assert.equal(showcase.showcaseSlots(), 1);
    config({ showcase: { slots: 3.9 } });
    assert.equal(showcase.showcaseSlots(), 3);
  });

  it("expose au bout de la vitrine, dans l'ordre", async () => {
    const [a, b, c] = await giveMany(3);
    for (const id of [b, a, c]) assert.deepEqual(await call(showcase.addToShowcase, "u1", id), { ok: true });
    assert.deepEqual(await shownIds(), [b, a, c]);
  });

  it("un Pokémon déjà exposé, ou qui n'est pas à soi, est refusé en le disant", async () => {
    const [id] = await giveMany(1);
    const stranger = await give({ user: "u2" });
    await call(showcase.addToShowcase, "u1", id);
    assert.match((await call(showcase.addToShowcase, "u1", id)).reason, new RegExp(`#${id} est déjà dans ta vitrine`));
    assert.match((await call(showcase.addToShowcase, "u1", stranger)).reason, new RegExp(`#${stranger} n'est pas dans ta boîte`));
    assert.match((await call(showcase.addToShowcase, "u1", 99999)).reason, /n'est pas dans ta boîte/);
    assert.deepEqual(await shownIds(), [id]);
  });

  it("la vitrine pleine refuse avec les chiffres", async () => {
    config({ showcase: { slots: 2 } });
    const ids = await giveMany(3);
    await call(showcase.addToShowcase, "u1", ids[0]);
    await call(showcase.addToShowcase, "u1", ids[1]);
    const result = await call(showcase.addToShowcase, "u1", ids[2]);
    assert.equal(result.ok, false);
    assert.match(result.reason, /Ta vitrine est pleine \(2\/2\)/);
  });

  it("dix ajouts simultanés pour deux places libres : jamais plus que la vitrine ne contient", async () => {
    config({ showcase: { slots: 3 } });
    const ids = await giveMany(10);
    await call(showcase.addToShowcase, "u1", ids[0]);
    const results = await Promise.all(ids.slice(1).map((id) => call(showcase.addToShowcase, "u1", id)));
    assert.equal(results.filter((result) => result.ok).length, 2);
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_owned WHERE showcase_pos IS NOT NULL")).length, 3);
  });

  it("retirer dit s'il y était", async () => {
    const [id] = await giveMany(1);
    assert.equal(await call(showcase.removeFromShowcase, "u1", id), false);
    await call(showcase.addToShowcase, "u1", id);
    assert.equal(await call(showcase.removeFromShowcase, "u2", id), false, "pas celui d'un autre");
    assert.equal(await call(showcase.removeFromShowcase, "u1", id), true);
    assert.deepEqual(await shownIds(), []);
  });

  it("une place libérée se reprend : le rang repart du plus haut, sans doublon", async () => {
    const [a, b, c] = await giveMany(3);
    for (const id of [a, b, c]) await call(showcase.addToShowcase, "u1", id);
    await call(showcase.removeFromShowcase, "u1", b);
    const d = await give();
    await call(showcase.addToShowcase, "u1", d);
    assert.deepEqual(await shownIds(), [a, c, d]);
    const ranks = (await dbAll(points, "SELECT showcase_pos FROM pokemon_owned WHERE showcase_pos IS NOT NULL")).map((row) => row.showcase_pos);
    assert.equal(new Set(ranks).size, ranks.length);
  });
});

describe("la vitrine : l'ordre et la lecture", () => {
  it("l'ordre donné s'applique, et ce qui n'est pas exposé ou pas à soi n'entre pas", async () => {
    const [a, b, c] = await giveMany(3);
    const outside = await give();
    const stranger = await give({ user: "u2", shown: 1 });
    for (const id of [a, b, c]) await call(showcase.addToShowcase, "u1", id);
    await call(showcase.orderShowcase, "u1", [c, a, b, outside, stranger]);
    assert.deepEqual(await shownIds(), [c, a, b]);
    assert.equal((await dbGet(points, "SELECT showcase_pos FROM pokemon_owned WHERE id = ?", [outside])).showcase_pos, null, "un ordre périmé n'expose rien de plus");
    assert.equal((await dbGet(points, "SELECT showcase_pos FROM pokemon_owned WHERE id = ?", [stranger])).showcase_pos, 1, "celui d'un autre n'a pas bougé");
  });

  it("un ordre vide, en double ou absurde est sans effet ou dédoublonné", async () => {
    const [a, b] = await giveMany(2);
    for (const id of [a, b]) await call(showcase.addToShowcase, "u1", id);
    assert.equal(await call(showcase.orderShowcase, "u1", []), 0);
    assert.equal(await call(showcase.orderShowcase, "u1", ["x", null, Number.NaN]), 0, "rien d'exploitable");
    await call(showcase.orderShowcase, "u1", [b, b, a, a]);
    assert.deepEqual(await shownIds(), [b, a]);
  });

  it("mettre un Pokémon à une place décale les autres, et clampe la place", async () => {
    const [a, b, c, d] = await giveMany(4);
    for (const id of [a, b, c, d]) await call(showcase.addToShowcase, "u1", id);
    assert.equal(await call(showcase.moveInShowcase, "u1", d, 1), true);
    assert.deepEqual(await shownIds(), [d, a, b, c]);
    await call(showcase.moveInShowcase, "u1", d, 99);
    assert.deepEqual(await shownIds(), [a, b, c, d], "au-delà du bout : au bout");
    await call(showcase.moveInShowcase, "u1", a, -5);
    assert.deepEqual(await shownIds(), [a, b, c, d], "avant le début : au début");
    await call(showcase.moveInShowcase, "u1", c, "n'importe quoi");
    assert.deepEqual(await shownIds(), [c, a, b, d], "une place illisible vaut la première");
  });

  it("déplacer un Pokémon qui n'est pas exposé ne l'expose pas", async () => {
    const [a] = await giveMany(1);
    const other = await give();
    await call(showcase.addToShowcase, "u1", a);
    assert.equal(await call(showcase.moveInShowcase, "u1", other, 1), false);
    assert.deepEqual(await shownIds(), [a]);
  });

  it("une vitrine plus garnie que ses places (une compensation) n'en montre que les premières", async () => {
    config({ showcase: { slots: 2 } });
    const ids = await giveMany(4);
    await Promise.all(ids.map((id, index) => dbRun(points, "UPDATE pokemon_owned SET showcase_pos = ? WHERE id = ?", [index + 1, id])));
    assert.deepEqual(await shownIds(), ids.slice(0, 2));
  });

  it("les vitrines des autres, les plus garnies d'abord, plafonnées aux places", async () => {
    config({ showcase: { slots: 2 } });
    await giveMany(3, { user: "riche", shown: 1 });
    await dbRun(points, "UPDATE pokemon_owned SET showcase_pos = id WHERE user_id = 'riche'");
    await give({ user: "un", shown: 1 });
    await give({ user: "alpha", shown: 1 });
    await give({ user: "vide" });
    const list = await call(showcase.listShowcases);
    assert.deepEqual(list.map((row) => [row.user_id, row.count]), [["riche", 2], ["alpha", 1], ["un", 1]]);
  });

  it("un Pokémon qui quitte la boîte quitte la vitrine avec elle", async () => {
    const [a, b] = await giveMany(2);
    await call(showcase.addToShowcase, "u1", a);
    await call(showcase.addToShowcase, "u1", b);
    await dbRun(points, "DELETE FROM pokemon_owned WHERE id = ?", [a]);
    assert.deepEqual(await shownIds(), [b]);
  });
});

describe("l'envoi de la vitrine dans un salon (claimShowcaseShare)", () => {
  // Le délai vient de la configuration : le test le relit au lieu de le recopier.
  const cooldownMs = () => getPokemonConfig().showcase.shareCooldownMinutes * 60_000;
  const elapse = (ms) => dbRun(points, "UPDATE pokemon_showcase_shares SET shared_at = ? WHERE user_id = 'u1'", [Date.now() - ms]);

  it("un envoi par dresseur par délai, et le refus dit quand revenir", async () => {
    const first = await call(showcase.claimShowcaseShare, "u1");
    assert.equal(first.ok, true);
    const second = await call(showcase.claimShowcaseShare, "u1");
    assert.equal(second.ok, false);
    assert.equal(second.retryAt, first.sharedAt + cooldownMs());
    assert.equal((await call(showcase.claimShowcaseShare, "u2")).ok, true, "chacun son délai");
  });

  it("le délai écoulé, l'envoi revient : au délai de base comme à celui qu'on règle", async () => {
    await call(showcase.claimShowcaseShare, "u1");
    await elapse(cooldownMs() + 60_000);
    assert.equal((await call(showcase.claimShowcaseShare, "u1")).ok, true);

    // 6 minutes ne couvriraient pas le délai de base : seul le réglage laisse passer.
    config({ showcase: { shareCooldownMinutes: 5 } });
    await elapse(6 * 60_000);
    assert.equal((await call(showcase.claimShowcaseShare, "u1")).ok, true);
  });

  it("dix envois simultanés : un seul part", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => call(showcase.claimShowcaseShare, "u1")));
    assert.equal(results.filter((result) => result.ok).length, 1);
  });

  it("un envoi raté se rend : on peut réessayer tout de suite, sans effacer un envoi plus récent", async () => {
    const first = await call(showcase.claimShowcaseShare, "u1");
    await call(showcase.releaseShowcaseShare, "u1", first.sharedAt);
    const retry = await call(showcase.claimShowcaseShare, "u1");
    assert.equal(retry.ok, true);

    await call(showcase.releaseShowcaseShare, "u1", first.sharedAt);
    assert.equal((await call(showcase.claimShowcaseShare, "u1")).ok, false, "la restitution d'un ancien envoi n'efface pas le récent");
  });
});
