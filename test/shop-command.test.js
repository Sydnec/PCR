// /pk boutique : le catalogue, l'achat, les refus avec leurs chiffres.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { createSandbox, openDatabases, dbRun, dbAll } from "./helpers.js";
import { runCommand, runAutocomplete, payloadOf, textOf } from "./fake-discord.js";

createSandbox({ config: { pokemon: { generationOpenings: { 2: "2000-01-01T00:00:00+01:00" } } } });
const { points } = await openDatabases();
const pk = (await import("../commands/pk.js")).default;
const shop = (options = {}) => runCommand(pk, { sub: "boutique", options });
const setBalance = (amount, user = "u1") =>
  dbRun(points, "INSERT INTO points (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = ?", [user, amount, amount]);
const units = () => dbAll(points, "SELECT ball FROM pokemon_ball_units WHERE user_id = 'u1'");

beforeEach(async () => {
  for (const table of ["points", "pokemon_ball_units", "points_log"]) await dbRun(points, `DELETE FROM ${table}`);
});

describe("/pk boutique", () => {
  it("sans option : le catalogue, en privé, avec prix, effet et ce qu'on en a", async () => {
    await setBalance(1500);
    const reply = payloadOf(await shop(), "reply");
    assert.equal(reply.flags, MessageFlags.Ephemeral);
    const text = textOf(reply);
    assert.match(text, /Appât Ball.*230.*points.*tu en as 0\/10/s);
    assert.match(text, /×3 sur les Pokémon pêchés, ×1 sur les autres/);
    assert.match(text, /Catalyseur Ball.*300/s);
    assert.match(text, /×4 sur les Pokémon qui évoluent avec le Catalyseur \(Onix, Hypocéan, Insécateur, Porygon\)/);
    assert.match(text, /Ton solde : \*\*1\s?500\*\* points/);
    assert.match(text, /après\*\* son achat/);
  });

  it("acheter débite le prix et donne les balls, en le disant", async () => {
    await setBalance(1000);
    const reply = payloadOf(await shop({ ball: "appat", quantite: 2 }), "reply");
    assert.match(reply.content, /✅.*2× Appât Ball\*\* pour \*\*460\*\* points/);
    assert.match(reply.content, /pas à celui en cours/);
    assert.equal((await units()).length, 2);
    assert.equal((await dbAll(points, "SELECT balance FROM points WHERE user_id = 'u1'"))[0].balance, 540);
  });

  it("les refus donnent les chiffres : solde, plafond, ball inconnue", async () => {
    await setBalance(100);
    assert.match(payloadOf(await shop({ ball: "appat" }), "reply").content, /Il te faut 230 points, tu en as 100/);
    await setBalance(100000);
    await shop({ ball: "catalyseur", quantite: 9 });
    assert.match(payloadOf(await shop({ ball: "catalyseur", quantite: 2 }), "reply").content, /Tu en as 9 sur 10 : tu peux encore en acheter 1, pas 2/);
    assert.match(payloadOf(await shop({ ball: "poke" }), "reply").content, /pas en vente/);
    assert.equal((await units()).length, 9, "les refus n'ont rien donné");
  });

  it("l'autocomplétion propose les balls en vente avec leur prix", async () => {
    const all = payloadOf(await runAutocomplete(pk, { sub: "boutique", focused: { name: "ball", value: "" } }), "respond");
    assert.deepEqual(all.map((choice) => choice.value), ["appat", "catalyseur"]);
    assert.match(all[0].name, /Appât Ball — 230 points/);
    const none = payloadOf(await runAutocomplete(pk, { sub: "boutique", focused: { name: "ball", value: "zzz" } }), "respond");
    assert.match(none[0].name, /Aucune ball spéciale en vente/);
  });
});
