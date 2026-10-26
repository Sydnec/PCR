// /pk boutique : le catalogue, l'achat, les refus avec leurs chiffres.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { createSandbox, openDatabases, dbRun, dbAll } from "./helpers.js";
import { runCommand, runAutocomplete, payloadOf, textOf } from "./fake-discord.js";

createSandbox({ config: { pokemon: { generationOpenings: { 2: "2000-01-01T00:00:00+01:00" } } } });
const { points } = await openDatabases();
const pk = (await import("../commands/pk.js")).default;
const { getPokemonConfig, specialBallDailyLimit, specialBallLimit } = await import("../modules/pokemon/config.js");
const { getSpecies, speciesEvolvingWith } = await import("../modules/pokemon/data.js");
const shop = (options = {}) => runCommand(pk, { sub: "boutique", options });
// Prix et plafond relus dans la configuration : un rééquilibrage ne casse pas ces tests.
const fr = (value) => value.toLocaleString("fr-FR");
const priceOf = (key) => getPokemonConfig().capture.specialBalls[key].price;
const setBalance = (amount, user = "u1") =>
  dbRun(points, "INSERT INTO points (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = ?", [user, amount, amount]);
const units = () => dbAll(points, "SELECT ball FROM pokemon_ball_units WHERE user_id = 'u1'");

beforeEach(async () => {
  for (const table of ["points", "pokemon_ball_units", "points_log", "pokemon_shop_daily"]) await dbRun(points, `DELETE FROM ${table}`);
});

describe("/pk boutique", () => {
  it("sans option : le catalogue, en privé, avec prix, effet et ce qu'on en a", async () => {
    await setBalance(1500);
    const reply = payloadOf(await shop(), "reply");
    assert.equal(reply.flags, MessageFlags.Ephemeral);
    const { description } = reply.embeds[0].toJSON();
    // Chaque ball tient sur deux lignes, prix et stock puis effet : on lit les siennes,
    // pour qu'un chiffre ou un nom d'une autre ball ne fasse pas passer l'assertion.
    const lines = description.split("\n");
    const entry = (label) => {
      const at = lines.findIndex((line) => line.includes(`**${label}**`));
      assert.ok(at >= 0, `${label} est au catalogue`);
      return { header: lines[at], effect: lines[at + 1] };
    };
    const priceAndStock = ({ price }) => new RegExp(`${price.toLocaleString("fr-FR")}.*points.*tu en as 0/${specialBallLimit()} · achetées aujourd'hui 0/${specialBallDailyLimit()}`);
    const { appat, catalyseur } = getPokemonConfig().capture.specialBalls;

    const lure = entry("Appât Ball");
    assert.match(lure.header, priceAndStock(appat));
    assert.match(lure.effect, new RegExp(`×${appat.bonus.multiplier} sur les Pokémon pêchés, ×${appat.multiplier} sur les autres`));

    const catalyst = entry("Catalyseur Ball");
    assert.match(catalyst.header, priceAndStock(catalyseur));
    assert.match(catalyst.effect, new RegExp(`×${catalyseur.bonus.multiplier} sur les Pokémon qui évoluent avec le Catalyseur`));
    const evolvers = [...speciesEvolvingWith(catalyseur.bonus.item)].map((id) => getSpecies(id).name);
    assert.ok(evolvers.length > 0, "le Catalyseur fait évoluer quelqu'un");
    for (const name of evolvers) assert.ok(catalyst.effect.includes(name), `${name} est cité`);

    assert.match(description, /Ton solde : \*\*1\s?500\*\* points/);
    assert.match(description, /après\*\* son achat/);
    assert.match(description, new RegExp(`\\*\\*${specialBallDailyLimit()}\\*\\* de chaque au plus, compteur remis à zéro <t:\\d+:R>`));
  });

  it("acheter débite le prix et donne les balls, en le disant", async () => {
    const price = priceOf("appat");
    await setBalance(3 * price);
    const reply = payloadOf(await shop({ ball: "appat", quantite: 2 }), "reply");
    assert.ok(reply.content.includes(`2× Appât Ball** pour **${fr(2 * price)}** points`), reply.content);
    assert.match(reply.content, /^✅/);
    assert.match(reply.content, /pas à celui en cours/);
    assert.equal((await units()).length, 2);
    assert.equal((await dbAll(points, "SELECT balance FROM points WHERE user_id = 'u1'"))[0].balance, price);
  });

  it("les refus donnent les chiffres : solde, plafond, ball inconnue", async () => {
    const left = priceOf("appat") - 1;
    await setBalance(left);
    assert.ok(payloadOf(await shop({ ball: "appat" }), "reply").content.includes(`Il te faut ${fr(priceOf("appat"))} points, tu en as ${fr(left)}`));
    const limit = specialBallLimit();
    await setBalance(limit * priceOf("catalyseur") * 2);
    await shop({ ball: "catalyseur", quantite: limit - 1 });
    assert.ok(
      payloadOf(await shop({ ball: "catalyseur", quantite: 2 }), "reply").content.includes(`Tu en as ${limit - 1} sur ${limit} : tu peux encore en acheter 1, pas 2`)
    );
    assert.match(payloadOf(await shop({ ball: "poke" }), "reply").content, /pas en vente/);
    assert.equal((await units()).length, limit - 1, "les refus n'ont rien donné");
    // Le quota du jour, une fois la poche vidée : le refus dit combien on en a acheté.
    const daily = specialBallDailyLimit();
    await dbRun(points, "DELETE FROM pokemon_ball_units");
    await dbRun(points, "UPDATE pokemon_shop_daily SET bought = ? WHERE user_id = 'u1' AND ball = 'catalyseur'", [daily]);
    const refusal = payloadOf(await shop({ ball: "catalyseur" }), "reply");
    assert.equal(refusal.flags, MessageFlags.Ephemeral);
    assert.ok(refusal.content.includes(`Tu en as acheté ${daily} sur ${daily} aujourd'hui : tu peux encore en acheter 0, pas 1`), refusal.content);
    assert.equal((await units()).length, 0);
  });

  it("/pk inventaire montre les balls spéciales, et rien quand on n'en a pas", async () => {
    const inventory = (options = {}) => runCommand(pk, { sub: "inventaire", options });
    assert.doesNotMatch(textOf(payloadOf(await inventory(), "reply")), /Balls spéciales/);
    await setBalance(1000);
    await shop({ ball: "appat", quantite: 2 });
    const text = textOf(payloadOf(await inventory(), "reply"));
    assert.match(text, /Balls spéciales/);
    assert.match(text, /Appât Ball ×2/);
    assert.match(text, /Aucun objet, seulement des balls de la boutique/);
  });

  it("l'autocomplétion propose les balls en vente avec leur prix", async () => {
    const all = payloadOf(await runAutocomplete(pk, { sub: "boutique", focused: { name: "ball", value: "" } }), "respond");
    assert.deepEqual(all.map((choice) => choice.value), ["appat", "catalyseur"]);
    assert.ok(all[0].name.includes(`Appât Ball — ${fr(priceOf("appat"))} points`), all[0].name);
    const none = payloadOf(await runAutocomplete(pk, { sub: "boutique", focused: { name: "ball", value: "zzz" } }), "respond");
    assert.match(none[0].name, /Aucune ball spéciale en vente/);
  });
});
