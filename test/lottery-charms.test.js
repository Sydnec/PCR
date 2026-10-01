// La loterie quotidienne et le Charme Chroma : deux récompenses qui se
// revendiquent d'un seul coup gardé — un tirage par jour, un charme par
// génération — et qui se rendent si la suite échoue.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbAll, sleep, withRandom } from "./helpers.js";

const GEN1 = { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } };
const GEN2 = { pokemon: { generation: 2 } };
const sandbox = createSandbox({ config: GEN1 });
process.env.POKEMON_CHANNEL_ID = "123";
process.env.POKEMON_ROLE_ID = "role-pokemon";
process.env.SHINY_CHARM_ROLE_ID_1 = "role-charm-1";
process.env.SHINY_CHARM_ROLE_ID_2 = "role-charm-2";
process.env.GUILD_ID = "guild-1";
const { points } = await openDatabases();
const lottery = await import("../modules/pokemon/lottery.js");
const charms = await import("../modules/pokemon/charms.js");
const items = await import("../modules/pokemon/items.js");
const data = await import("../modules/pokemon/data.js");
const { getPokemonConfig } = await import("../modules/pokemon/config.js");

const call = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value))));
const stock = (key, user = "u1") => call(items.getItemCount, user, key);
const ticket = (user = "u1") => call(lottery.getTicket, user);

beforeEach(async () => {
  await dbRun(points, "DROP TRIGGER IF EXISTS panne");
  for (const table of ["pokemon_lottery", "pokemon_inventory", "pokemon_item_log", "pokemon_owned"]) await dbRun(points, `DELETE FROM ${table}`);
  sandbox.writeConfig(GEN1);
});

describe("le jour de la loterie", () => {
  it("se compte en UTC, comme le classement des messages", () => {
    assert.equal(lottery.lotteryDay(Date.UTC(2026, 9, 1, 23, 59, 59)), "2026-10-01");
    assert.equal(lottery.lotteryDay(Date.UTC(2026, 9, 2, 0, 0, 0)), "2026-10-02");
  });

  it("le tirage revient au prochain minuit UTC, y compris en fin de mois et d'année", () => {
    assert.equal(lottery.nextDrawAt(Date.UTC(2026, 9, 1, 13, 13)), Date.UTC(2026, 9, 2));
    assert.equal(lottery.nextDrawAt(Date.UTC(2026, 9, 31, 23, 59)), Date.UTC(2026, 10, 1));
    assert.equal(lottery.nextDrawAt(Date.UTC(2026, 11, 31, 12)), Date.UTC(2027, 0, 1));
  });
});

describe("les tirages", () => {
  const lot = { lot: { min: 1, max: 3 } };

  it("un lot d'un seul exemplaire n'est pas tiré au sort", () => {
    assert.equal(lottery.rollLot({ lot: { min: 2, max: 2 } }), 2);
    assert.equal(lottery.rollLot({}), 1, "sans fourchette, on gagne à l'unité");
  });

  it("chaque exemplaire de plus est deux fois moins probable (lotDecay 0,5)", () => {
    // Poids 1, 0,5 et 0,25 : les bornes tombent à 1/1,75 et 1,5/1,75 du tirage.
    assert.equal(withRandom(0.5, () => lottery.rollLot(lot)), 1);
    assert.equal(withRandom(0.7, () => lottery.rollLot(lot)), 2);
    assert.equal(withRandom(0.95, () => lottery.rollLot(lot)), 3);
    assert.equal(withRandom(0.9999999, () => lottery.rollLot(lot)), 3, "le dernier fait filet");
  });

  it("à 1 la décroissance disparaît : on retrouve l'uniforme, et un réglage absurde y retombe", () => {
    for (const lotDecay of [1, 0, -2, "n'importe quoi"]) {
      sandbox.writeConfig({ pokemon: { ...GEN1.pokemon, lottery: { lotDecay } } });
      assert.equal(withRandom(0.2, () => lottery.rollLot(lot)), 1);
      assert.equal(withRandom(0.5, () => lottery.rollLot(lot)), 2);
      assert.equal(withRandom(0.9, () => lottery.rollLot(lot)), 3);
    }
  });

  it("la chance de gagner suit le réglage : au-dessus, les mains vides ; en dessous, un lot", () => {
    const chance = items.lotteryWinChance();
    assert.equal(chance, getPokemonConfig().lottery.winChance);
    assert.equal(withRandom([chance + 0.001], () => lottery.rollLottery()), null);
    const prize = withRandom([0, 0, 0], () => lottery.rollLottery());
    assert.ok(prize.item.key);
    assert.ok(prize.quantity >= 1);
  });

  it("une chance nulle ne donne jamais rien, même sur le meilleur tirage", () => {
    sandbox.writeConfig({ pokemon: { ...GEN1.pokemon, lottery: { winChance: 0 } } });
    assert.equal(withRandom(0, () => lottery.rollLottery()), null);
  });

  it("le lot suit la pondération du catalogue : un objet sans poids de loterie ne sort jamais", () => {
    const outsiders = items.getItems().filter((item) => !(items.itemLotteryWeight(item) > 0));
    assert.ok(outsiders.length > 0, "le catalogue a des objets hors loterie (charme, objets d'évolution…)");
    for (const value of [0, 0.2, 0.4, 0.6, 0.8, 0.9999]) {
      const prize = withRandom([0, value, 0], () => lottery.rollLottery());
      assert.ok(items.itemLotteryWeight(prize.item) > 0, prize.item.key);
    }
  });
});

describe("jouer (play)", () => {
  const play = (user = "u1") => call(lottery.play, user);
  const win = (user) => withRandom([0, 0, 0], () => play(user));

  it("un gain entre dans le sac, compte une victoire et ferme la journée", async () => {
    const result = await win();
    assert.equal(result.ok, true);
    assert.ok(result.prize);
    assert.equal(await stock(result.prize.item.key), result.prize.quantity);
    const row = await ticket();
    assert.equal(row.draws, 1);
    await sleep(50);
    assert.equal((await ticket()).wins, 1);
    assert.equal(row.last_day, lottery.lotteryDay());
    assert.equal(result.nextAt, lottery.nextDrawAt());
  });

  it("des mains vides comptent le tirage, pas la victoire, et ne donnent rien", async () => {
    const result = await withRandom([0.999], () => play());
    assert.deepEqual({ ok: result.ok, prize: result.prize }, { ok: true, prize: null });
    const row = await ticket();
    assert.equal(row.draws, 1);
    assert.equal(row.wins, 0);
    assert.deepEqual(await dbAll(points, "SELECT * FROM pokemon_inventory"), []);
  });

  it("un seul tirage par jour : le second est refusé, avec l'heure du retour", async () => {
    await win();
    const again = await win();
    assert.equal(again.ok, false);
    assert.equal(again.played, true);
    assert.match(again.reason, /déjà tenté ta chance aujourd'hui/);
    assert.equal(again.nextAt, lottery.nextDrawAt());
    assert.equal((await ticket()).draws, 1);
  });

  it("le lendemain, le tirage revient", async () => {
    await win();
    await dbRun(points, "UPDATE pokemon_lottery SET last_day = '2000-01-01' WHERE user_id = 'u1'");
    assert.equal((await win()).ok, true);
    assert.equal((await ticket()).draws, 2);
  });

  it("chacun a son tirage", async () => {
    assert.equal((await win("u1")).ok, true);
    assert.equal((await win("u2")).ok, true);
  });

  it("dix commandes simultanées : un seul tirage, un seul lot", async () => {
    const results = await withRandom([0, 0, 0], async () => Promise.all(Array.from({ length: 10 }, () => play())));
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => result.played).length, 9);
    assert.equal((await ticket()).draws, 1);
    const [granted] = await dbAll(points, "SELECT SUM(count) AS total FROM pokemon_inventory WHERE user_id = 'u1'");
    const winner = results.find((result) => result.ok);
    assert.equal(granted.total, winner.prize.quantity, "un seul lot a été crédité");
  });

  it("la loterie fermée ne touche à rien", async () => {
    sandbox.writeConfig({ pokemon: { ...GEN1.pokemon, lottery: { enabled: false } } });
    const result = await win();
    assert.equal(result.ok, false);
    assert.match(result.reason, /La loterie est fermée/);
    assert.equal(await ticket(), undefined, "aucune ligne n'est créée");
  });

  it("un crédit qui échoue rend le tirage : personne ne perd sa journée à cause d'une panne", async () => {
    await dbRun(points, "CREATE TRIGGER panne BEFORE INSERT ON pokemon_inventory BEGIN SELECT RAISE(ABORT, 'panne'); END");
    await assert.rejects(() => win(), /panne/);
    await dbRun(points, "DROP TRIGGER panne");
    const row = await ticket();
    assert.equal(row.draws, 0, "le compteur ne raconte pas de tirage qui n'a pas eu lieu");
    assert.equal(row.last_day, "");
    const retry = await win();
    assert.equal(retry.ok, true, "il peut retenter tout de suite");
  });
});

// ====================== CHARME CHROMA ======================

const fakeMember = ({ roles = [], failWith = null } = {}) => {
  const cache = new Set(roles);
  const log = [];
  return {
    log,
    cache,
    roles: {
      cache,
      add: async (id, reason) => {
        if (failWith) throw failWith;
        cache.add(id);
        log.push(["add", id, reason]);
      },
      remove: async (id, reason) => {
        if (failWith) throw failWith;
        cache.delete(id);
        log.push(["remove", id, reason]);
      },
    },
  };
};

const fakeDiscord = ({ members = new Map(), roleMembers = {} } = {}) => {
  const sent = [];
  const channel = { send: async (payload) => sent.push(payload) };
  return {
    sent,
    client: {
      channels: { fetch: async () => channel },
      guilds: {
        fetch: async () => ({
          members: { fetch: async (id) => (id === undefined ? members : members.get(id)) },
          roles: { fetch: async (id) => ({ members: new Map((roleMembers[id] ?? []).map((member) => [member.id, member])) }) },
        }),
      },
    },
  };
};

const ownEverySpecies = async (user, generation) => {
  for (const entry of charms.charmSpecies(generation)) {
    await dbRun(points, "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at) VALUES (?, ?, 0, 'M', 'test', 1)", [user, entry.id]);
  }
};

describe("compléter un Pokédex (checkCharms)", () => {
  it("les espèces demandées sont celles de la génération, sans légendaires ni fabuleux", () => {
    const required = charms.charmSpecies(1);
    assert.ok(required.length > 100 && required.length < 151);
    assert.ok(required.every((entry) => entry.generation === 1 && !data.isLegendary(entry)));
    assert.ok(!required.some((entry) => ["Mewtwo", "Mew", "Artikodin"].includes(entry.name)));
    assert.equal(charms.charmSpecies(2).length, 94);
  });

  it("sans client Discord, le charme se donne quand même (rien à annoncer)", async () => {
    await ownEverySpecies("u1", 1);
    const granted = await call(charms.checkCharms, "u1");
    assert.deepEqual(granted.map((charm) => charm.generation), [1]);
    assert.equal(await stock("charme_chroma_1"), 1);
  });

  it("il manque une espèce : rien n'est donné", async () => {
    await ownEverySpecies("u1", 1);
    await dbRun(points, "DELETE FROM pokemon_owned WHERE id = (SELECT MIN(id) FROM pokemon_owned)");
    assert.deepEqual(await call(charms.checkCharms, "u1"), []);
    assert.equal(await stock("charme_chroma_1"), 0);
  });

  it("un légendaire manquant ne retient pas le charme", async () => {
    await ownEverySpecies("u1", 1);
    const required = new Set(charms.charmSpecies(1).map((entry) => entry.id));
    const owned = await dbAll(points, "SELECT DISTINCT species_id FROM pokemon_owned WHERE user_id = 'u1'");
    assert.equal(owned.length, required.size, "aucun légendaire en boîte");
    assert.equal((await call(charms.checkCharms, "u1")).length, 1);
  });

  it("donné une fois pour toutes : le revérifier ne le redonne ni ne l'annonce", async () => {
    const discord = fakeDiscord();
    charms.setCharmClient(discord.client);
    await ownEverySpecies("u1", 1);
    assert.equal((await call(charms.checkCharms, "u1")).length, 1);
    assert.equal((await call(charms.checkCharms, "u1")).length, 0);
    assert.equal(await stock("charme_chroma_1"), 1);
    await sleep(50);
    assert.equal(discord.sent.length, 1, "annoncé une seule fois");
    assert.match(discord.sent[0].content, /<@u1> complète le Pokédex de la 1re génération/);
    assert.match(discord.sent[0].content, new RegExp(`${charms.charmSpecies(1).length} espèces`));
    assert.match(discord.sent[0].content, /×2/);
    assert.deepEqual(discord.sent[0].allowedMentions, { users: ["u1"] }, "seul le dresseur est mentionné");
  });

  it("deux vérifications simultanées : un seul don, une seule annonce", async () => {
    const discord = fakeDiscord();
    charms.setCharmClient(discord.client);
    await ownEverySpecies("u1", 1);
    const results = await Promise.all([call(charms.checkCharms, "u1"), call(charms.checkCharms, "u1")]);
    assert.equal(results.flat().length, 1);
    await sleep(50);
    assert.equal(discord.sent.length, 1);
    assert.equal(await stock("charme_chroma_1"), 1);
  });

  it("une génération fermée n'a pas de charme, même si ses espèces sont en boîte", async () => {
    await ownEverySpecies("u1", 1);
    await ownEverySpecies("u1", 2);
    const granted = await call(charms.checkCharms, "u1");
    assert.deepEqual(granted.map((charm) => charm.generation), [1]);
    assert.equal(await stock("charme_chroma_2"), 0);
  });

  it("la génération 2 ouverte, ses 94 espèces donnent le charme de la 2e", async () => {
    sandbox.writeConfig(GEN2);
    await ownEverySpecies("u1", 2);
    const granted = await call(charms.checkCharms, "u1");
    assert.deepEqual(granted.map((charm) => charm.generation), [2]);
    assert.equal(granted[0].count, 94);
    assert.equal(await stock("charme_chroma_2"), 1);
    assert.equal(await stock("charme_chroma_1"), 0, "chaque génération a le sien");
  });

  it("les porteurs d'un charme se lisent par génération, un compte à zéro n'en est pas un", async () => {
    await call(items.grantItem, "u1", "charme_chroma_1", 1, { source: "test" });
    await dbRun(points, "INSERT INTO pokemon_inventory (user_id, item_key, count) VALUES ('u1', 'charme_chroma_2', 0)");
    await call(items.grantItem, "u1", "ball_super", 3, { source: "test" });
    assert.deepEqual(await call(charms.getCharms, "u1"), [1]);
    assert.deepEqual(await call(charms.getCharms, "inconnu"), []);
  });

  it("le charme multiplie la chance de shiny sur sa génération seulement", () => {
    const rattata = data.allSpecies().find((entry) => entry.name === "Rattata");
    assert.equal(data.charmFactor(rattata, [1]), getPokemonConfig().shinyCharm.multiplier);
    assert.equal(data.charmFactor(rattata, [2]), 1);
    assert.equal(data.charmFactor(rattata, []), 1);
  });
});

describe("les rôles du charme (syncCharmRoles)", () => {
  const holder = () => call(items.grantItem, "u1", "charme_chroma_1", 1, { source: "test" });
  const settle = () => sleep(80);

  it("un porteur qui a le rôle Pokémon reçoit le rôle de son charme", async () => {
    await holder();
    const member = fakeMember({ roles: ["role-pokemon"] });
    charms.syncCharmRoles("u1", { member });
    await settle();
    assert.deepEqual(member.log, [["add", "role-charm-1", "Charme Chroma"]]);
  });

  it("sans le rôle Pokémon, il ne reçoit pas le ping du charme : qui ne veut pas du jeu n'a pas ceux-là", async () => {
    await holder();
    const member = fakeMember();
    charms.syncCharmRoles("u1", { member });
    await settle();
    assert.deepEqual(member.log, []);
  });

  it("sans le charme, jamais son rôle", async () => {
    const member = fakeMember({ roles: ["role-pokemon", "role-charm-1"] });
    charms.syncCharmRoles("u1", { member });
    await settle();
    assert.deepEqual(member.log, [["remove", "role-charm-1", "Pas de Charme Chroma de cette génération"]]);
  });

  it("un porteur qui quitte le rôle Pokémon perd aussi celui du charme", async () => {
    await holder();
    const member = fakeMember({ roles: ["role-charm-1"] });
    charms.syncCharmRoles("u1", { member, leftPokemonRole: true });
    await settle();
    assert.deepEqual(member.log, [["remove", "role-charm-1", "Rôle Pokémon retiré"]]);
  });

  it("un porteur sans rôle Pokémon garde le rôle qu'un modérateur lui a donné", async () => {
    await holder();
    const member = fakeMember({ roles: ["role-charm-1"] });
    charms.syncCharmRoles("u1", { member });
    await settle();
    assert.deepEqual(member.log, []);
    assert.ok(member.cache.has("role-charm-1"));
  });

  it("le membre se lit sur le serveur quand l'appelant ne l'a pas", async () => {
    await holder();
    const member = fakeMember({ roles: ["role-pokemon"] });
    charms.setCharmClient(fakeDiscord({ members: new Map([["u1", member]]) }).client);
    charms.syncCharmRoles("u1");
    await settle();
    assert.deepEqual(member.log.map(([action]) => action), ["add"]);
  });

  it("un membre parti du serveur n'est pas une erreur", async () => {
    await holder();
    const gone = Object.assign(new Error("Unknown Member"), { code: 10007 });
    const member = fakeMember({ roles: ["role-pokemon"], failWith: gone });
    charms.syncCharmRoles("u1", { member });
    await settle();
    assert.equal(member.cache.has("role-charm-1"), false);
  });

  it("une lecture de l'inventaire qui échoue ne touche à aucun rôle", async () => {
    await holder();
    const member = fakeMember({ roles: ["role-pokemon", "role-charm-1"] });
    await dbRun(points, "ALTER TABLE pokemon_inventory RENAME TO pokemon_inventory_off");
    try {
      charms.syncCharmRoles("u1", { member });
      await settle();
    } finally {
      await dbRun(points, "ALTER TABLE pokemon_inventory_off RENAME TO pokemon_inventory");
    }
    assert.deepEqual(member.log, [], "mieux vaut un rôle de trop un moment qu'un porteur privé de son ping");
  });
});

describe("le rattrapage au démarrage (repairCharms)", () => {
  it("donne le charme aux dresseurs complets d'avant sa création, et règle les rôles", async () => {
    await ownEverySpecies("u1", 1);
    const complete = fakeMember({ roles: ["role-pokemon"] });
    Object.assign(complete, { id: "u1" });
    const usurper = fakeMember({ roles: ["role-pokemon", "role-charm-1"] });
    Object.assign(usurper, { id: "u2" });
    const discord = fakeDiscord({
      members: new Map([["u1", complete], ["u2", usurper]]),
      roleMembers: { "role-charm-1": [usurper], "role-charm-2": [] },
    });

    charms.repairCharms(discord.client);
    await sleep(600);

    assert.equal(await stock("charme_chroma_1"), 1, "le charme est donné");
    assert.ok(complete.cache.has("role-charm-1"), "son porteur reçoit le rôle");
    assert.equal(usurper.cache.has("role-charm-1"), false, "qui a le rôle sans le charme le perd");
  });
});
