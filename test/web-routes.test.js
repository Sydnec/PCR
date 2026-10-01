// Les routes du site qui ne sont pas couvertes ailleurs : lectures (boîte,
// Pokédex, apparition, vitrine, dresseurs), rangement (PC, vitrine, surnoms,
// verrou) et actions (lancer, objet au sol, évolution, œuf). Chacune est appelée
// avec un contexte factice et un faux Discord : ce qu'on vérifie, c'est que la
// route valide ses entrées (400), traduit un refus du jeu en 409, protège les
// Pokémon des autres (404) — et rend exactement ce que le jeu a décidé.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbGet, dbAll, sleep, withRandom, speciesByName } from "./helpers.js";

const sandbox = createSandbox({ config: { pokemon: { generation: 2 } } });
process.env.GUILD_ID = "guild-1";
process.env.POKEMON_CHANNEL_ID = "123";
const { points } = await openDatabases();
const { routes, HttpError } = await import("../modules/web/api.js");
const data = await import("../modules/pokemon/data.js");
const items = await import("../modules/pokemon/items.js");
const economy = await import("../modules/economy.js");
const { getPokemonConfig, getBalls } = await import("../modules/pokemon/config.js");

const USER = "10001";
const OTHER = "10002";
const species = (name) => speciesByName(data.allSpecies, name);
const route = (method, path) => {
  const found = routes.find((entry) => entry.method === method && entry.path === path);
  assert.ok(found, `${method} ${path} n'existe pas`);
  return found;
};

// Un Discord qui connaît quelques membres : les autres ont quitté le serveur.
const channelEdits = [];
const bot = {
  guilds: {
    fetch: async () => ({
      members: {
        fetch: async (id) => {
          if (id === "99999") throw new Error("Unknown Member");
          return { displayName: `Dresseur ${id}`, displayAvatarURL: ({ size }) => `https://cdn.test/${id}.png?size=${size}` };
        },
      },
    }),
  },
  channels: {
    fetch: async () => ({
      send: async () => ({ id: "m1", edit: async () => {} }),
      messages: {
        fetch: async (id) => ({ id, embeds: [], edit: async (next) => channelEdits.push({ id, ...next }) }),
      },
    }),
  },
};

const ctx = ({ body = {}, params = {}, query = {}, user = { id: USER } } = {}) => ({ user, body, params, query, bot });
const call = (method, path, options) => route(method, path).handler(ctx(options));
const failure = async (promise, status) => {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpError, `HttpError attendue, reçu : ${error?.stack ?? error}`);
    if (status) assert.equal(error.status, status, error.message);
    return error;
  }
  assert.fail("une HttpError était attendue");
};
const callback = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value))));
const setBalance = (amount, user = USER) =>
  dbRun(points, "INSERT INTO points (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = ?", [user, amount, amount]);
const grant = (key, quantity, user = USER) => callback(items.grantItem, user, key, quantity, { source: "test" });

async function own(name, { user = USER, shiny = 0, sex = "M", obtained = 1, sterile = 0, locked = 0, pos = null } = {}) {
  const { lastID } = await dbRun(
    points,
    "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, sterile, obtained_at, locked, pc_pos) VALUES (?, ?, ?, ?, 'test', ?, ?, ?, ?)",
    [user, species(name).id, shiny, sex, sterile, obtained, locked, pos]
  );
  return lastID;
}
const ownMany = async (name, count, options = {}) => {
  const ids = [];
  for (let index = 0; index < count; index++) ids.push(await own(name, { obtained: index + 1, ...options }));
  return ids;
};
async function spawnRow(name = "Roucool", overrides = {}) {
  await dbRun(points, "DELETE FROM pokemon_spawns");
  const { lastID } = await dbRun(
    points,
    `INSERT INTO pokemon_spawns (species_id, is_shiny, catch_rate, rarity, status, spawned_at, flees_at, sex, held_item, charm_shiny, channel_id, message_id)
     VALUES (?, ?, ?, ?, 'ACTIVE', ?, 9999999999999, 'M', ?, 0, '123', 'm1')`,
    [species(name).id, overrides.shiny ?? 0, species(name).catchRate, data.rarityOf(species(name)), Date.now(), overrides.heldItem ?? null]
  );
  return lastID;
}

beforeEach(async () => {
  for (const table of [
    "points", "pokemon_owned", "pokemon_inventory", "pokemon_item_log", "pokemon_sales", "pokemon_spawns", "pokemon_throws",
    "pokemon_drops", "pokemon_eggs", "pokemon_pc_boxes", "pokemon_showcase_shares", "points_log", "pokemon_fusions",
  ]) {
    await dbRun(points, `DELETE FROM ${table}`);
  }
  await dbRun(points, "UPDATE pokemon_state SET spawning = 0, message_count = 0, spawn_paused_until = 0 WHERE id = 1");
  channelEdits.length = 0;
});

describe("l'identité : /api/me, l'œuf, le Pokédex", () => {
  it("le solde, les balls en poche et pas d'œuf", async () => {
    await setBalance(1234);
    await grant("ball_super", 2);
    const me = await call("GET", "/api/me");
    assert.deepEqual(me.user, { id: USER });
    assert.equal(me.balance, 1234);
    assert.equal(me.egg, null);
    assert.ok(Array.isArray(me.balls) && me.balls.length > 0);
    assert.equal((await call("GET", "/api/me/egg")).egg, null);
  });

  it("le Pokédex d'un dresseur : une entrée par espèce et variante, et la taille du Pokédex", async () => {
    await ownMany("Rattata", 2);
    await own("Rattata", { shiny: 1, obtained: 5 });
    const dex = await call("GET", "/api/users/:userId/pokedex", { params: { userId: "me" } });
    assert.equal(dex.dexSize, data.dexSize());
    assert.deepEqual(dex.entries.map((entry) => [entry.speciesId, entry.shiny, entry.count]), [
      [species("Rattata").id, false, 2],
      [species("Rattata").id, true, 1],
    ]);
  });

  it("l'identifiant d'un dresseur est validé : « me » ou un identifiant Discord, rien d'autre", async () => {
    for (const userId of ["abc", "12", "../etc", "1".repeat(30), ""]) {
      await failure(call("GET", "/api/users/:userId/pokedex", { params: { userId } }), 400);
    }
    await failure(call("GET", "/api/users/:userId/pokedex", { params: { userId: "me" }, user: null }), 401);
    const other = await call("GET", "/api/users/:userId/pokedex", { params: { userId: OTHER } });
    assert.deepEqual(other.entries, []);
  });
});

describe("la boîte (/api/users/:userId/box)", () => {
  const box = (query = {}, userId = "me") => call("GET", "/api/users/:userId/box", { params: { userId }, query });

  it("les plus récents d'abord, avec la pagination", async () => {
    const ids = await ownMany("Rattata", 5);
    const page = await box({ pageSize: "2" });
    assert.equal(page.total, 5);
    assert.equal(page.pages, 3);
    assert.deepEqual(page.items.map((item) => item.id), [ids[4], ids[3]]);
    assert.deepEqual((await box({ pageSize: "2", page: "2" })).items.map((item) => item.id), [ids[0]]);
  });

  it("une page hors limites est ramenée à la dernière, une taille absurde est bornée", async () => {
    await ownMany("Rattata", 3);
    assert.equal((await box({ pageSize: "2", page: "99" })).page, 1);
    assert.equal((await box({ page: "-4" })).page, 0);
    assert.equal((await box({ pageSize: "0" })).pageSize, 1);
    assert.equal((await box({ pageSize: "100000" })).pageSize, 200);
    assert.equal((await box({ pageSize: "n'importe quoi" })).pageSize, 50);
  });

  it("se filtre par espèce, sexe, fertilité et variante", async () => {
    await own("Rattata", { sex: "M", obtained: 1 });
    await own("Rattata", { sex: "F", obtained: 2, sterile: 1 });
    await own("Rattata", { sex: "F", obtained: 3, shiny: 1 });
    await own("Roucool", { sex: "M", obtained: 4 });
    await own("Mewtwo", { sex: null, obtained: 5 });
    assert.equal((await box({ species: String(species("Rattata").id) })).total, 3);
    assert.equal((await box({ sex: "F" })).total, 2);
    assert.equal((await box({ sex: "none" })).total, 1);
    assert.equal((await box({ fertile: "false" })).total, 1);
    assert.equal((await box({ fertile: "true" })).total, 4);
    assert.equal((await box({ shiny: "true" })).total, 1);
    assert.equal((await box({ shiny: "false", species: String(species("Rattata").id) })).total, 2);
  });

  it("chaque individu porte de quoi s'afficher : verrou, dernier de son espèce, surnom, vitrine", async () => {
    const [a, b] = await ownMany("Rattata", 2);
    await dbRun(points, "UPDATE pokemon_owned SET locked = 1, nickname = 'Ratou', showcase_pos = 1 WHERE id = ?", [a]);
    const { items: list } = await box();
    const first = list.find((item) => item.id === a);
    const second = list.find((item) => item.id === b);
    assert.deepEqual({ locked: first.locked, nickname: first.nickname, showcased: first.showcased, last: first.last }, { locked: true, nickname: "Ratou", showcased: true, last: false });
    assert.equal(second.showcased, false);
    assert.equal(second.nickname, null);
    assert.equal(second.fertile, true);
  });

  it("on peut lire la boîte d'un autre dresseur, pas la modifier", async () => {
    await own("Roucool", { user: OTHER });
    assert.equal((await box({}, OTHER)).total, 1);
    assert.equal((await box({})).total, 0);
  });
});

describe("l'écran d'évolution (/api/species/:id/evolution)", () => {
  const evolution = (speciesId, { query = {}, user = { id: USER } } = {}) =>
    call("GET", "/api/species/:speciesId/evolution", { params: { speciesId: String(speciesId) }, query, user });

  it("ce que coûterait l'évolution, sans rien faire", async () => {
    const plan = await evolution(species("Rattata").id);
    assert.equal(plan.target, species("Rattatac").id);
    assert.equal(plan.points, getPokemonConfig().evolution[2].points);
    assert.equal(plan.required, plan.sacrifices + 2);
    assert.equal(plan.branching, false);
    assert.equal(plan.helper, null);
    assert.equal((await dbAll(points, "SELECT * FROM pokemon_fusions")).length, 0);
  });

  it("une lignée à embranchement donne toutes ses cibles, et le choix coûte plus", async () => {
    const random = await evolution(species("Évoli").id);
    assert.equal(random.branching, true);
    assert.equal(random.target, null);
    assert.equal(random.targets.length, 5);
    const chosen = await evolution(species("Évoli").id, { query: { targetId: String(species("Aquali").id) } });
    assert.equal(chosen.target, species("Aquali").id);
    assert.equal(chosen.points, getPokemonConfig().evolution.branchChoicePoints);
  });

  it("les objets utiles sont listés, avec ce qu'on en a quand on est connecté", async () => {
    await grant("super_bonbon", 5);
    const helpers = (await evolution(species("Rattata").id)).helpers;
    const candy = helpers.find((helper) => helper.key === "super_bonbon");
    assert.equal(candy.quantity, 3);
    assert.equal(candy.held, 5);
    assert.equal(candy.usable, true);
    const anonymous = (await evolution(species("Rattata").id, { user: null })).helpers.find((helper) => helper.key === "super_bonbon");
    assert.equal(anonymous.held, null, "sans connexion, on ne dit rien du sac");
    assert.equal(anonymous.usable, null);
  });

  it("deux bonbons ne sont pas utilisables : il en faut trois ou rien", async () => {
    await grant("super_bonbon", 2);
    const candy = (await evolution(species("Rattata").id)).helpers.find((helper) => helper.key === "super_bonbon");
    assert.equal(candy.usable, false);
    assert.equal(candy.held, null);
  });

  it("avec un objet, le plan en tient compte", async () => {
    const plan = await evolution(species("Rattata").id, { query: { helper: "super_bonbon" } });
    assert.deepEqual(plan.helper, { key: "super_bonbon", quantity: 3 });
    assert.equal(plan.required, 2);
  });

  it("une espèce qui n'évolue pas, ou qui n'évolue qu'avec un objet, répond 409 en le disant", async () => {
    const none = await failure(evolution(species("Mewtwo").id), 409);
    assert.match(none.message, /n'a pas d'évolution/);
    const gated = await failure(evolution(species("Onix").id), 409);
    assert.match(gated.message, /n'évolue qu'avec \*\*Catalyseur\*\*/);
    assert.deepEqual(gated.details.needs, ["Catalyseur"]);
    assert.ok(gated.details.helpers.some((helper) => helper.key === "catalyseur"), "l'écran propose l'objet");
    await failure(evolution(99999), 409);
  });
});

describe("évoluer (/api/me/evolve)", () => {
  const evolve = (body) => call("POST", "/api/me/evolve", { body });

  it("fait évoluer l'individu désigné et rend ce qui a changé", async () => {
    const ids = await ownMany("Rattata", 3);
    await setBalance(5000);
    const result = await evolve({ pokemonId: ids[2], speciesId: species("Rattata").id });
    assert.equal(result.pokemon.id, ids[2]);
    assert.equal(result.pokemon.speciesId, species("Rattatac").id);
    assert.equal(result.sacrificesSpent, 1);
    assert.equal(result.dittosSpent, 0);
    assert.equal(result.pointsSpent, getPokemonConfig().evolution[2].points);
    assert.equal(result.helper, null);
    assert.equal(await callback(economy.getBalance, USER), 5000 - result.pointsSpent);
  });

  it("un second envoi sur le même Pokémon est refusé : il ne repaie pas une évolution", async () => {
    const ids = await ownMany("Rattata", 4);
    await setBalance(9000);
    await evolve({ pokemonId: ids[3], speciesId: species("Rattata").id });
    const again = await failure(evolve({ pokemonId: ids[3], speciesId: species("Rattata").id }), 409);
    assert.match(again.message, /ne peut pas évoluer/);
  });

  it("un Pokémon verrouillé demande confirmation : 409 avec `locked`, puis évolue une fois confirmé", async () => {
    const ids = await ownMany("Rattata", 3);
    await dbRun(points, "UPDATE pokemon_owned SET locked = 1 WHERE id = ?", [ids[2]]);
    await setBalance(5000);
    const asked = await failure(evolve({ pokemonId: ids[2], speciesId: species("Rattata").id }), 409);
    assert.deepEqual(asked.details, { locked: true });
    const done = await evolve({ pokemonId: ids[2], speciesId: species("Rattata").id, confirmLocked: true });
    assert.equal(done.pokemon.id, ids[2]);
  });

  it("un objet se joint à la demande, et son nom revient", async () => {
    const ids = await ownMany("Rattata", 2);
    await grant("super_bonbon", 3);
    await setBalance(5000);
    const result = await evolve({ pokemonId: ids[1], speciesId: species("Rattata").id, helper: "super_bonbon" });
    assert.equal(result.helper, "super_bonbon");
    assert.equal(result.sacrificesSpent, 0);
  });

  it("Métamorph comble un sacrifice, et la réponse le compte à part", async () => {
    const ids = await ownMany("Rattata", 2);
    await ownMany("Métamorph", 2);
    await setBalance(5000);
    const result = await evolve({ pokemonId: ids[1], speciesId: species("Rattata").id, helper: "metamorph" });
    assert.equal(result.dittosSpent, 1);
    assert.equal(result.helper, "metamorph");
  });

  it("une cible choisie sur Évoli se paie au tarif du choix", async () => {
    const ids = await ownMany("Évoli", 3);
    await setBalance(9000);
    const result = await evolve({ pokemonId: ids[2], speciesId: species("Évoli").id, targetId: species("Voltali").id });
    assert.equal(result.pokemon.speciesId, species("Voltali").id);
    assert.equal(result.pointsSpent, getPokemonConfig().evolution.branchChoicePoints);
  });

  it("un groupe, sans individu, laisse le bot choisir", async () => {
    await ownMany("Rattata", 3);
    await setBalance(5000);
    const result = await evolve({ speciesId: species("Rattata").id, isShiny: false });
    assert.equal(result.pokemon.speciesId, species("Rattatac").id);
  });

  it("le corps de la requête est validé", async () => {
    await failure(evolve(undefined), 400);
    await failure(evolve({ pokemonId: -2 }), 400);
    await failure(evolve({ pokemonId: "abc" }), 400);
    await failure(evolve({ speciesId: 99999 }), 400);
    await failure(evolve({}), 400);
  });

  it("le Pokémon d'un autre, ou inexistant : 404, rien ne bouge", async () => {
    const stranger = await own("Rattata", { user: OTHER });
    await failure(evolve({ pokemonId: stranger, speciesId: species("Rattata").id }), 404);
    await failure(evolve({ pokemonId: 99999 }), 404);
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_owned")).length, 1);
  });

  it("des points qui manquent : 409 avec les chiffres, sacrifices rendus", async () => {
    const ids = await ownMany("Rattata", 3);
    await setBalance(10);
    const refused = await failure(evolve({ pokemonId: ids[2], speciesId: species("Rattata").id }), 409);
    assert.match(refused.message, /Solde insuffisant : cette évolution coûte \*\*1500\*\* points/);
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_owned WHERE user_id = ?", [USER])).length, 3);
  });
});

describe("l'œuf (/api/me/eggs)", () => {
  const lay = (body) => call("POST", "/api/me/eggs", { body });

  it("deux parents de la famille pondent un œuf, que /api/me et /api/me/egg retrouvent", async () => {
    const father = await own("Pikachu", { sex: "M" });
    const mother = await own("Pikachu", { sex: "F", obtained: 2 });
    const result = await lay({ parent1: { pokemonId: father }, parent2: { pokemonId: mother } });
    assert.equal(result.egg.speciesId, species("Pichu").id);
    assert.equal(result.egg.fatherSpeciesId, species("Pikachu").id);
    assert.equal(result.egg.motherSpeciesId, species("Pikachu").id);
    assert.equal(result.egg.shinyFactor, 1);
    assert.equal(result.egg.charmFactor, 1);
    assert.equal((await call("GET", "/api/me/egg")).egg.id, result.egg.id);
    assert.equal((await call("GET", "/api/me")).egg.id, result.egg.id);
    const parents = await dbAll(points, "SELECT sterile FROM pokemon_owned ORDER BY id");
    assert.deepEqual(parents.map((row) => row.sterile), [1, 1], "chaque Pokémon ne pond qu'une fois");
  });

  it("un seul œuf à la fois", async () => {
    const [m1, m2] = [await own("Pikachu", { sex: "M" }), await own("Pikachu", { sex: "M", obtained: 2 })];
    const [f1, f2] = [await own("Pikachu", { sex: "F", obtained: 3 }), await own("Pikachu", { sex: "F", obtained: 4 })];
    await lay({ parent1: { pokemonId: m1 }, parent2: { pokemonId: f1 } });
    const second = await failure(lay({ parent1: { pokemonId: m2 }, parent2: { pokemonId: f2 } }), 409);
    assert.match(second.message, /Tu couves déjà un œuf/);
  });

  it("deux mâles ne pondent pas", async () => {
    const a = await own("Pikachu", { sex: "M" });
    const b = await own("Pikachu", { sex: "M", obtained: 2 });
    await failure(lay({ parent1: { pokemonId: a }, parent2: { pokemonId: b } }), 409);
    assert.equal((await dbAll(points, "SELECT * FROM pokemon_eggs")).length, 0);
  });

  it("les parents sont validés et doivent être à soi", async () => {
    const mine = await own("Pikachu", { sex: "F" });
    const stranger = await own("Pikachu", { user: OTHER, sex: "M" });
    await failure(lay({}), 400);
    await failure(lay({ parent1: { pokemonId: mine } }), 400);
    await failure(lay({ parent1: { pokemonId: mine }, parent2: { pokemonId: stranger } }), 404);
    await failure(lay({ parent1: { pokemonId: mine }, parent2: { pokemonId: -1 } }), 400);
  });
});

describe("l'apparition (/api/spawn)", () => {
  const spawn = () => call("GET", "/api/spawn");

  it("sans apparition : rien, ni dernière partie, ni objet au sol", async () => {
    await setBalance(100);
    const result = await spawn();
    assert.equal(result.spawn, null);
    assert.equal(result.last, null);
    assert.deepEqual(result.drops, []);
    assert.equal(result.wallet.balance, 100);
    assert.equal(result.pausedUntil, null);
    assert.ok(result.refreshSeconds >= 1);
    assert.equal(result.cooldownSeconds, getPokemonConfig().capture.throwCooldownSeconds);
  });

  it("une apparition en cours : espèce, chances par ball, ce qu'on en possède — et pas l'objet qu'elle tient", async () => {
    await spawnRow("Roucool", { heldItem: "pepite" });
    await own("Roucool");
    await setBalance(250);
    const result = await spawn();
    const json = result.spawn;
    assert.equal(json.speciesId, species("Roucool").id);
    assert.equal(json.rarity, "COMMUN");
    assert.deepEqual(json.owned, { normal: 1, shiny: 0 });
    assert.ok(json.lineage.length >= 2);
    assert.ok(json.balls.every((ball) => ball.probability > 0 && ball.probability <= 1));
    assert.equal(JSON.stringify(result).includes("pepite"), false, "l'objet tenu reste secret jusqu'à la fin");
  });

  it("une ball est utilisable si on la possède ou si le solde la paie", async () => {
    await spawnRow("Roucool");
    await setBalance(150);
    await grant("ball_super", 1);
    const byKey = Object.fromEntries((await spawn()).spawn.balls.map((ball) => [ball.key, ball]));
    const prices = getBalls().map((ball) => [ball.key, ball.price]);
    for (const [key, price] of prices) {
      const expected = key === "super" || price <= 150;
      assert.equal(byKey[key].usable, expected, `${key} à ${price} avec 150 points`);
    }
    assert.equal(byKey.super.free, 1);
  });

  it("un légendaire affiche son taux relevé et sa difficulté figée", async () => {
    await spawnRow("Mewtwo");
    const json = (await spawn()).spawn;
    assert.equal(json.rarity, "LEGENDAIRE");
    assert.deepEqual(json.difficulty, data.difficultyOf(species("Mewtwo").catchRate));
  });

  it("une apparition terminée devient « dernière partie », avec son vainqueur", async () => {
    const id = await spawnRow("Roucool");
    await dbRun(points, "UPDATE pokemon_spawns SET status = 'CAUGHT', caught_by = ?, caught_ball = 'poke', ended_at = ? WHERE id = ?", [OTHER, Date.now(), id]);
    const result = await spawn();
    assert.equal(result.spawn, null);
    assert.equal(result.last.status, "CAUGHT");
    assert.equal(result.last.caughtBy.name, `Dresseur ${OTHER}`);
    assert.equal(result.last.ball, "poke");
  });

  it("un membre parti du serveur garde son identifiant, sans nom", async () => {
    const id = await spawnRow("Roucool");
    await dbRun(points, "UPDATE pokemon_spawns SET status = 'CAUGHT', caught_by = '99999', ended_at = ? WHERE id = ?", [Date.now(), id]);
    assert.deepEqual((await spawn()).last.caughtBy, { id: "99999", name: null, avatar: null });
  });

  it("la pause du parc est annoncée tant qu'elle dure", async () => {
    const until = Date.now() + 3600_000;
    await dbRun(points, "UPDATE pokemon_state SET spawn_paused_until = ? WHERE id = 1", [until]);
    assert.equal((await spawn()).pausedUntil, until);
    await dbRun(points, "UPDATE pokemon_state SET spawn_paused_until = ? WHERE id = 1", [Date.now() - 1000]);
    assert.equal((await spawn()).pausedUntil, null);
  });

  it("les objets au sol : ramassable sauf pour celui qui a capturé", async () => {
    const id = await spawnRow("Roucool");
    await dbRun(points, "UPDATE pokemon_spawns SET status = 'CAUGHT', caught_by = ?, ended_at = ? WHERE id = ?", [USER, Date.now(), id]);
    await dbRun(points, "INSERT INTO pokemon_drops (spawn_id, item_key, status, dropped_at, channel_id, message_id) VALUES (?, 'pepite', 'OPEN', ?, '123', 'm9')", [id, Date.now()]);
    const [drop] = (await spawn()).drops;
    assert.equal(drop.itemKey, "pepite");
    assert.equal(drop.claimable, false, "ce qu'un Pokémon capturé lâche n'est pas pour son capteur");
    await dbRun(points, "UPDATE pokemon_spawns SET caught_by = ? WHERE id = ?", [OTHER, id]);
    assert.equal((await spawn()).drops[0].claimable, true);
  });
});

describe("un lancer (/api/spawn/throw)", () => {
  const throwBall = (body, user) => call("POST", "/api/spawn/throw", { body, user });
  let counter = 0;
  const trainer = () => ({ id: `2${String(++counter).padStart(4, "0")}` });

  it("le corps de la requête est validé", async () => {
    await failure(throwBall({}), 400);
    await failure(throwBall({ spawnId: 0, ball: "poke" }), 400);
    await failure(throwBall({ spawnId: 1.5, ball: "poke" }), 400);
    await failure(throwBall({ spawnId: 1 }), 400);
    await failure(throwBall({ spawnId: 1, ball: 7 }), 400);
  });

  it("une ball inconnue est une issue du jeu, pas une erreur : 200", async () => {
    const result = await throwBall({ spawnId: 1, ball: "ball-magique" }, trainer());
    assert.equal(result.status, "unknown-ball");
    assert.equal(result.final, false);
    assert.equal(result.pokemon, null);
  });

  it("un Pokémon parti ne coûte rien", async () => {
    const user = trainer();
    await setBalance(1000, user.id);
    const result = await throwBall({ spawnId: 424242, ball: "poke" }, user);
    assert.equal(result.status, "gone");
    assert.match(result.message, /n'est plus là/);
    assert.equal(await callback(economy.getBalance, user.id), 1000);
  });

  it("sans assez de points : « insufficient », rien n'est débité", async () => {
    const user = trainer();
    const id = await spawnRow("Roucool");
    await setBalance(1, user.id);
    const result = await throwBall({ spawnId: id, ball: "poke" }, user);
    assert.equal(result.status, "insufficient");
    assert.equal(await callback(economy.getBalance, user.id), 1);
  });

  it("une capture rend le Pokémon, et le lancer est final", async () => {
    const user = trainer();
    const id = await spawnRow("Roucool");
    await setBalance(1000, user.id);
    const result = await withRandom(0, () => throwBall({ spawnId: id, ball: "poke" }, user));
    await sleep(100);
    assert.equal(result.status, "catch");
    assert.equal(result.final, true);
    assert.equal(result.pokemon.shiny, false);
    assert.ok(result.pokemon.id > 0);
    assert.ok(["M", "F", null].includes(result.pokemon.sex));
    const owned = await dbGet(points, "SELECT user_id, species_id FROM pokemon_owned WHERE id = ?", [result.pokemon.id]);
    assert.deepEqual(owned, { user_id: user.id, species_id: species("Roucool").id });
  });

  it("un raté dit combien de lancers restent, et ne rend aucun Pokémon", async () => {
    const user = trainer();
    const id = await spawnRow("Mewtwo");
    await setBalance(1000, user.id);
    const result = await withRandom(0.999, () => throwBall({ spawnId: id, ball: "poke" }, user));
    assert.equal(result.status, "miss");
    assert.equal(result.final, false);
    assert.equal(result.pokemon, null);
  });

  it("le cooldown s'applique au site comme aux boutons : un second lancer trop tôt attend", async () => {
    const user = trainer();
    const id = await spawnRow("Mewtwo");
    await setBalance(1000, user.id);
    await withRandom(0.999, () => throwBall({ spawnId: id, ball: "poke" }, user));
    const quick = await throwBall({ spawnId: id, ball: "poke" }, user);
    assert.equal(quick.status, "cooldown");
    assert.ok(quick.remaining >= 1);
    assert.match(quick.message, /Doucement/);
  });

  it("la Master Ball sans l'objet quand le site la dit offerte : refus, jamais payée en points", async () => {
    const user = trainer();
    const id = await spawnRow("Roucool");
    await setBalance(100000, user.id);
    const result = await throwBall({ spawnId: id, ball: "master", requireItem: true }, user);
    assert.equal(result.status, "no-item");
    assert.equal(await callback(economy.getBalance, user.id), 100000);
  });
});

describe("ramasser un objet au sol (/api/drops/:id/claim)", () => {
  const claim = (dropId, user = { id: USER }) => call("POST", "/api/drops/:dropId/claim", { params: { dropId: String(dropId) }, user });
  async function drop(captor = OTHER) {
    const spawnId = await spawnRow("Roucool");
    await dbRun(points, "UPDATE pokemon_spawns SET status = 'CAUGHT', caught_by = ?, ended_at = ? WHERE id = ?", [captor, Date.now(), spawnId]);
    const { lastID } = await dbRun(points, "INSERT INTO pokemon_drops (spawn_id, item_key, status, dropped_at, channel_id, message_id) VALUES (?, 'pepite', 'OPEN', ?, '123', 'm9')", [spawnId, Date.now()]);
    return lastID;
  }

  it("un identifiant invalide est refusé", async () => {
    for (const dropId of ["abc", "0", "-3", "1.5"]) await failure(claim(dropId), 400);
  });

  it("le premier le prend, l'objet entre dans son sac, le message du salon est mis à jour", async () => {
    const id = await drop();
    const result = await claim(id);
    assert.equal(result.item.key, "pepite");
    assert.ok(result.item.label);
    assert.equal(await callback(items.getItemCount, USER, "pepite"), 1);
    await sleep(100);
    assert.ok(channelEdits.some((edit) => edit.id === "m9"), "le bouton du salon est retiré");
  });

  it("le second arrive trop tard : 409, rien n'est créé en plus", async () => {
    const id = await drop();
    await claim(id);
    await failure(claim(id, { id: OTHER }), 409);
    assert.equal(await callback(items.getItemCount, OTHER, "pepite"), 0);
    assert.equal(await callback(items.getItemCount, USER, "pepite"), 1);
  });

  it("celui qui a capturé le Pokémon est refusé pour de bon : 403", async () => {
    const id = await drop(USER);
    await failure(claim(id), 403);
    assert.equal(await callback(items.getItemCount, USER, "pepite"), 0);
    assert.equal((await claim(id, { id: OTHER })).item.key, "pepite", "il reste ramassable par les autres");
  });
});

describe("vendre un Pokémon (/api/me/sell)", () => {
  it("le corps est validé, le Pokémon d'un autre est introuvable", async () => {
    await failure(call("POST", "/api/me/sell", { body: {} }), 400);
    await failure(call("POST", "/api/me/sell", { body: { pokemonId: "x" } }), 400);
    const stranger = await own("Rattata", { user: OTHER });
    await failure(call("POST", "/api/me/sell", { body: { pokemonId: stranger } }), 404);
  });

  it("un groupe se vend par quantité, et le dernier de l'espèce reste", async () => {
    await ownMany("Rattata", 3);
    const result = await call("POST", "/api/me/sell", { body: { speciesId: species("Rattata").id, isShiny: false, quantity: 2 } });
    assert.equal(result.sold, 2);
    assert.equal(await callback(economy.getBalance, USER), result.points);
    await failure(call("POST", "/api/me/sell", { body: { speciesId: species("Rattata").id, isShiny: false, quantity: 1 } }), 409);
    assert.equal((await dbAll(points, "SELECT id FROM pokemon_owned WHERE user_id = ?", [USER])).length, 1);
  });
});

describe("le PC (/api/me/pc)", () => {
  const pcMove = (body) => call("POST", "/api/me/pc/move", { body });

  it("rend les boîtes et la place de chacun, en rangeant les nouveaux arrivants", async () => {
    await ownMany("Rattata", 3);
    const pc = await call("GET", "/api/me/pc");
    assert.equal(pc.slotsPerBox, 30);
    assert.equal(pc.maxBoxes, 60);
    assert.ok(pc.boxes.length >= 8);
    assert.deepEqual(pc.pokemon.map((entry) => entry.pos).sort(), [0, 1, 2]);
  });

  it("déplace un Pokémon, et rend le PC relu", async () => {
    const [id] = await ownMany("Rattata", 1, { pos: 0 });
    const pc = await pcMove({ pokemonId: id, pos: 31 });
    assert.equal(pc.pokemon.find((entry) => entry.id === id).pos, 31);
    assert.ok(pc.boxes.length >= 3, "une boîte vide s'ajoute au bout");
  });

  it("valide le déplacement, refuse une case inexistante (409) et le Pokémon d'un autre (409)", async () => {
    const [id] = await ownMany("Rattata", 1, { pos: 0 });
    const stranger = await own("Rattata", { user: OTHER, pos: 0 });
    await failure(pcMove({}), 400);
    await failure(pcMove({ pokemonId: id, pos: "x" }), 400);
    await failure(pcMove({ pokemonId: 1.5, pos: 1 }), 400);
    await failure(pcMove({ pokemonId: id, pos: 99999 }), 409);
    await failure(pcMove({ pokemonId: stranger, pos: 5 }), 409);
  });

  it("nomme une boîte, un nom vide rend le nom par défaut, une boîte inexistante est refusée", async () => {
    const name = (box, text) => call("POST", "/api/me/pc/boxes/:box/name", { params: { box: String(box) }, body: { name: text } });
    assert.deepEqual(await name(0, "  Équipe "), { name: "Équipe", custom: true });
    assert.deepEqual(await name(0, ""), { name: "Boîte 1", custom: false });
    await failure(name(999, "x"), 409);
    await failure(name("abc", "x"), 409);
  });

  it("donne un surnom, et refuse celui d'un autre", async () => {
    const [id] = await ownMany("Rattata", 1);
    const stranger = await own("Rattata", { user: OTHER });
    const nickname = (pokemonId, text) => call("POST", "/api/me/pokemon/:pokemonId/nickname", { params: { pokemonId: String(pokemonId) }, body: { nickname: text } });
    assert.deepEqual(await nickname(id, "Ratou"), { nickname: "Ratou" });
    assert.deepEqual(await nickname(id, ""), { nickname: null });
    await failure(nickname(stranger, "Volé"), 409);
  });

  it("verrouille et déverrouille, comme /pk verrou", async () => {
    const [id] = await ownMany("Rattata", 1);
    const stranger = await own("Rattata", { user: OTHER });
    const lock = (pokemonId, body) => call("POST", "/api/me/pokemon/:pokemonId/lock", { params: { pokemonId: String(pokemonId) }, body });
    assert.deepEqual(await lock(id, { locked: true }), { id, locked: true });
    assert.equal((await dbGet(points, "SELECT locked FROM pokemon_owned WHERE id = ?", [id])).locked, 1);
    assert.deepEqual(await lock(id, { locked: false }), { id, locked: false });
    await failure(lock(id, {}), 400);
    await failure(lock(id, { locked: "oui" }), 400);
    await failure(lock("abc", { locked: true }), 400);
    await failure(lock(stranger, { locked: true }), 404);
    assert.equal((await dbGet(points, "SELECT locked FROM pokemon_owned WHERE id = ?", [stranger])).locked, 0);
  });
});

describe("la vitrine (/api/me/showcase)", () => {
  const show = (body) => call("POST", "/api/me/showcase", { body });
  const order = (body) => call("POST", "/api/me/showcase/order", { body });

  it("expose, à la place demandée, puis retire", async () => {
    const [a, b, c] = await ownMany("Rattata", 3);
    await show({ pokemonId: a, shown: true });
    await show({ pokemonId: b, shown: true });
    const third = await show({ pokemonId: c, shown: true, place: 1 });
    assert.deepEqual(third.pokemon.map((entry) => entry.id), [c, a, b]);
    assert.equal(third.mine, true);
    assert.equal(third.slots, getPokemonConfig().showcase.slots);
    const removed = await show({ pokemonId: a, shown: false });
    assert.deepEqual(removed.pokemon.map((entry) => entry.id), [c, b]);
  });

  it("valide la demande, et refuse avec le motif du jeu", async () => {
    const [a] = await ownMany("Rattata", 1);
    const stranger = await own("Rattata", { user: OTHER });
    await failure(show({}), 400);
    await failure(show({ pokemonId: a }), 400);
    await failure(show({ pokemonId: a, shown: "oui" }), 400);
    await failure(show({ pokemonId: a, shown: true, place: 0 }), 400);
    await failure(show({ pokemonId: a, shown: true, place: "x" }), 400);
    await failure(show({ pokemonId: -1, shown: true }), 400);
    await failure(show({ pokemonId: stranger, shown: true }), 409);
    await failure(show({ pokemonId: a, shown: false }), 409);
    await show({ pokemonId: a, shown: true });
    const twice = await failure(show({ pokemonId: a, shown: true }), 409);
    assert.match(twice.message, /déjà dans ta vitrine/);
  });

  it("une vitrine pleine refuse", async () => {
    sandbox.writeConfig({ pokemon: { generation: 2, showcase: { slots: 1 } } });
    const [a, b] = await ownMany("Rattata", 2);
    await show({ pokemonId: a, shown: true });
    const full = await failure(show({ pokemonId: b, shown: true }), 409);
    assert.match(full.message, /vitrine est pleine \(1\/1\)/);
    sandbox.writeConfig({ pokemon: { generation: 2 } });
  });

  it("range la vitrine dans l'ordre donné, ou refuse un ordre invalide", async () => {
    const [a, b, c] = await ownMany("Rattata", 3);
    for (const id of [a, b, c]) await show({ pokemonId: id, shown: true });
    const result = await order({ order: [c, b, a] });
    assert.deepEqual(result.pokemon.map((entry) => entry.id), [c, b, a]);
    await failure(order({}), 400);
    await failure(order({ order: [] }), 400);
    await failure(order({ order: "1,2" }), 400);
    await failure(order({ order: [1, "x"] }), 400);
    await failure(order({ order: [0] }), 400);
    await failure(order({ order: Array.from({ length: 7 }, (_, index) => index + 1) }), 400);
  });

  it("la vitrine d'un autre se lit, avec son dresseur", async () => {
    const stranger = await own("Rattata", { user: OTHER });
    await dbRun(points, "UPDATE pokemon_owned SET showcase_pos = 1 WHERE id = ?", [stranger]);
    const result = await call("GET", "/api/users/:userId/showcase", { params: { userId: OTHER } });
    assert.equal(result.mine, false);
    assert.equal(result.trainer.name, `Dresseur ${OTHER}`);
    assert.deepEqual(result.pokemon.map((entry) => entry.id), [stranger]);
  });
});

describe("les dresseurs (/api/trainers)", () => {
  it("classés par Pokédex, shiny puis total, avec leur vitrine ; un membre parti n'y figure plus", async () => {
    await own("Rattata", { user: "30001" });
    await own("Roucool", { user: "30001", obtained: 2 });
    await own("Rattata", { user: "30002" });
    await own("Rattata", { user: "30002", shiny: 1, obtained: 2 });
    await own("Rattata", { user: "99999" });
    const shown = await own("Rattata", { user: "30003" });
    await dbRun(points, "UPDATE pokemon_owned SET showcase_pos = 1 WHERE id = ?", [shown]);
    const result = await call("GET", "/api/trainers");
    assert.equal(result.dexSize, data.dexSize());
    assert.deepEqual(result.trainers.map((trainer) => trainer.id), ["30001", "30002", "30003"]);
    assert.deepEqual(result.trainers.map((trainer) => [trainer.species, trainer.shinies, trainer.total, trainer.showcase]), [
      [2, 0, 2, 0],
      [1, 1, 2, 0],
      [1, 0, 1, 1],
    ]);
    assert.ok(result.trainers[0].avatar.includes("30001"));
  });
});

describe("la lignée et les référentiels restants", () => {
  it("la lignée d'une espèce inconnue ou fermée est introuvable", async () => {
    await failure(call("GET", "/api/me/lineage/:speciesId", { params: { speciesId: "99999" } }), 404);
  });

  it("les formes de Zarbi se lisent avec celles qu'on possède", async () => {
    const unown = species("Zarbi");
    await dbRun(points, "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at, form) VALUES (?, ?, 0, NULL, 'test', 1, 'b')", [USER, unown.id]);
    const { forms } = await call("GET", "/api/me/lineage/:speciesId", { params: { speciesId: String(unown.id) } });
    assert.equal(forms.length, 26);
    assert.deepEqual(forms.filter((form) => form.owned).map((form) => form.key), ["b"]);
    const plain = await call("GET", "/api/me/lineage/:speciesId", { params: { speciesId: String(species("Rattata").id) } });
    assert.equal(plain.forms, null);
  });

  it("l'inventaire d'un dresseur porte le prix de revente", async () => {
    await grant("super_bonbon", 2);
    const { items: list } = await call("GET", "/api/users/:userId/inventory", { params: { userId: "me" } });
    assert.equal(list.find((item) => item.key === "super_bonbon").sellValue, 300);
  });
});

describe("le parc safari (/api/safari/*)", () => {
  it("sans visite : l'offre, et pas de visite", async () => {
    await setBalance(100000);
    const result = await call("GET", "/api/safari");
    assert.equal(result.visit, null);
    assert.equal(typeof result.offer.enabled, "boolean");
    assert.equal(result.offer.session, null);
    assert.ok(result.offer.generations.length >= 2, "avec la génération 2 ouverte, on peut cibler");
  });

  it("entrer, acheter et agir valident leurs entrées", async () => {
    const enter = (body) => call("POST", "/api/safari/enter", { body });
    const buy = (body) => call("POST", "/api/safari/buy", { body });
    const act = (body) => call("POST", "/api/safari/action", { body });
    const share = (body) => call("POST", "/api/safari/share", { body });
    await failure(enter({}), 400);
    await failure(enter({ parkId: -1 }), 400);
    await failure(enter({ parkId: 1.5 }), 400);
    await failure(buy({ generations: "1" }), 400);
    await failure(buy({ generations: Array.from({ length: 30 }, () => 1) }), 400);
    await failure(buy({ generations: [1, "x"] }), 400);
    await failure(act({}), 400);
    await failure(act({ sessionId: 1, token: 5, action: "TRICHER" }), 400);
    await failure(act({ sessionId: "x", token: 5, action: "BALL" }), 400);
    await failure(share({}), 400);
    await failure(share({ sessionId: 0 }), 400);
  });

  it("acheter sans assez de points : 409 qui dit combien", async () => {
    await setBalance(1);
    const refused = await failure(call("POST", "/api/safari/buy", { body: {} }), 409);
    assert.match(refused.message, /\d/);
  });

  it("acheter une entrée ouvre la visite, qui se relit ensuite", async () => {
    await setBalance(100000);
    const bought = await call("POST", "/api/safari/buy", { body: { generations: [1] } });
    assert.equal(bought.resumed, false);
    assert.equal(bought.visit.finished, false);
    assert.equal(bought.visit.encounter.speciesId > 0, true);
    assert.equal(data.getSpecies(bought.visit.encounter.speciesId).generation, 1, "la génération visée est respectée");
    const again = await call("GET", "/api/safari");
    assert.equal(again.visit.id, bought.visit.id);
    const resumed = await call("POST", "/api/safari/buy", { body: {} });
    assert.equal(resumed.resumed, true, "une visite en cours se reprend sans repayer");
  });
});

describe("l'administration (/api/admin/points)", () => {
  it("la courbe des soldes, avec les pseudos du serveur", async () => {
    await setBalance(500, "30001");
    await setBalance(900, "30002");
    const result = await route("GET", "/api/admin/points").handler(ctx({ query: {} }));
    assert.deepEqual(result.trainers.map((trainer) => trainer.id), ["30002", "30001"]);
    assert.equal(result.trainers[0].balance, 900);
    assert.equal(result.trainers[0].values.length, result.times.length);
    assert.ok(result.from <= result.to);
  });

  it("`days` borne la période, une valeur absurde est ignorée", async () => {
    await setBalance(500, "30001");
    const bounded = await route("GET", "/api/admin/points").handler(ctx({ query: { days: "7" } }));
    assert.ok(bounded.to - bounded.from <= 7 * 24 * 3600 * 1000 + 1000);
    const garbage = await route("GET", "/api/admin/points").handler(ctx({ query: { days: "n'importe quoi" } }));
    assert.ok(garbage.trainers.length === 1);
  });

  it("les routes d'administration se déclarent protégées, les écritures aussi", () => {
    for (const entry of routes.filter((candidate) => candidate.path.startsWith("/api/admin/"))) {
      assert.equal(entry.admin, true, `${entry.method} ${entry.path}`);
      assert.equal(entry.auth, true);
    }
    for (const entry of routes.filter((candidate) => candidate.method === "POST")) {
      assert.equal(entry.write, true, `${entry.path} : une écriture se déclare`);
      assert.equal(entry.auth, true, `${entry.path} : une écriture exige une connexion`);
    }
  });
});
