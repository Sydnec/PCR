// Le lancer de ball : la partie la plus délicate du jeu. Deux invariants à tenir
// absolument — aucun solde sous zéro, et jamais deux vainqueurs pour le même
// Pokémon — sur des clics simultanés. Ici, de vraies bases et le hasard figé.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbGet, dbAll, eventually, withRandom, speciesByName } from "./helpers.js";

const BASE_CONFIG = {
  pokemon: {
    generationOpenings: { 2: "2999-01-01T00:00:00+01:00" },
    // L'embed public se rafraîchit après ce délai : court, pour ne pas retenir le processus.
    spawn: { embedRefreshMs: 1 },
    capture: { throwCooldownSeconds: 3 },
  },
};
const sandbox = createSandbox({ config: BASE_CONFIG });
const { points, stats } = await openDatabases();
const capture = await import("../modules/pokemon/capture.js");
const items = await import("../modules/pokemon/items.js");
const economy = await import("../modules/economy.js");
const data = await import("../modules/pokemon/data.js");
const { getBall, getPokemonConfig } = await import("../modules/pokemon/config.js");

const call = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value))));
const species = (name) => speciesByName(data.allSpecies, name);
// Discord n'est pas joignable : mettre à jour l'annonce échoue, ce que le jeu tolère.
const client = { channels: { fetch: async () => { throw new Error("pas de Discord"); } } };
const balls = () => getPokemonConfig().capture.balls;
const balance = (user = "u1") => call(economy.getBalance, user);
const setBalance = (amount, user = "u1") =>
  dbRun(points, "INSERT INTO points (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = ?", [user, amount, amount]);
const grant = (key, quantity, user = "u1") => call((...a) => items.grantItem(user, key, quantity, { source: "test" }, a.at(-1)));
const count = (key, user = "u1") => call(items.getItemCount, user, key);
const throws = () => dbAll(points, "SELECT user_id, ball, cost, result FROM pokemon_throws ORDER BY id");
const owned = () => dbAll(points, "SELECT user_id, species_id, is_shiny, ball, origin, locked, sex FROM pokemon_owned ORDER BY id");
const spawnRow = () => dbGet(points, "SELECT * FROM pokemon_spawns WHERE id = 1");

async function seedSpawn(name = "Roucool", overrides = {}) {
  await dbRun(points, "DELETE FROM pokemon_spawns");
  await dbRun(
    points,
    `INSERT INTO pokemon_spawns (id, species_id, is_shiny, catch_rate, rarity, status, spawned_at, flees_at, sex, held_item, charm_shiny, form)
     VALUES (1, ?, ?, ?, ?, ?, 1, 9999999999999, ?, ?, ?, NULL)`,
    [
      species(name).id,
      overrides.shiny ?? 0,
      overrides.rate ?? species(name).catchRate,
      overrides.rarity ?? data.rarityOf(species(name)),
      overrides.status ?? "ACTIVE",
      overrides.sex ?? "M",
      overrides.held ?? null,
      overrides.charm ?? 0,
    ]
  );
}

// Un lancer complet : le hasard figé, ce qui sort et sa phrase.
const throwBall = (userId, ball, random, options = {}) =>
  withRandom(random, () => call(capture.resolveThrow, client, userId, 1, ball, options));

beforeEach(async () => {
  for (const table of ["points", "pokemon_owned", "pokemon_inventory", "pokemon_item_log", "pokemon_throws", "pokemon_drops", "points_log"]) {
    await dbRun(points, `DELETE FROM ${table}`);
  }
  await seedSpawn();
});

describe("avant le tirage", () => {
  it("une ball inconnue est refusée avant tout", () => {
    assert.deepEqual(capture.startThrow("u1", "ball-fantome"), { status: "unknown-ball" });
  });

  it("le délai entre deux lancers est le même pour tous les chemins, et propre à chaque dresseur", () => {
    assert.equal(capture.startThrow("cd-a", "poke"), null, "le premier part");
    const refused = capture.startThrow("cd-a", "poke");
    assert.equal(refused.status, "cooldown");
    assert.ok(refused.remaining >= 1 && refused.remaining <= 3);
    assert.equal(capture.startThrow("cd-b", "poke"), null, "un autre dresseur n'attend pas");
  });

  it("sans délai réglé, on relance aussitôt", async () => {
    const { default: fs } = await import("node:fs");
    const file = `${process.env.PCR_DATA_DIR}/config.json`;
    const before = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, JSON.stringify({ pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" }, capture: { throwCooldownSeconds: 0 } } }));
    try {
      assert.equal(capture.startThrow("cd-c", "poke"), null);
      assert.equal(capture.startThrow("cd-c", "poke"), null);
    } finally {
      fs.writeFileSync(file, before);
    }
  });
});

describe("paiement", () => {
  it("un solde insuffisant refuse sans rien prélever, et dit les chiffres", async () => {
    await setBalance(balls().poke.price - 1);
    const outcome = await throwBall("u1", "poke", 0);
    assert.equal(outcome.status, "insufficient");
    assert.equal(outcome.balance, balls().poke.price - 1);
    assert.match(capture.throwMessage(outcome), /Solde insuffisant : une \*\*Poké Ball\*\* coûte \*\*\d+\*\* points, tu en as \*\*\d+\*\*/);
    assert.equal(await balance(), balls().poke.price - 1);
    assert.deepEqual(await throws(), []);
    assert.equal((await spawnRow()).throw_count, 0);
  });

  it("un dresseur sans ligne de solde ne lance pas", async () => {
    assert.equal((await throwBall("inconnu", "poke", 0)).status, "insufficient");
  });

  it("une ball offerte part avant les points, et n'est jamais rendue en monnaie", async () => {
    await setBalance(1000);
    await grant("ball_poke", 2);
    const outcome = await throwBall("u1", "poke", 0.999);
    assert.equal(outcome.status, "miss");
    assert.equal(outcome.payment.item, "ball_poke");
    assert.equal(await count("ball_poke"), 1);
    assert.equal(await balance(), 1000);
    assert.equal((await throws())[0].cost, 0, "une ball offerte ne compte pas dans les points brûlés");
    assert.match(capture.throwMessage(outcome), /Poké Ball offerte/);
  });

  it("sans ball offerte, le lancer coûte le prix de la ball", async () => {
    await setBalance(1000);
    const outcome = await throwBall("u1", "super", 0.999);
    assert.equal(outcome.status, "miss");
    assert.equal(await balance(), 1000 - balls().super.price);
    assert.deepEqual(await throws(), [{ user_id: "u1", ball: "super", cost: balls().super.price, result: "MISS" }]);
    assert.match(capture.throwMessage(outcome), new RegExp(`-${balls().super.price}\\*\\* points`));
  });

  it("une confirmation qui promet une ball offerte ne bascule jamais sur les points", async () => {
    await setBalance(100_000);
    const outcome = await throwBall("u1", "master", 0, { requireItem: true });
    assert.equal(outcome.status, "no-item");
    assert.match(capture.throwMessage(outcome), /Rien n'a été débité/);
    assert.equal(await balance(), 100_000);
    assert.equal((await spawnRow()).status, "ACTIVE");
  });

  it("deux lancers simultanés sur un solde qui n'en couvre qu'un : un seul paie, jamais de solde négatif", async () => {
    await setBalance(balls().poke.price + 10);
    const outcomes = await withRandom(0.999, () =>
      Promise.all([call(capture.resolveThrow, client, "u1", 1, "poke", {}), call(capture.resolveThrow, client, "u1", 1, "poke", {})])
    );
    assert.deepEqual(outcomes.map((o) => o.status).sort(), ["insufficient", "miss"]);
    assert.equal(await balance(), 10);
  });

  it("une ball offerte consommée par deux clics simultanés ne sert qu'une fois", async () => {
    await grant("ball_poke", 1);
    await setBalance(0);
    const outcomes = await withRandom(0.999, () =>
      Promise.all([call(capture.resolveThrow, client, "u1", 1, "poke", {}), call(capture.resolveThrow, client, "u1", 1, "poke", {})])
    );
    assert.deepEqual(outcomes.map((o) => o.status).sort(), ["insufficient", "miss"]);
    assert.equal(await count("ball_poke"), 0);
  });
});

describe("le tirage", () => {
  it("rate quand le tirage dépasse la probabilité : le Pokémon reste, le compteur monte", async () => {
    await setBalance(1000);
    const outcome = await throwBall("u1", "poke", 0.999);
    assert.equal(outcome.status, "miss");
    assert.equal((await spawnRow()).status, "ACTIVE");
    assert.equal((await spawnRow()).throw_count, 1);
    assert.deepEqual(capture.isFinalThrow(outcome), false);
    assert.match(capture.throwMessage(outcome), /Raté ! \*\*Roucool ♂\*\* s'est dégagé de ta Poké Ball/);
    assert.equal((await owned()).length, 0);
  });

  it("annonce la probabilité qu'il a utilisée", async () => {
    await setBalance(1000);
    const outcome = await throwBall("u1", "poke", 0.999);
    assert.ok(Math.abs(outcome.probability - data.catchProbability(species("Roucool").catchRate, balls().poke.multiplier, 1)) < 1e-9);
    assert.match(capture.throwMessage(outcome), /33\.3 % de réussite/);
  });

  it("capture, crédite la boîte avec la ball, le sexe de l'annonce, et ferme l'apparition", async () => {
    await setBalance(1000);
    const outcome = await throwBall("u1", "poke", 0);
    assert.equal(outcome.status, "catch");
    assert.equal(capture.isFinalThrow(outcome), true);
    const row = await spawnRow();
    assert.equal(row.status, "CAUGHT");
    assert.equal(row.caught_by, "u1");
    assert.equal(row.caught_ball, "poke");
    assert.equal(row.throw_count, 1);
    assert.deepEqual(await owned(), [
      { user_id: "u1", species_id: species("Roucool").id, is_shiny: 0, ball: "poke", origin: "capture", locked: 0, sex: "M" },
    ]);
    assert.equal(await balance(), 1000 - balls().poke.price);
    assert.deepEqual((await throws()).map((t) => t.result), ["CATCH"]);
    assert.match(capture.throwMessage(outcome), /Bravo ! \*\*Roucool ♂\*\* rejoint ton Pokédex/);
  });

  it("un shiny rejoint la boîte verrouillé, comme un légendaire", async () => {
    // De quoi payer les deux lancers : une Hyper Ball, puis une Master Ball.
    await setBalance(balls().hyper.price + balls().master.price);
    await seedSpawn("Roucool", { shiny: 1 });
    await throwBall("u1", "hyper", 0);
    const [shiny] = await owned();
    assert.equal(shiny.is_shiny, 1);
    assert.equal(shiny.locked, 1);
    await dbRun(points, "DELETE FROM pokemon_owned");
    await seedSpawn("Mewtwo");
    await throwBall("u1", "master", 0.999);
    assert.equal((await owned())[0].locked, 1);
  });

  it("la Master Ball capture quoi qu'il arrive, au prix configuré", async () => {
    await seedSpawn("Mewtwo");
    await setBalance(balls().master.price);
    const outcome = await throwBall("u1", "master", 0.9999);
    assert.equal(outcome.status, "catch");
    assert.equal(outcome.probability, 1);
    assert.equal(await balance(), 0);
  });

  it("le plancher joue dans le vrai tirage : un légendaire à taux 3 est capturé comme un taux 10", async () => {
    await seedSpawn("Mewtwo");
    await setBalance(100_000);
    const floor = data.catchProbability(3, balls().poke.multiplier, 1);
    const raw = (3 * balls().poke.multiplier) / 765;
    assert.ok(floor > raw);
    const between = (floor + raw) / 2 + (floor - raw) / 2 - 1e-6;
    assert.equal((await throwBall("u1", "poke", between)).status, "catch", "sous le seuil du plancher : capturé");
    await seedSpawn("Mewtwo");
    await dbRun(points, "DELETE FROM pokemon_owned");
    const miss = await throwBall("u1", "poke", floor + 1e-6);
    assert.equal(miss.status, "miss", "au-dessus : raté");
    assert.ok(Math.abs(miss.probability - floor) < 1e-9);
  });

  it("un Pokémon déjà parti ne coûte rien", async () => {
    await setBalance(1000);
    for (const status of ["CAUGHT", "FLED"]) {
      await seedSpawn("Roucool", { status });
      const outcome = await throwBall("u1", "poke", 0);
      assert.equal(outcome.status, "gone");
      assert.equal(capture.isFinalThrow(outcome), true);
      assert.match(capture.throwMessage(outcome), /n'est plus là/);
    }
    await dbRun(points, "DELETE FROM pokemon_spawns");
    assert.equal((await throwBall("u1", "poke", 0)).status, "gone", "apparition inconnue");
    assert.equal(await balance(), 1000);
    assert.deepEqual(await throws(), []);
  });

  it("une espèce inconnue est refusée sans débit", async () => {
    await dbRun(points, "UPDATE pokemon_spawns SET species_id = 99999");
    await setBalance(1000);
    const outcome = await throwBall("u1", "poke", 0);
    assert.equal(outcome.status, "unknown-species");
    assert.equal(await balance(), 1000);
  });
});

describe("la course à un seul vainqueur", () => {
  it("deux dresseurs qui visent juste ensemble : un seul capture, l'autre est remboursé", async () => {
    await setBalance(1000, "u1");
    await setBalance(1000, "u2");
    const outcomes = await withRandom(0, () =>
      Promise.all([call(capture.resolveThrow, client, "u1", 1, "poke", {}), call(capture.resolveThrow, client, "u2", 1, "poke", {})])
    );
    const statuses = outcomes.map((outcome) => outcome.status).sort();
    assert.deepEqual(statuses, ["catch", "void"]);
    const winner = outcomes.find((outcome) => outcome.status === "catch");
    const loser = outcomes.find((outcome) => outcome.status === "void");
    assert.match(capture.throwMessage(loser), /plus rapide.*points ont été remboursés/);
    assert.equal((await owned()).length, 1, "un seul Pokémon créé");
    const results = (await throws()).map((t) => t.result).sort();
    assert.deepEqual(results, ["CATCH", "VOID"]);
    const balances = [await balance("u1"), await balance("u2")].sort((a, b) => a - b);
    assert.deepEqual(balances, [1000 - balls().poke.price, 1000], "le perdant retrouve ses points");
    assert.equal((await spawnRow()).caught_by, (await owned())[0].user_id);
    assert.ok(winner.caught);
  });

  it("un perdant qui avait lancé une ball offerte la retrouve, jamais en points", async () => {
    await grant("ball_poke", 1, "u2");
    await setBalance(1000, "u1");
    const outcomes = await withRandom(0, () =>
      Promise.all([call(capture.resolveThrow, client, "u1", 1, "poke", {}), call(capture.resolveThrow, client, "u2", 1, "poke", {})])
    );
    const [u1, u2] = outcomes;
    assert.deepEqual([u1.status, u2.status].sort(), ["catch", "void"]);
    // Quel que soit le vainqueur, u2 n'a jamais un point de plus : sa ball offerte se
    // rend en ball, pas en monnaie.
    assert.equal(await balance("u2"), 0);
    if (u2.status === "void") {
      assert.match(capture.throwMessage(u2), /Poké Ball.*rendue/);
      assert.equal(await count("ball_poke", "u2"), 1);
      assert.equal(await balance("u1"), 1000 - balls().poke.price);
    } else {
      assert.equal(await count("ball_poke", "u2"), 0, "le gagnant a bien dépensé sa ball offerte");
      assert.equal(await balance("u1"), 1000, "u1 est remboursé en points");
    }
  });

  it("des lancers qui suivent une capture sont remboursés comme « trop tard »", async () => {
    await setBalance(1000);
    await throwBall("u1", "poke", 0);
    await setBalance(1000, "u2");
    const late = await throwBall("u2", "poke", 0);
    assert.equal(late.status, "gone");
    assert.equal(await balance("u2"), 1000);
  });
});

describe("le prix progressif de la Master Ball", () => {
  const fmt = (value) => value.toLocaleString("fr-FR");
  // Le scénario du jeu : 10 000 au premier achat, puis ×1,2 à chaque suivant.
  const progressive = (growth = 1.2) =>
    sandbox.writeConfig({
      pokemon: {
        ...BASE_CONFIG.pokemon,
        capture: { ...BASE_CONFIG.pokemon.capture, balls: { master: { price: 10_000, priceGrowth: growth } } },
      },
    });
  beforeEach(() => progressive());
  afterEach(() => sandbox.writeConfig(BASE_CONFIG));

  // Un achat déjà fait, tel que le journal des lancers le garde.
  const logPurchase = (user, cost, result = "CATCH") =>
    dbRun(
      points,
      "INSERT INTO pokemon_throws (spawn_id, user_id, ball, cost, probability, result, thrown_at) VALUES (0, ?, 'master', ?, 1, ?, 1)",
      [user, cost, result]
    );
  const priceOf = (user = "u1") => call(capture.getBallPrice, user, getBall("master"));

  it("chaque achat payé en points renchérit le suivant de ×1,2", async () => {
    await setBalance(100_000);
    const costs = [];
    for (let bought = 0; bought < 3; bought++) {
      await seedSpawn("Mewtwo");
      const before = await balance();
      assert.equal((await throwBall("u1", "master", 0)).status, "catch");
      costs.push(before - (await balance()));
    }
    assert.deepEqual(costs, [10_000, 12_000, 14_400]);
    assert.deepEqual((await throws()).map((row) => row.cost), costs, "le journal garde ce qui a été payé");
    assert.equal(await priceOf(), 17_280);
  });

  it("le compte est propre à chaque dresseur", async () => {
    await logPurchase("u2", 10_000);
    await logPurchase("u2", 12_000);
    assert.equal(await priceOf("u2"), 14_400);
    assert.equal(await priceOf("u1"), 10_000);
  });

  it("un achat fait avant la progression compte : il est déjà dans le journal", async () => {
    await logPurchase("u1", 10_000);
    await setBalance(50_000);
    const outcome = await throwBall("u1", "master", 0);
    assert.equal(outcome.payment.points, 12_000);
    assert.equal(await balance(), 38_000);
  });

  it("une Master Ball offerte, ou un lancer remboursé, n'avance pas le compte", async () => {
    await logPurchase("u1", 0);
    await logPurchase("u1", 10_000, "VOID");
    assert.equal(await priceOf(), 10_000);
    await grant("ball_master", 1);
    const outcome = await throwBall("u1", "master", 0, { requireItem: true });
    assert.equal(outcome.payment.item, "ball_master");
    assert.equal(await priceOf(), 10_000);
  });

  it("sans assez de points, le refus dit le prix de ce dresseur et ne débite rien", async () => {
    await logPurchase("u1", 10_000);
    await setBalance(11_999);
    const outcome = await throwBall("u1", "master", 0);
    assert.equal(outcome.status, "insufficient");
    assert.equal(outcome.price, 12_000);
    assert.match(capture.throwMessage(outcome), new RegExp(`coûte \\*\\*${fmt(12_000)}\\*\\* points, tu en as \\*\\*${fmt(11_999)}\\*\\*`));
    assert.equal(await balance(), 11_999);
    assert.equal((await spawnRow()).status, "ACTIVE");
    assert.equal((await throws()).length, 1, "seul l'achat d'avant est au journal");
  });

  it("le prix annoncé à la confirmation est tenu : monté entre-temps, rien n'est débité", async () => {
    await logPurchase("u1", 10_000);
    await setBalance(50_000);
    const outcome = await throwBall("u1", "master", 0, { expectedPrice: 10_000 });
    assert.equal(outcome.status, "price-changed");
    assert.equal(outcome.price, 12_000);
    assert.equal(capture.isFinalThrow(outcome), false);
    assert.match(capture.throwMessage(outcome), new RegExp(`passé à \\*\\*${fmt(12_000)}\\*\\* points depuis ta confirmation\\. Rien n'a été débité`));
    assert.equal(await balance(), 50_000);
    assert.equal((await spawnRow()).status, "ACTIVE");
    assert.equal((await throws()).length, 1);

    const kept = await throwBall("u1", "master", 0, { expectedPrice: 12_000 });
    assert.equal(kept.status, "catch");
    assert.equal(await balance(), 38_000);
  });

  it("une Master Ball en poche passe avant les points, quel que soit le prix annoncé", async () => {
    await logPurchase("u1", 10_000);
    await setBalance(50_000);
    await grant("ball_master", 1);
    const outcome = await throwBall("u1", "master", 0, { expectedPrice: 10_000 });
    assert.equal(outcome.status, "catch");
    assert.equal(outcome.payment.item, "ball_master");
    assert.equal(await balance(), 50_000);
  });

  it("deux dresseurs qui visent juste ensemble : le perdant retrouve ce qu'il avait payé, à son prix", async () => {
    await logPurchase("u1", 10_000);
    await setBalance(50_000, "u1");
    await setBalance(50_000, "u2");
    const outcomes = await withRandom(0, () =>
      Promise.all([call(capture.resolveThrow, client, "u1", 1, "master", {}), call(capture.resolveThrow, client, "u2", 1, "master", {})])
    );
    const [u1, u2] = outcomes;
    assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ["catch", "void"]);
    assert.equal(await balance("u1"), u1.status === "catch" ? 50_000 - 12_000 : 50_000);
    assert.equal(await balance("u2"), u2.status === "catch" ? 50_000 - 10_000 : 50_000);

    const [loser, loserId, due] = u1.status === "void" ? [u1, "u1", 12_000] : [u2, "u2", 10_000];
    assert.match(capture.throwMessage(loser), new RegExp(`\\*\\*${fmt(due)}\\*\\* points ont été remboursés`));
    assert.equal((await throws()).find((row) => row.result === "VOID").cost, due, "le journal garde le montant rendu");
    assert.equal(await priceOf(loserId), due, "un lancer remboursé ne renchérit pas");
  });

  it("un journal illisible ne fait rien payer : le lancer répond « error »", async () => {
    await setBalance(50_000);
    await dbRun(points, "ALTER TABLE pokemon_throws RENAME TO pokemon_throws_off");
    try {
      assert.equal((await throwBall("u1", "master", 0)).status, "error");
    } finally {
      await dbRun(points, "ALTER TABLE pokemon_throws_off RENAME TO pokemon_throws");
    }
    assert.equal(await balance(), 50_000);
    assert.equal((await spawnRow()).status, "ACTIVE");
  });

  it("à 1, le prix redevient fixe", async () => {
    progressive(1);
    await logPurchase("u1", 10_000);
    await logPurchase("u1", 10_000);
    assert.equal(await priceOf(), 10_000);
  });
});

describe("l'objet tenu", () => {
  beforeEach(() => grant("pepite", 0).catch(() => {}));

  it("suit le Pokémon dans le sac de celui qui l'attrape", async () => {
    await seedSpawn("Roucool", { held: "pepite" });
    await setBalance(10_000);
    // Hyper Ball : capture à tout tirage ; 0.5 ne fait pas lâcher l'objet (20 %).
    const outcome = await throwBall("u1", "hyper", 0.5);
    assert.equal(outcome.status, "catch");
    assert.equal(outcome.held.item.key, "pepite");
    assert.equal(outcome.held.dropped, false);
    assert.equal(await count("pepite"), 1);
    assert.match(capture.throwMessage(outcome), /Il tenait \*\*Pépite\*\*/);
  });

  it("quand il le lâche sans salon où l'annoncer, l'objet revient quand même au capteur", async () => {
    await seedSpawn("Roucool", { held: "pepite" });
    await setBalance(10_000);
    const outcome = await throwBall("u1", "hyper", 0.1);
    assert.equal(outcome.status, "catch");
    assert.equal(outcome.held.dropped, true);
    await eventually(async () => {
      assert.equal(await count("pepite"), 1, "rien ne se perd");
      const drops = await dbAll(points, "SELECT status FROM pokemon_drops");
      assert.ok(drops.length > 0 && drops.every((drop) => drop.status === "LOST"), "l'objet qu'aucun message n'annonce est refermé");
    });
  });

  it("sans objet tenu, rien n'est ajouté au sac", async () => {
    await setBalance(10_000);
    const outcome = await throwBall("u1", "hyper", 0.5);
    assert.equal(outcome.held, null);
    assert.deepEqual(await call(items.getInventory, "u1"), []);
  });
});

describe("le Charme Chroma", () => {
  it("un Pokémon qui ne brille que pour les porteurs brille pour son vainqueur porteur", async () => {
    await seedSpawn("Roucool", { charm: 1 });
    await setBalance(10_000);
    await grant("charme_chroma_1", 1);
    const outcome = await throwBall("u1", "hyper", 0.5);
    assert.equal(outcome.status, "catch");
    assert.equal(outcome.charmed, true);
    assert.equal(outcome.shiny, true);
    assert.equal((await owned())[0].is_shiny, 1);
    assert.equal((await spawnRow()).is_shiny, 1, "la ligne dit ce qui a été attrapé");
    assert.match(capture.throwMessage(outcome), /Il brillait pour toi, grâce à ton \*\*Charme Chroma/);
  });

  it("pour un vainqueur sans charme, il reste normal", async () => {
    await seedSpawn("Roucool", { charm: 1 });
    await setBalance(10_000);
    const outcome = await throwBall("u1", "hyper", 0.5);
    assert.equal(outcome.shiny, false);
    assert.equal((await owned())[0].is_shiny, 0);
  });
});

describe("les messages", () => {
  it("disent chaque issue en toutes lettres", () => {
    const ball = balls().poke;
    const message = (outcome) => capture.throwMessage({ ball: { label: "Poké Ball", ...ball }, ...outcome });
    assert.match(message({ status: "unknown-ball" }), /Ball inconnue/);
    assert.match(message({ status: "cooldown", remaining: 2 }), /Attends encore \*\*2s\*\*/);
    assert.match(message({ status: "unknown-species" }), /Espèce inconnue/);
    assert.match(message({ status: "no-item" }), /Tu n'as plus de \*\*Poké Ball\*\*/);
    assert.match(message({ status: "void", payment: { points: 100 } }), /\*\*100\*\* points ont été remboursés/);
    assert.match(message({ status: "void", payment: { item: "ball_poke", label: "Poké Ball" } }), /Poké Ball\*\* t'a été rendue/);
    assert.match(message({ status: "insufficient", price: 12_000, balance: 50 }), /coûte \*\*12\D000\*\* points, tu en as \*\*50\*\*/);
    assert.match(message({ status: "price-changed", price: 12_000 }), /passé à \*\*12\D000\*\* points depuis ta confirmation\. Rien n'a été débité/);
    assert.match(message({ status: "n'importe quoi" }), /Erreur base de données/);
  });

  it("les issues finales sont celles où il n'y a plus rien à relancer", () => {
    for (const status of ["gone", "unknown-species", "void", "catch"]) assert.equal(capture.isFinalThrow({ status }), true, status);
    for (const status of ["miss", "insufficient", "price-changed", "cooldown", "no-item"]) assert.equal(capture.isFinalThrow({ status }), false, status);
  });
});

describe("statistiques de l'année", () => {
  it("un lancer et une capture laissent leur trace dans la base de l'année", async () => {
    await setBalance(1000);
    await throwBall("u1", "poke", 0.999);
    await throwBall("u1", "hyper", 0.5);
    await eventually(async () => {
      const rows = await dbAll(stats, "SELECT * FROM pokemon_stats");
      assert.ok(rows.length > 0, "des statistiques sont écrites");
      const total = rows.find((row) => row.user_id === "__global__");
      assert.ok(total, "la ligne globale du serveur existe");
    });
  });
});
