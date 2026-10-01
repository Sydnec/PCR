// Le pot commun : un impôt sur le capital, une fois par semaine, redistribué en
// parts égales. Sa promesse est comptable — la masse monétaire est conservée au
// point près — et sa difficulté, de ne jamais prélever deux fois.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbGet, dbAll, withRandom } from "./helpers.js";

const sandbox = createSandbox();
process.env.DEFAULT_ROLE_ID = "role-1";
process.env.GUILD_ID = "guild-1";
const { points } = await openDatabases();
const redistribution = await import("../modules/redistribution.js");

const HOUR = 3_600_000;
const sum = (list, key) => list.reduce((total, entry) => total + entry[key], 0);
const balances = (...amounts) => amounts.map((balance, index) => ({ userId: `u${index}`, balance }));

describe("calcul du pot (planRedistribution)", () => {
  it("prélève le pourcentage, arrondi vers le bas, et redistribue en parts égales", () => {
    const plan = redistribution.planRedistribution(balances(1000, 500, 0, 0), 5);
    assert.deepEqual(plan.entries.map((entry) => entry.contribution), [50, 25, 0, 0]);
    assert.equal(plan.pot, 75);
    assert.equal(plan.share, 18);
    assert.equal(plan.participants, 4);
    assert.equal(plan.contributors, 2);
  });

  it("la masse monétaire est conservée au point près, le reste de la division compris", () => {
    for (const percent of [1, 5, 7, 33, 100]) {
      const plan = redistribution.planRedistribution(balances(1001, 777, 13, 5, 0, -40, 99999), percent);
      assert.equal(sum(plan.entries, "delta"), 0, `${percent} %`);
      assert.equal(sum(plan.entries, "received"), plan.pot, `${percent} %`);
    }
  });

  it("chacun reçoit la part entière ou la part plus un point, et le reste va à autant de membres", () => {
    const plan = redistribution.planRedistribution(balances(1003, 700, 11), 5);
    const remainder = plan.pot - plan.share * plan.participants;
    const lucky = plan.entries.filter((entry) => entry.received === plan.share + 1);
    assert.equal(lucky.length, remainder);
    assert.ok(plan.entries.every((entry) => entry.received === plan.share || entry.received === plan.share + 1));
  });

  it("le reste est tiré au sort : tout le monde peut le recevoir", () => {
    const lucky = new Set();
    for (let i = 0; i < 400; i++) {
      const plan = redistribution.planRedistribution(balances(1000, 1000, 1000, 1020), 5);
      plan.entries.filter((entry) => entry.received > plan.share).forEach((entry) => lucky.add(entry.userId));
    }
    assert.equal(lucky.size, 4);
  });

  it("les soldes nuls ou négatifs ne cotisent pas, mais touchent leur part : le pot est une bouée", () => {
    const plan = redistribution.planRedistribution(balances(2000, 0, -500), 10);
    assert.deepEqual(plan.entries.map((entry) => entry.contribution), [200, 0, 0]);
    const debtor = plan.entries[2];
    assert.ok(debtor.received >= plan.share && debtor.delta > 0);
    assert.equal(plan.contributors, 1);
  });

  it("un cotisant ne descend jamais sous zéro, même à 100 %", () => {
    const plan = redistribution.planRedistribution(balances(500, 300, 0), 100);
    for (const entry of plan.entries) assert.ok(entry.balance + entry.delta >= 0, entry.userId);
  });

  it("ne prélève jamais plus que le pourcentage annoncé", () => {
    for (const entry of redistribution.planRedistribution(balances(999, 1, 17), 5).entries) {
      assert.ok(entry.contribution <= (entry.balance * 5) / 100);
    }
  });

  it("à 0 %, personne ne cotise et le pot est vide", () => {
    const plan = redistribution.planRedistribution(balances(1000, 500), 0);
    assert.equal(plan.pot, 0);
    assert.equal(plan.contributors, 0);
    assert.ok(plan.entries.every((entry) => entry.delta === 0));
  });

  it("sans membre, il n'y a rien à calculer", () => {
    assert.deepEqual(redistribution.planRedistribution([], 5), { participants: 0, contributors: 0, pot: 0, share: 0, entries: [] });
  });

  it("des soldes tirés au hasard : la conservation tient toujours (propriété)", () => {
    for (let round = 0; round < 300; round++) {
      const size = 1 + Math.floor(Math.random() * 40);
      const list = Array.from({ length: size }, (_, index) => ({ userId: `p${index}`, balance: Math.floor(Math.random() * 20000) - 2000 }));
      const percent = Math.floor(Math.random() * 101);
      const plan = redistribution.planRedistribution(list, percent);
      assert.equal(sum(plan.entries, "delta"), 0);
      assert.equal(sum(plan.entries, "received"), plan.pot);
      for (const entry of plan.entries) assert.ok(entry.balance <= 0 || entry.balance + entry.delta >= 0);
    }
  });
});

// Un serveur factice : le rôle, et ses membres, que le pot lit puis paie.
function fakeGuild(userIds) {
  const member = (id) => ({ id, user: { bot: false }, roles: { cache: new Map([["role-1", {}]]) } });
  const members = userIds.map(member);
  const role = { id: "role-1", name: "Dresseurs" };
  return {
    roles: { cache: new Map([["role-1", role]]) },
    members: {
      fetch: async () => {},
      cache: {
        filter(predicate) {
          const kept = members.filter(predicate);
          return { values: () => kept };
        },
      },
    },
  };
}
const setBalances = async (map) => {
  await dbRun(points, "DELETE FROM points");
  for (const [userId, balance] of Object.entries(map)) await dbRun(points, "INSERT INTO points (user_id, balance) VALUES (?, ?)", [userId, balance]);
};
const readBalances = async () => Object.fromEntries((await dbAll(points, "SELECT user_id, balance FROM points")).map((row) => [row.user_id, row.balance]));
const total = (map) => Object.values(map).reduce((a, b) => a + b, 0);

describe("exécution du pot (runRedistribution)", () => {
  beforeEach(async () => {
    sandbox.writeConfig({ redistribution: { contributionPercent: 10 } });
    await dbRun(points, "DELETE FROM points_redistributions");
    await dbRun(points, "UPDATE economy_state SET redistribution_since = 0, next_redistribution_at = 0");
  });

  it("verse le net de chaque membre, la masse monétaire intacte, et journalise", async () => {
    const start = { a: 1000, b: 500, c: 0 };
    await setBalances(start);
    const result = await redistribution.runRedistribution(fakeGuild(["a", "b", "c"]), { triggeredBy: "test" });
    assert.equal(result.ok, true);
    assert.equal(result.plan.pot, 150);
    const after = await readBalances();
    assert.equal(total(after), total(start), "rien ne se perd, rien ne se crée");
    assert.ok(after.c >= 50, "le plus pauvre touche sa part");
    const [entry] = await dbAll(points, "SELECT * FROM points_redistributions");
    assert.equal(entry.triggered_by, "test");
    assert.equal(entry.pot, 150);
    assert.equal(entry.participants, 3);
    assert.equal(entry.failures, 0);
  });

  it("une simulation calcule tout et n'écrit rien", async () => {
    const start = { a: 1000, b: 500 };
    await setBalances(start);
    const result = await redistribution.runRedistribution(fakeGuild(["a", "b"]), { dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.deepEqual(await readBalances(), start);
    assert.deepEqual(await dbAll(points, "SELECT * FROM points_redistributions"), []);
  });

  it("un pot vide ne bouge rien et le dit", async () => {
    await setBalances({ a: 0, b: -20 });
    const result = await redistribution.runRedistribution(fakeGuild(["a", "b"]), {});
    assert.equal(result.ok, false);
    assert.match(result.reason, /pot serait vide/);
    assert.deepEqual(await readBalances(), { a: 0, b: -20 });
  });

  it("un membre sans ligne de solde touche sa part comme les autres", async () => {
    await setBalances({ a: 1000 });
    await redistribution.runRedistribution(fakeGuild(["a", "nouveau"]), {});
    const after = await readBalances();
    assert.equal(after.nouveau, 50, "50 % du pot de 100 pour deux membres");
    assert.equal(total(after), 1000);
  });

  it("deux pots lancés ensemble ne prélèvent pas deux fois : le bail n'en laisse passer qu'un", async () => {
    const start = { a: 10_000, b: 0 };
    await setBalances(start);
    const guild = fakeGuild(["a", "b"]);
    const results = await Promise.all([redistribution.runRedistribution(guild, {}), redistribution.runRedistribution(guild, {})]);
    assert.deepEqual(results.map((result) => result.ok).sort(), [false, true]);
    const refused = results.find((result) => !result.ok);
    assert.equal(refused.transient, true);
    assert.match(refused.reason, /déjà en cours/);
    assert.equal((await readBalances()).a, 9500, "un seul prélèvement de 10 % (1 000), dont la moitié lui revient");
  });

  it("libère son bail à la fin, un pot suivant peut passer", async () => {
    await setBalances({ a: 10_000, b: 0 });
    const guild = fakeGuild(["a", "b"]);
    assert.equal((await redistribution.runRedistribution(guild, {})).ok, true);
    assert.equal((await dbGet(points, "SELECT redistribution_since AS since FROM economy_state")).since, 0);
    assert.equal((await redistribution.runRedistribution(guild, {})).ok, true);
  });

  it("un bail périmé après un arrêt brutal ne condamne pas les pots suivants", async () => {
    await setBalances({ a: 10_000, b: 0 });
    await dbRun(points, "UPDATE economy_state SET redistribution_since = ?", [Date.now() - 10 * 60 * 1000]);
    assert.equal((await redistribution.runRedistribution(fakeGuild(["a", "b"]), {})).ok, true);
  });

  it("un bail tout frais bloque", async () => {
    await setBalances({ a: 10_000, b: 0 });
    await dbRun(points, "UPDATE economy_state SET redistribution_since = ?", [Date.now() - 1000]);
    const result = await redistribution.runRedistribution(fakeGuild(["a", "b"]), {});
    assert.equal(result.ok, false);
    assert.equal(result.transient, true);
  });

  it("refuse un rôle introuvable ou vide, avec la raison", async () => {
    const noRole = { roles: { cache: new Map() }, members: { fetch: async () => {}, cache: { filter: () => ({ values: () => [] }) } } };
    assert.match((await redistribution.runRedistribution(noRole, {})).reason, /DEFAULT_ROLE_ID/);
    assert.match((await redistribution.runRedistribution(fakeGuild([]), {})).reason, /Personne ne porte le rôle/);
    assert.match((await redistribution.runRedistribution(null, {})).reason, /depuis un serveur/);
  });

  it("le récapitulatif est réservé à l'administration et décrit le pot", async () => {
    await setBalances({ a: 1000, b: 500, c: 0 });
    const result = await redistribution.runRedistribution(fakeGuild(["a", "b", "c"]), { dryRun: true });
    const embed = redistribution.buildRedistributionEmbed(result).toJSON();
    assert.match(embed.title, /simulation/);
    assert.ok(JSON.stringify(embed).includes("150"), "le montant du pot");
  });
});

describe("minuteur horaire (maybeRunRedistribution)", () => {
  const client = (guild) => ({ guilds: { fetch: async () => guild } });
  const next = async () => (await dbGet(points, "SELECT next_redistribution_at AS at FROM economy_state")).at;

  beforeEach(async () => {
    sandbox.writeConfig({ redistribution: { enabled: true, intervalHours: 168, contributionPercent: 10 } });
    await dbRun(points, "UPDATE economy_state SET next_redistribution_at = 0, redistribution_since = 0");
    await dbRun(points, "DELETE FROM points_redistributions");
    await setBalances({ a: 10_000, b: 0 });
  });

  it("sur une base neuve, il pose la première échéance sans prélever personne", async () => {
    await redistribution.maybeRunRedistribution(client(fakeGuild(["a", "b"])));
    assert.ok((await next()) > Date.now() + 167 * HOUR);
    assert.deepEqual(await readBalances(), { a: 10_000, b: 0 });
  });

  it("tant que l'échéance n'est pas atteinte, il ne fait rien", async () => {
    const due = Date.now() + 5 * HOUR;
    await dbRun(points, "UPDATE economy_state SET next_redistribution_at = ?", [due]);
    assert.equal(await redistribution.maybeRunRedistribution(client(fakeGuild(["a", "b"]))), null);
    assert.equal(await next(), due);
    assert.equal((await readBalances()).a, 10_000);
  });

  it("à l'échéance, il prélève une fois et pose la suivante à partir de l'ANCIENNE : aucune dérive", async () => {
    const due = Date.now() - 2 * HOUR;
    await dbRun(points, "UPDATE economy_state SET next_redistribution_at = ?", [due]);
    const result = await redistribution.maybeRunRedistribution(client(fakeGuild(["a", "b"])));
    assert.equal(result.ok, true);
    assert.equal((await readBalances()).a, 9500);
    assert.equal(await next(), due + 168 * HOUR);
  });

  it("une panne de plusieurs semaines ne donne qu'un seul pot, et l'échéance repart dans le futur", async () => {
    const due = Date.now() - 3 * 168 * HOUR - HOUR;
    await dbRun(points, "UPDATE economy_state SET next_redistribution_at = ?", [due]);
    await redistribution.maybeRunRedistribution(client(fakeGuild(["a", "b"])));
    await redistribution.maybeRunRedistribution(client(fakeGuild(["a", "b"])));
    assert.equal((await readBalances()).a, 9500, "un seul pot de rattrapage");
    assert.ok((await next()) > Date.now());
    assert.equal((await dbAll(points, "SELECT * FROM points_redistributions")).length, 1);
  });

  it("un Discord indisponible ne consomme pas l'échéance de la semaine", async () => {
    const due = Date.now() - HOUR;
    await dbRun(points, "UPDATE economy_state SET next_redistribution_at = ?", [due]);
    const broken = { guilds: { fetch: async () => { throw new Error("Discord est tombé"); } } };
    assert.equal(await redistribution.maybeRunRedistribution(broken), null);
    assert.equal(await next(), due, "l'échéance est intacte, le tour suivant réessaiera");
    assert.equal((await readBalances()).a, 10_000);
  });

  it("une liste de membres indisponible non plus", async () => {
    const due = Date.now() - HOUR;
    await dbRun(points, "UPDATE economy_state SET next_redistribution_at = ?", [due]);
    const guild = fakeGuild(["a", "b"]);
    guild.members.fetch = async () => { throw new Error("délai dépassé"); };
    await redistribution.maybeRunRedistribution(client(guild));
    assert.equal(await next(), due);
  });

  it("un pot vide consomme la semaine : on ne boucle pas chaque heure sur Discord", async () => {
    await setBalances({ a: 0, b: 0 });
    const due = Date.now() - HOUR;
    await dbRun(points, "UPDATE economy_state SET next_redistribution_at = ?", [due]);
    await redistribution.maybeRunRedistribution(client(fakeGuild(["a", "b"])));
    assert.ok((await next()) > Date.now());
  });

  it("désactivé, il ne fait rien du tout", async () => {
    sandbox.writeConfig({ redistribution: { enabled: false } });
    await dbRun(points, "UPDATE economy_state SET next_redistribution_at = ?", [Date.now() - HOUR]);
    assert.equal(await redistribution.maybeRunRedistribution(client(fakeGuild(["a", "b"]))), null);
    assert.equal((await readBalances()).a, 10_000);
  });

  it("deux minuteurs qui passent ensemble ne prélèvent qu'une fois", async () => {
    await dbRun(points, "UPDATE economy_state SET next_redistribution_at = ?", [Date.now() - HOUR]);
    const guild = fakeGuild(["a", "b"]);
    await withRandom(0.5, () => Promise.all([redistribution.maybeRunRedistribution(client(guild)), redistribution.maybeRunRedistribution(client(guild))]));
    assert.equal((await readBalances()).a, 9500);
    assert.equal((await dbAll(points, "SELECT * FROM points_redistributions")).length, 1);
  });
});
