// L'économie : les points, les objets, la revente. Tout y suit la même règle —
// on retire d'abord, on crédite ensuite, et on rend ce qu'on a retiré si la suite
// échoue : rien ne se perd, rien ne se crée.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { createSandbox, openDatabases, dbRun, dbAll, speciesByName, withRandom } from "./helpers.js";

createSandbox({ config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } } });
const { points } = await openDatabases();
const economy = await import("../modules/economy.js");
const items = await import("../modules/pokemon/items.js");
const sell = await import("../modules/pokemon/sell.js");
const data = await import("../modules/pokemon/data.js");
const { getPokemonConfig } = await import("../modules/pokemon/config.js");
const soldeCommand = (await import("../commands/solde.js")).default;
const { runCommand, payloadOf, fakeUser } = await import("./fake-discord.js");

const call = (fn, ...args) =>
  new Promise((resolve, reject) =>
    fn(...args, (error, ...rest) => (error ? reject(error) : resolve(rest.length > 1 ? rest : rest[0])))
  );
const species = (name) => speciesByName(data.allSpecies, name);
const balance = (user = "u1") => call(economy.getBalance, user);
const setBalance = (amount, user = "u1") =>
  dbRun(points, "INSERT INTO points (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = ?", [user, amount, amount]);
const count = (key, user = "u1") => call(items.getItemCount, user, key);
const grant = (key, quantity, user = "u1") => call(items.grantItem, user, key, quantity, { source: "test" });

// Un Pokémon en boîte : `obtained` ordonne les plus récents, `sterile` et `locked`
// décident de qui part en premier.
async function give(name, { shiny = 0, sex = "M", obtained = 1, sterile = 0, locked = 0, user = "u1" } = {}) {
  const { lastID } = await dbRun(
    points,
    `INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, sterile, obtained_at, locked)
     VALUES (?, ?, ?, ?, 'test', ?, ?, ?)`,
    [user, species(name).id, shiny, sex, sterile, obtained, locked]
  );
  return lastID;
}
const owned = (name, user = "u1") =>
  dbAll(points, "SELECT id, is_shiny, sterile, locked FROM pokemon_owned WHERE user_id = ? AND species_id = ? ORDER BY id", [user, species(name).id]);

// Une panne du crédit : tout ajout de points échoue, comme une base qui ne répond plus.
const breakCredits = () =>
  dbRun(points, "CREATE TRIGGER panne BEFORE INSERT ON points BEGIN SELECT RAISE(ABORT, 'panne'); END");
const repairCredits = () => dbRun(points, "DROP TRIGGER IF EXISTS panne");

beforeEach(async () => {
  await repairCredits();
  for (const table of ["points", "pokemon_owned", "pokemon_inventory", "pokemon_item_log", "pokemon_sales", "points_log"]) {
    await dbRun(points, `DELETE FROM ${table}`);
  }
});

describe("points", () => {
  it("un dresseur inconnu a 0 point", async () => {
    assert.equal(await balance("inconnu"), 0);
  });

  it("crédite, en créant la ligne au besoin", async () => {
    await call(economy.addPoints, "u1", 500);
    await call(economy.addPoints, "u1", 250);
    assert.equal(await balance(), 750);
  });

  it("débite quand le solde suffit, au point près", async () => {
    await setBalance(300);
    assert.equal(await call(economy.spendPoints, "u1", 300), true);
    assert.equal(await balance(), 0);
  });

  it("refuse un débit que le solde ne couvre pas, sans rien prélever", async () => {
    await setBalance(299);
    assert.equal(await call(economy.spendPoints, "u1", 300), false);
    assert.equal(await balance(), 299);
    assert.equal(await call(economy.spendPoints, "jamais-vu", 1), false);
  });

  it("refuse un montant invalide", async () => {
    await setBalance(1000);
    for (const bad of [-1, 1.5, NaN, "10", undefined]) {
      await assert.rejects(() => call(economy.spendPoints, "u1", bad), /Montant invalide/, `${bad}`);
    }
    assert.equal(await balance(), 1000);
  });

  it("des débits simultanés ne font jamais passer le solde sous zéro", async () => {
    await setBalance(1000);
    const results = await Promise.all(Array.from({ length: 20 }, () => call(economy.spendPoints, "u1", 150)));
    assert.equal(results.filter(Boolean).length, 6, "1 000 / 150 = 6 débits");
    assert.equal(await balance(), 100);
  });

  it("chaque mouvement laisse une ligne dans le journal, écrite par le déclencheur", async () => {
    await call(economy.addPoints, "u1", 500);
    await call(economy.spendPoints, "u1", 200);
    const log = await dbAll(points, "SELECT * FROM points_log WHERE user_id = 'u1' ORDER BY id");
    assert.ok(log.length >= 2);
    assert.equal(log.at(-1).balance_after ?? log.at(-1).balance, 300);
  });

  it("le solde se met en forme avec les séparateurs français", () => {
    const embed = economy.buildBalanceEmbed(12345).toJSON();
    assert.match(JSON.stringify(embed), /12[\s\u202f\u00a0]345/);
  });

  it("sans nextPointsAt, la ligne de délai n'apparaît pas", () => {
    const embed = economy.buildBalanceEmbed(100).toJSON();
    assert.doesNotMatch(embed.description, /Prochains points/);
  });

  it("avec nextPointsAt dans le futur, l'embed affiche le compte à rebours avec sablier", () => {
    const future = Date.now() + 1800_000;
    const embed = economy.buildBalanceEmbed(100, { nextPointsAt: future }).toJSON();
    assert.match(embed.description, new RegExp(`⏳ Prochains points : <t:${Math.floor(future / 1000)}:R>`));
  });

  it("avec nextPointsAt disponible (null ou passé), l'embed indique que les points sont disponibles", () => {
    const past = Date.now() - 10_000;
    const embedNull = economy.buildBalanceEmbed(100, { nextPointsAt: null }).toJSON();
    const embedPast = economy.buildBalanceEmbed(100, { nextPointsAt: past }).toJSON();
    assert.match(embedNull.description, /✨ Prochains points : \*\*disponibles\*\*/);
    assert.match(embedPast.description, /✨ Prochains points : \*\*disponibles\*\*/);
  });

  it("calculateNextPointsAt : disponible pour un dresseur sans ligne ou sans message", () => {
    assert.equal(economy.calculateNextPointsAt(null), null);
    assert.equal(economy.calculateNextPointsAt({ last_message_at: 0 }), null);
  });

  it("calculateNextPointsAt : donne le délai exact d'une heure après un message récent", () => {
    const now = Date.UTC(2026, 9, 6, 12, 30, 0);
    const lastMessageAt = now - 20 * 60 * 1000;
    const row = {
      last_message_at: lastMessageAt,
      messages_today_count: 1,
      last_reset_date: "2026-10-06",
    };
    const nextAt = economy.calculateNextPointsAt(row, { now });
    assert.equal(nextAt, lastMessageAt + economy.ONE_HOUR_MS);
  });

  it("calculateNextPointsAt : disponible dès qu'une heure s'est écoulée", () => {
    const now = Date.UTC(2026, 9, 6, 13, 15, 0);
    const lastMessageAt = now - 65 * 60 * 1000;
    const row = {
      last_message_at: lastMessageAt,
      messages_today_count: 1,
      last_reset_date: "2026-10-06",
    };
    assert.equal(economy.calculateNextPointsAt(row, { now }), null);
  });

  it("calculateNextPointsAt : un changement de jour réinitialise le délai pour le 1er message", () => {
    const now = Date.UTC(2026, 9, 6, 0, 15, 0);
    const lastMessageAt = now - 30 * 60 * 1000;
    const row = {
      last_message_at: lastMessageAt,
      messages_today_count: 5,
      last_reset_date: "2026-10-05",
    };
    assert.equal(economy.calculateNextPointsAt(row, { now }), null);
  });

  it("calculateNextPointsAt : borne le délai à minuit UTC si l'heure déborde sur le jour suivant", () => {
    const now = Date.UTC(2026, 9, 6, 23, 45, 0);
    const lastMessageAt = now - 10 * 60 * 1000;
    const row = {
      last_message_at: lastMessageAt,
      messages_today_count: 1,
      last_reset_date: "2026-10-06",
    };
    const nextAt = economy.calculateNextPointsAt(row, { now });
    const midnight = Date.UTC(2026, 9, 7, 0, 0, 0);
    assert.equal(nextAt, midnight);
  });

  it("calculateNextPointsAt : quand le barème est épuisé pour la journée, attend minuit UTC", () => {
    const now = Date.UTC(2026, 9, 6, 15, 0, 0);
    const lastMessageAt = now - 70 * 60 * 1000;
    const distribution = { 1: 10, default: 0 };
    const row = {
      last_message_at: lastMessageAt,
      messages_today_count: 1,
      last_reset_date: "2026-10-06",
    };
    const nextAt = economy.calculateNextPointsAt(row, { now, distribution });
    const midnight = Date.UTC(2026, 9, 7, 0, 0, 0);
    assert.equal(nextAt, midnight);
  });

  it("getNextPointsAt lit l'état en base", async () => {
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const lastMsg = now - 15 * 60 * 1000;
    await dbRun(
      points,
      "INSERT INTO points (user_id, balance, last_message_at, messages_today_count, last_reset_date) VALUES (?, 100, ?, 1, ?)",
      ["u1", lastMsg, today]
    );
    const nextAt = await call(economy.getNextPointsAt, "u1");
    assert.ok(nextAt > now);
    assert.equal(nextAt, lastMsg + economy.ONE_HOUR_MS);

    const unknownUserNextAt = await call(economy.getNextPointsAt, "inconnu");
    assert.equal(unknownUserNextAt, null);
  });

  it("/solde affiche le solde et les points disponibles pour un dresseur sans message récent", async () => {
    await setBalance(500, "u1");
    const calls = await runCommand(soldeCommand, { user: "u1" });
    const reply = payloadOf(calls, "reply");
    assert.equal(reply.flags, MessageFlags.Ephemeral);
    const embed = reply.embeds[0].toJSON();
    assert.match(embed.description, /500[\s\u202f\u00a0]*points/);
    assert.match(embed.description, /✨ Prochains points : \*\*disponibles\*\*/);
  });

  it("/solde affiche le compte à rebours quand le dresseur est en attente d'une heure", async () => {
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const lastMsg = now - 20 * 60 * 1000;
    await dbRun(
      points,
      "INSERT INTO points (user_id, balance, last_message_at, messages_today_count, last_reset_date) VALUES (?, 800, ?, 2, ?)",
      ["u1", lastMsg, today]
    );
    const calls = await runCommand(soldeCommand, { user: "u1" });
    const reply = payloadOf(calls, "reply");
    const embed = reply.embeds[0].toJSON();
    assert.match(embed.description, /800[\s\u202f\u00a0]*points/);
    assert.match(embed.description, /⏳ Prochains points : <t:\d+:R>/);
  });

  it("/solde pour un autre dresseur affiche son solde et son statut", async () => {
    await setBalance(1200, "u2");
    const calls = await runCommand(soldeCommand, {
      user: "u1",
      users: { user: fakeUser("u2") },
      options: { user: "u2" },
    });
    const reply = payloadOf(calls, "reply");
    const embed = reply.embeds[0].toJSON();
    assert.match(embed.title, /Solde de Dresseur u2/);
    assert.match(embed.description, /1[\s\u202f\u00a0]200[\s\u202f\u00a0]*points/);
    assert.match(embed.description, /✨ Prochains points : \*\*disponibles\*\*/);
  });
});

describe("objets", () => {
  it("s'empilent, et le compte est exact", async () => {
    await grant("super_bonbon", 2);
    await grant("super_bonbon", 3);
    assert.equal(await count("super_bonbon"), 5);
  });

  it("n'en retirent que ce qui existe : « tu ne l'as plus » n'est pas une panne", async () => {
    await grant("super_bonbon", 2);
    assert.equal(await call(items.consumeItem, "u1", "super_bonbon", 3, { source: "test" }), false);
    assert.equal(await count("super_bonbon"), 2);
    assert.equal(await call(items.consumeItem, "u1", "super_bonbon", 2, { source: "test" }), true);
    assert.equal(await count("super_bonbon"), 0);
  });

  it("deux clics simultanés sur le même objet : un seul l'emporte", async () => {
    await grant("ticket_safari", 1);
    const results = await Promise.all([
      call(items.consumeItem, "u1", "ticket_safari", 1, { source: "test" }),
      call(items.consumeItem, "u1", "ticket_safari", 1, { source: "test" }),
    ]);
    assert.deepEqual(results.sort(), [false, true]);
  });

  it("refusent une clé ou une quantité invalide", async () => {
    await assert.rejects(() => grant("n'importe quoi", 1));
    await assert.rejects(() => grant("super_bonbon", 0));
    await assert.rejects(() => grant("super_bonbon", -2));
    await assert.rejects(() => grant("super_bonbon", 1.5));
  });

  it("un objet qu'on ne possède qu'une fois n'est donné qu'une fois", async () => {
    const first = await call(items.grantItemOnce, "u1", "charme_chroma_1", { source: "test" });
    const second = await call(items.grantItemOnce, "u1", "charme_chroma_1", { source: "test" });
    assert.deepEqual([first, second], [true, false]);
    assert.equal(await count("charme_chroma_1"), 1);
  });

  it("journalisent chaque mouvement avec sa source", async () => {
    await grant("super_bonbon", 2);
    await call(items.consumeItem, "u1", "super_bonbon", 1, { source: "vente" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const log = await dbAll(points, "SELECT delta, source FROM pokemon_item_log ORDER BY id");
    assert.deepEqual(log, [
      { delta: 2, source: "test" },
      { delta: -1, source: "vente" },
    ]);
  });

  it("l'inventaire se lit dans l'ordre du catalogue, sans les lignes à zéro", async () => {
    await grant("ball_master", 1);
    await grant("ball_poke", 2);
    await grant("super_bonbon", 1);
    await call(items.consumeItem, "u1", "super_bonbon", 1, { source: "test" });
    const rows = items.sortByCatalogue(await call(items.getInventory, "u1"));
    assert.deepEqual(rows.map((row) => row.item_key), ["ball_poke", "ball_master"]);
  });

  it("les balls en poche partent avant les points, dans l'ordre du catalogue", async () => {
    await grant("ball_hyper", 1);
    await grant("ball_poke", 3);
    const stock = await call(items.getBallStock, "u1");
    assert.deepEqual(stock.map((entry) => [entry.key, entry.count]), [["ball_poke", 3], ["ball_hyper", 1]]);
    const inventory = await call(items.getInventory, "u1");
    assert.equal(items.freeBallCount(inventory, "poke"), 3);
    assert.equal(items.freeBallCount(inventory, "super"), 0);
  });

  it("seuls les objets du catalogue qui ont une valeur se revendent", () => {
    assert.equal(items.itemSellValue(items.getItem("super_bonbon")), 300);
    assert.equal(items.itemSellValue(items.getItem("ball_master")), 0);
    assert.equal(items.itemSellValue(items.getItem("ball_poke")), 0);
    assert.equal(items.itemSellValue(null), 0);
    assert.equal(items.itemSellValue({ sellValue: -5 }), 0);
    assert.equal(items.itemSellValue({ sellValue: "abc" }), 0);
  });

  it("un objet d'une génération fermée ne tombe ni ne se gagne", () => {
    const stone = items.getItem("pierre_soleil");
    assert.equal(items.itemOpen(stone), false);
    assert.equal(items.itemDropWeight(stone), 0);
    assert.equal(items.itemLotteryWeight(stone), 0);
    assert.ok(items.itemDropWeight(items.getItem("super_bonbon")) > 0);
  });

  it("la loterie retombe sur le poids du butin quand le catalogue n'en dit rien", () => {
    const bonbon = items.getItem("super_bonbon");
    assert.equal(items.itemLotteryWeight(bonbon), items.itemDropWeight(bonbon));
    const poke = items.getItem("ball_poke");
    assert.ok(items.itemLotteryWeight(poke) > items.itemDropWeight(poke), "les balls pèsent plus lourd à la loterie");
  });

  it("le tirage d'un objet suit les poids", () => {
    const weightOf = (item) => items.itemDropWeight(item);
    const first = withRandom(0, () => items.pickWeightedItem(weightOf));
    assert.ok(first, "un objet tiré");
    const seen = new Set();
    for (let i = 0; i < 3000; i++) seen.add(items.pickWeightedItem(weightOf).key);
    assert.ok(seen.has("ball_poke") && seen.size > 4);
    assert.ok(!seen.has("pierre_soleil"), "la génération fermée ne tombe pas");
  });
});

describe("revente d'un objet", () => {
  it("retire d'abord, crédite ensuite : quantité × prix à l'unité", async () => {
    await grant("super_bonbon", 3);
    const result = await call(sell.sellItem, "u1", "super_bonbon", 2);
    assert.equal(result.ok, true);
    assert.equal(result.unit, 300);
    assert.equal(result.points, 600);
    assert.equal(await count("super_bonbon"), 1);
    assert.equal(await balance(), 600);
  });

  it("refuse un objet inconnu, invendable, ou une quantité invalide", async () => {
    await grant("ball_master", 1);
    assert.match((await call(sell.sellItem, "u1", "nimportequoi", 1)).reason, /inconnu/);
    assert.match((await call(sell.sellItem, "u1", "ball_master", 1)).reason, /ne se revend pas/);
    assert.match((await call(sell.sellItem, "u1", "super_bonbon", 0)).reason, /au moins un/);
    assert.match((await call(sell.sellItem, "u1", "super_bonbon", 1.5)).reason, /au moins un/);
    assert.equal(await count("ball_master"), 1);
    assert.equal(await balance(), 0);
  });

  it("refuse de vendre plus qu'on n'en a, sans rien toucher", async () => {
    await grant("super_bonbon", 1);
    const result = await call(sell.sellItem, "u1", "super_bonbon", 2);
    assert.equal(result.ok, false);
    assert.match(result.reason, /Tu n'as pas \*\*2\*\*/);
    assert.equal(await count("super_bonbon"), 1);
    assert.equal(await balance(), 0);
  });

  it("deux ventes simultanées du même objet ne le paient qu'une fois", async () => {
    await grant("pepite", 1);
    const results = await Promise.all([call(sell.sellItem, "u1", "pepite", 1), call(sell.sellItem, "u1", "pepite", 1)]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(await balance(), items.itemSellValue(items.getItem("pepite")));
  });

  it("rend les objets si le crédit échoue : rien ne se perd, rien ne se crée", async () => {
    await grant("super_bonbon", 3);
    await breakCredits();
    await assert.rejects(() => call(sell.sellItem, "u1", "super_bonbon", 2));
    await repairCredits();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await count("super_bonbon"), 3);
    assert.equal(await balance(), 0);
  });
});

describe("revente d'un Pokémon", () => {
  const sellGroup = (name, quantity, options = {}) =>
    call(sell.sellPokemon, "u1", { speciesId: species(name).id, isShiny: false, ...options }, quantity);

  it("le barème suit la rareté, les shiny et les légendaires ne se revendent pas", () => {
    const { byRarity } = getPokemonConfig().sell;
    assert.equal(sell.pokemonSellValue(species("Roucool"), false), byRarity.COMMUN);
    assert.equal(sell.pokemonSellValue(species("Roucoups"), false), byRarity.PEU_COMMUN);
    assert.equal(sell.pokemonSellValue(species("Roucarnage"), false), byRarity.RARE);
    assert.equal(sell.pokemonSellValue(species("Roucool"), true), 0);
    assert.equal(sell.pokemonSellValue(species("Mewtwo"), false), 0);
    assert.equal(sell.pokemonSellValue(null, false), 0);
  });

  it("aucun tarif ne dépasse le coût espéré d'une capture : la chasse n'est pas une imprimerie à points", () => {
    const { byRarity } = getPokemonConfig().sell;
    const hyper = getPokemonConfig().capture.balls.hyper;
    const wild = data.allSpecies().filter((entry) => data.spawnWeight(entry, getPokemonConfig().spawn) > 0);
    for (const rarity of Object.keys(byRarity)) {
      const rates = wild.filter((entry) => data.rarityOf(entry) === rarity).map((entry) => entry.catchRate);
      const average = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
      const cost = hyper.price / data.catchProbability(average, hyper.multiplier, 1);
      assert.ok(byRarity[rarity] < cost, `${rarity} : ${byRarity[rarity]} ≥ ${Math.round(cost)}`);
    }
  });

  it("vend les doublons, les stériles puis les plus récents d'abord", async () => {
    const old = await give("Roucool", { obtained: 1 });
    const recent = await give("Roucool", { obtained: 9 });
    const sterile = await give("Roucool", { obtained: 5, sterile: 1 });
    const result = await sellGroup("Roucool", 2);
    assert.equal(result.ok, true);
    assert.equal(result.points, 2 * getPokemonConfig().sell.byRarity.COMMUN);
    assert.deepEqual((await owned("Roucool")).map((row) => row.id), [old], "il reste le plus ancien");
    assert.ok(![recent, sterile].includes(old));
    assert.equal(await balance(), result.points);
  });

  it("garde toujours un exemplaire : on ne vend que des doublons", async () => {
    await give("Roucool");
    await give("Roucool");
    const refused = await sellGroup("Roucool", 2);
    assert.equal(refused.ok, false);
    assert.match(refused.reason, /Il reste toujours au moins un exemplaire/);
    assert.equal((await owned("Roucool")).length, 2);
    assert.equal(await balance(), 0);
    assert.equal((await sellGroup("Roucool", 1)).ok, true);
    assert.equal((await owned("Roucool")).length, 1);
  });

  it("dit les vrais chiffres du refus", async () => {
    await give("Roucool");
    await give("Roucool", { locked: 1 });
    await give("Roucool", { locked: 1 });
    const refused = await sellGroup("Roucool", 2);
    assert.match(refused.reason, /Tu as \*\*3\*\* Roucool, dont \*\*1\*\* revendable et \*\*2\*\* verrouillés/);
    assert.match(refused.reason, /impossible d'en revendre \*\*2\*\*/);
  });

  it("ne touche jamais à un verrouillé", async () => {
    const keep = await give("Roucool", { obtained: 1 });
    const locked = await give("Roucool", { obtained: 9, locked: 1 });
    const spare = await give("Roucool", { obtained: 5 });
    assert.equal((await sellGroup("Roucool", 1)).ok, true);
    const left = (await owned("Roucool")).map((row) => row.id);
    assert.ok(left.includes(locked), "le verrouillé reste");
    assert.ok(left.includes(keep) || left.includes(spare));
  });

  it("un individu désigné se vend seul, sauf verrouillé ou dernier de son espèce", async () => {
    const a = await give("Roucool");
    const b = await give("Roucool", { locked: 1 });
    const c = await give("Roucool");
    const target = (pokemonId) => ({ speciesId: species("Roucool").id, isShiny: false, pokemonId });
    assert.match((await call(sell.sellPokemon, "u1", target(a), 2)).reason, /se revend seul/);
    assert.match((await call(sell.sellPokemon, "u1", target(b), 1)).reason, /verrouillé/);
    assert.equal((await call(sell.sellPokemon, "u1", target(a), 1)).ok, true);
    assert.deepEqual((await owned("Roucool")).map((row) => row.id), [b, c]);
    assert.equal((await call(sell.sellPokemon, "u1", target(c), 1)).ok, true);
    const last = await call(sell.sellPokemon, "u1", target(b), 1);
    assert.equal(last.ok, false);
  });

  it("le Pokémon d'un autre ne se vend pas", async () => {
    const theirs = await give("Roucool", { user: "autre" });
    await give("Roucool", { user: "autre" });
    const result = await call(sell.sellPokemon, "u1", { speciesId: species("Roucool").id, isShiny: false, pokemonId: theirs }, 1);
    assert.equal(result.ok, false);
    assert.equal((await owned("Roucool", "autre")).length, 2);
  });

  it("un shiny ou un légendaire ne se revend pas, même en double", async () => {
    await give("Roucool", { shiny: 1 });
    await give("Roucool", { shiny: 1 });
    await give("Mewtwo");
    await give("Mewtwo");
    assert.match((await sellGroup("Roucool", 1, { isShiny: true })).reason, /ne se revend pas/);
    assert.match((await sellGroup("Mewtwo", 1)).reason, /ne se revend pas/);
    assert.equal((await owned("Mewtwo")).length, 2);
  });

  it("refuse une espèce inconnue ou une quantité invalide", async () => {
    assert.match((await call(sell.sellPokemon, "u1", { speciesId: 99999, isShiny: false }, 1)).reason, /inconnue/);
    await give("Roucool");
    await give("Roucool");
    for (const bad of [0, -1, 1.5]) assert.match((await sellGroup("Roucool", bad)).reason, /au moins un/);
  });

  it("peut se limiter à un sexe : seuls ceux-là partent, et il reste toujours un Roucool", async () => {
    const male = await give("Roucool", { sex: "M" });
    await give("Roucool", { sex: "F" });
    await give("Roucool", { sex: "F" });
    assert.equal((await sellGroup("Roucool", 2, { sex: "F" })).ok, true);
    assert.deepEqual((await owned("Roucool")).map((row) => row.id), [male]);
    assert.equal((await sellGroup("Roucool", 1, { sex: "M" })).ok, false, "le dernier reste");
  });

  it("rend les Pokémon à l'identique si le crédit échoue", async () => {
    const ids = [await give("Roucool", { obtained: 1 }), await give("Roucool", { obtained: 2 }), await give("Roucool", { obtained: 3, sex: "F" })];
    const before = await dbAll(points, "SELECT * FROM pokemon_owned ORDER BY id");
    await breakCredits();
    await assert.rejects(() => sellGroup("Roucool", 2));
    await repairCredits();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const after = await dbAll(points, "SELECT * FROM pokemon_owned ORDER BY id");
    assert.deepEqual(after, before);
    assert.deepEqual(after.map((row) => row.id), ids);
    assert.equal(await balance(), 0);
  });

  it("journalise la vente", async () => {
    await give("Roucool");
    await give("Roucool");
    await give("Roucool");
    await sellGroup("Roucool", 2);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const sales = await dbAll(points, "SELECT user_id, species_id, quantity, points FROM pokemon_sales");
    assert.deepEqual(sales, [
      { user_id: "u1", species_id: species("Roucool").id, quantity: 2, points: 2 * getPokemonConfig().sell.byRarity.COMMUN },
    ]);
  });
});
