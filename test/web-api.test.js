// L'API du site : les routes appelées directement, avec un contexte factice. Le
// site et Discord passent par les mêmes fonctions du jeu, donc ces tests vérifient
// surtout que la route ne s'écarte pas de la commande qu'elle double.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, withRandom, speciesByName } from "./helpers.js";

const sandbox = createSandbox({
  config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } },
});
const { points } = await openDatabases();
const { routes, HttpError } = await import("../modules/web/api.js");
const data = await import("../modules/pokemon/data.js");
const items = await import("../modules/pokemon/items.js");
const economy = await import("../modules/economy.js");

const species = (name) => speciesByName(data.allSpecies, name);
const route = (method, path) => {
  const found = routes.find((entry) => entry.method === method && entry.path === path);
  assert.ok(found, `${method} ${path} n'existe pas`);
  return found;
};
const ctx = ({ body = {}, params = {}, query = {}, user = { id: "u1" } } = {}) => ({
  user,
  body,
  params,
  query,
  bot: null,
});
const call = (method, path, options) => route(method, path).handler(ctx(options));
const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpError, `HttpError attendue, reçu : ${error?.stack ?? error}`);
    return error;
  }
  assert.fail("une HttpError était attendue");
};
const callback = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value))));
const grant = (key, quantity) => callback((...a) => items.grantItem("u1", key, quantity, { source: "test" }, a.at(-1)));
const balance = () => callback((...a) => economy.getBalance("u1", a.at(-1)));
const own = (name, { shiny = 0, count = 1 } = {}) =>
  Promise.all(
    Array.from({ length: count }, (_, index) =>
      dbRun(
        points,
        "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at) VALUES ('u1', ?, ?, 'M', 'test', ?)",
        [species(name).id, shiny, index + 1]
      )
    )
  );

beforeEach(async () => {
  for (const table of ["points", "pokemon_owned", "pokemon_inventory", "pokemon_item_log", "pokemon_sales", "pokemon_safari_sessions", "points_log"]) {
    await dbRun(points, `DELETE FROM ${table}`);
  }
});

describe("référentiels", () => {
  it("la santé dit la génération jouable", async () => {
    assert.deepEqual(await call("GET", "/api/health"), { ok: true, generation: 1 });
  });

  it("la liste des espèces ne contient que la génération ouverte", async () => {
    const { generation, species: list } = await call("GET", "/api/species");
    assert.equal(generation, 1);
    assert.equal(list.length, 151);
    assert.ok(list.every((entry) => entry.generation === 1));
  });

  it("annonce le taux de capture EFFECTIF : un légendaire à taux 3 s'affiche à 10", async () => {
    const { species: list } = await call("GET", "/api/species");
    const by = (name) => list.find((entry) => entry.name === name);
    assert.equal(by("Mewtwo").catchRate, 10);
    assert.equal(by("Artikodin").catchRate, 10);
    assert.equal(by("Mew").catchRate, 45, "Mew n'est pas relevé");
    assert.equal(by("Roucool").catchRate, species("Roucool").catchRate);
    assert.equal(by("Mewtwo").legendary, true);
    assert.equal(by("Mewtwo").rarity, "LEGENDAIRE");
  });

  it("donne le prix de revente d'une espèce, 0 quand elle ne se revend pas", async () => {
    const { species: list } = await call("GET", "/api/species");
    const by = (name) => list.find((entry) => entry.name === name);
    assert.ok(by("Roucool").sellValue > 0);
    assert.equal(by("Roucool").sellValueShiny, 0);
    assert.equal(by("Mewtwo").sellValue, 0);
  });

  it("une fiche d'espèce porte sa lignée ; une espèce fermée ou inconnue est introuvable", async () => {
    const card = await call("GET", "/api/species/:speciesId", { params: { speciesId: String(species("Herbizarre").id) } });
    assert.deepEqual(card.chain, [1, 2, 3]);
    assert.equal(card.evolvesFrom, 1);
    assert.deepEqual(card.evolvesInto, [3]);
    assert.equal((await failure(call("GET", "/api/species/:speciesId", { params: { speciesId: "250" } }))).status, 404);
    assert.equal((await failure(call("GET", "/api/species/:speciesId", { params: { speciesId: "abc" } }))).status, 404);
  });

  it("le catalogue nomme les balls (Safari Ball comprise) et les objets", async () => {
    const catalogue = await call("GET", "/api/catalogue");
    assert.deepEqual(
      catalogue.balls.map((ball) => ball.key),
      ["poke", "super", "hyper", "master", "safari"]
    );
    assert.ok(catalogue.items.some((item) => item.key === "super_bonbon"));
  });

  it("les règles en chiffres portent la durée de vie des légendaires et le plancher", async () => {
    const rules = await call("GET", "/api/rules");
    assert.ok(rules.spawn.legendaryFleeMultiplier >= 1);
    assert.ok(rules.spawn.fleeMinutes.min > 0);
    assert.ok(rules.capture.table.length > 0);
    const hardest = rules.capture.table.at(-1);
    assert.ok(hardest.balls.every((ball) => ball.min >= 0 && ball.max <= 1));
  });

  it("les règles disent de combien la Master Ball renchérit, et elle seule", async () => {
    const { balls } = (await call("GET", "/api/rules")).capture;
    const growth = Object.fromEntries(balls.map((ball) => [ball.key, ball.priceGrowth]));
    assert.deepEqual(growth, { poke: null, super: null, hyper: null, master: 1.2 });
  });
});

describe("sac : le prix de revente et la vente", () => {
  it("l'inventaire donne le prix à l'unité, null pour ce qui ne se revend pas", async () => {
    await grant("super_bonbon", 3);
    await grant("ball_master", 1);
    await grant("pepite", 2);
    const { items: rows } = await call("GET", "/api/users/:userId/inventory", { params: { userId: "me" } });
    const by = (key) => rows.find((row) => row.key === key);
    assert.equal(by("super_bonbon").sellValue, 300);
    assert.equal(by("pepite").sellValue, items.itemSellValue(items.getItem("pepite")));
    assert.equal(by("ball_master").sellValue, null);
    assert.equal(by("super_bonbon").count, 3);
  });

  it("l'inventaire suit l'ordre du catalogue", async () => {
    await grant("ball_master", 1);
    await grant("ball_poke", 1);
    const { items: rows } = await call("GET", "/api/users/:userId/inventory", { params: { userId: "me" } });
    assert.deepEqual(rows.map((row) => row.key), ["ball_poke", "ball_master"]);
  });

  it("l'inventaire d'un autre dresseur se lit par son identifiant, un identifiant invalide est refusé", async () => {
    assert.deepEqual(await call("GET", "/api/users/:userId/inventory", { params: { userId: "123456789012345678" } }), { items: [] });
    assert.equal((await failure(call("GET", "/api/users/:userId/inventory", { params: { userId: "abc" } }))).status, 400);
  });

  it("vend des objets : { sold, unit, points }, comme /pk revendre objet", async () => {
    await grant("super_bonbon", 3);
    const result = await call("POST", "/api/me/sell-item", { body: { key: "super_bonbon", quantity: 2 } });
    assert.deepEqual(result, { sold: 2, unit: 300, points: 600 });
    assert.equal(await balance(), 600);
    const { items: rows } = await call("GET", "/api/users/:userId/inventory", { params: { userId: "me" } });
    assert.equal(rows.find((row) => row.key === "super_bonbon").count, 1);
  });

  it("vend un seul exemplaire par défaut", async () => {
    await grant("super_bonbon", 3);
    assert.equal((await call("POST", "/api/me/sell-item", { body: { key: "super_bonbon" } })).sold, 1);
  });

  it("une quantité illisible vaut 1, une quantité nulle ou négative aussi : jamais 0", async () => {
    await grant("super_bonbon", 5);
    for (const quantity of ["abc", 0, -4, undefined]) {
      const result = await call("POST", "/api/me/sell-item", { body: { key: "super_bonbon", quantity } });
      assert.equal(result.sold, 1, `quantité ${quantity}`);
    }
    assert.equal(await balance(), 4 * 300);
  });

  it("répond 400 sans objet, 409 quand le jeu refuse", async () => {
    await grant("ball_master", 1);
    assert.equal((await failure(call("POST", "/api/me/sell-item", { body: {} }))).status, 400);
    assert.equal((await failure(call("POST", "/api/me/sell-item", { body: { key: 42 } }))).status, 400);
    const unsellable = await failure(call("POST", "/api/me/sell-item", { body: { key: "ball_master" } }));
    assert.equal(unsellable.status, 409);
    assert.match(unsellable.message, /ne se revend pas/);
    const unknown = await failure(call("POST", "/api/me/sell-item", { body: { key: "nimportequoi" } }));
    assert.equal(unknown.status, 409);
    const missing = await failure(call("POST", "/api/me/sell-item", { body: { key: "super_bonbon", quantity: 3 } }));
    assert.equal(missing.status, 409);
    assert.match(missing.message, /Tu n'as pas/);
    assert.equal(await balance(), 0);
  });

  it("la route est protégée : connexion exigée et requête d'écriture", () => {
    const sellItem = route("POST", "/api/me/sell-item");
    assert.equal(sellItem.auth, true);
    assert.equal(sellItem.write, true);
  });

  it("vend un Pokémon : le même chemin que /pk revendre pokemon", async () => {
    await own("Roucool", { count: 3 });
    const result = await call("POST", "/api/me/sell", { body: { speciesId: species("Roucool").id, isShiny: false, quantity: 2 } });
    assert.equal(result.sold, 2);
    assert.equal(await balance(), result.points);
    assert.equal((await failure(call("POST", "/api/me/sell", { body: { speciesId: species("Roucool").id, isShiny: false, quantity: 5 } }))).status, 409);
  });
});

describe("la lignée sur le site", () => {
  it("donne la lignée d'une espèce et ce que le dresseur en possède", async () => {
    await own("Herbizarre", { count: 2 });
    const { lineage } = await call("GET", "/api/me/lineage/:speciesId", { params: { speciesId: String(species("Bulbizarre").id) } });
    assert.deepEqual(lineage, [
      { speciesId: 1, stage: 1, owned: { normal: 0, shiny: 0 } },
      { speciesId: 2, stage: 2, owned: { normal: 2, shiny: 0 } },
      { speciesId: 3, stage: 3, owned: { normal: 0, shiny: 0 } },
    ]);
  });
});

describe("parc safari : la visite et sa lignée", () => {
  async function seedVisit(name, { bait = 0 } = {}) {
    await dbRun(
      points,
      `INSERT INTO pokemon_safari_sessions
         (id, user_id, status, actions_left, started_at, expires_at, encounter_no,
          encounter_species_id, encounter_is_shiny, encounter_catch_rate, encounter_bait)
       VALUES (1, 'u1', 'ACTIVE', 25, 1, ?, 1, ?, 0, ?, ?)`,
      [Date.now() + 3_600_000, species(name).id, species(name).catchRate, bait]
    );
  }

  it("la visite en cours porte la lignée de la rencontre et ce qu'on en possède", async () => {
    await seedVisit("Bulbizarre");
    await own("Herbizarre", { count: 2 });
    await own("Florizarre", { shiny: 1 });
    const { visit } = await call("GET", "/api/safari");
    assert.deepEqual(visit.encounter.lineage, [
      { speciesId: 1, stage: 1, owned: { normal: 0, shiny: 0 } },
      { speciesId: 2, stage: 2, owned: { normal: 2, shiny: 0 } },
      { speciesId: 3, stage: 3, owned: { normal: 0, shiny: 1 } },
    ]);
  });

  it("`owned` reste les compteurs de l'espèce seule", async () => {
    await seedVisit("Bulbizarre");
    await own("Bulbizarre", { count: 2 });
    await own("Herbizarre");
    const { visit } = await call("GET", "/api/safari");
    assert.deepEqual(visit.encounter.owned, { normal: 2, shiny: 0 });
  });

  it("annonce les chances et le risque de fuite de la prochaine action", async () => {
    await seedVisit("Bulbizarre", { bait: 1 });
    const { visit } = await call("GET", "/api/safari");
    const { encounter } = visit;
    assert.equal(encounter.bait, 1);
    assert.equal(encounter.baitFactor, 2);
    assert.equal(encounter.baitCapped, false);
    assert.ok(Math.abs(encounter.fleeRisk - 0.08) < 1e-9);
    assert.ok(encounter.probability > 0 && encounter.probability <= 1);
  });

  it("une action rend la visite à jour, lignée comprise", async () => {
    await seedVisit("Évoli");
    await own("Aquali");
    const result = await withRandom(0.99, () =>
      call("POST", "/api/safari/action", { body: { sessionId: 1, token: 25, action: "BAIT" } })
    );
    assert.equal(result.outcome, "BAIT");
    assert.deepEqual(
      result.visit.encounter.lineage.map((link) => link.speciesId),
      [133, 134, 135, 136]
    );
    assert.equal(result.visit.encounter.lineage.find((link) => link.speciesId === 134).owned.normal, 1);
    assert.equal(result.visit.actionsLeft, 24);
  });

  it("sans visite en cours, il n'y a pas de rencontre", async () => {
    const { visit } = await call("GET", "/api/safari");
    assert.equal(visit, null);
  });

  it("refuse une action invalide, ou une visite qui n'est pas la sienne", async () => {
    await seedVisit("Bulbizarre");
    for (const body of [{}, { sessionId: "x", token: 25, action: "BALL" }, { sessionId: 1, token: 25, action: "TELEPORT" }]) {
      assert.equal((await failure(call("POST", "/api/safari/action", { body }))).status, 400);
    }
    const stranger = await failure(
      call("POST", "/api/safari/action", { body: { sessionId: 1, token: 25, action: "BALL" }, user: { id: "intrus" } })
    );
    assert.equal(stranger.status, 409);
  });
});

describe("administration des réglages", () => {
  beforeEach(() => sandbox.removeConfig());

  it("liste l'arbre des réglages et l'état du fichier", async () => {
    const result = await call("GET", "/api/admin/config");
    assert.equal(result.status.ok, true);
    assert.ok(result.tree);
  });

  it("modifie un réglage, comme /admin config, et le jeu le lit aussitôt", async () => {
    const result = await call("POST", "/api/admin/config", { body: { path: "pokemon.capture.minCatchRate", value: 20 } });
    assert.equal(result.path, "pokemon.capture.minCatchRate");
    assert.equal(result.after, 20);
    assert.equal(data.effectiveCatchRate(3), 20);
  });

  it("refuse avec les mêmes bornes que la commande", async () => {
    const refused = await failure(call("POST", "/api/admin/config", { body: { path: "pokemon.capture.minCatchRate", value: 999 } }));
    assert.equal(refused.status, 409);
    assert.match(refused.message, /maximum/);
    assert.equal((await failure(call("POST", "/api/admin/config", { body: { path: "pokemon.inconnu", value: 1 } }))).status, 409);
    assert.equal((await failure(call("POST", "/api/admin/config", { body: { path: "pokemon.capture.minCatchRate", value: "  " } }))).status, 400);
    assert.equal((await failure(call("POST", "/api/admin/config", { body: { path: 5, value: 1 } }))).status, 400);
    assert.equal((await failure(call("POST", "/api/admin/config", { body: { path: "x", value: { a: 1 } } }))).status, 400);
  });

  it("seul un administrateur la voit : la route le déclare", () => {
    assert.equal(route("GET", "/api/admin/config").admin, true);
    assert.equal(route("POST", "/api/admin/config").admin, true);
    assert.equal(route("POST", "/api/admin/config").write, true);
  });
});
