// La courbe des soldes de la page d'administration, lue dans le journal des
// points. Le journal est tenu par des déclencheurs de la base : ici on le réécrit
// à la main, avec des dates choisies, pour savoir exactement ce que la courbe doit
// montrer.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun } from "./helpers.js";

createSandbox();
const { points } = await openDatabases();
const { getPointsHistory } = await import("../modules/points-history.js");

const DAY = 24 * 3600 * 1000;
const history = (options) =>
  new Promise((resolve, reject) => getPointsHistory(options, (error, value) => (error ? reject(error) : resolve(value))));

// `moves` : [[jours avant maintenant, variation], ...] dans l'ordre du temps ; le
// solde final est celui de la table des points.
async function trainer(userId, moves) {
  let balance = 0;
  for (const [, delta] of moves) balance += delta;
  await dbRun(points, "DELETE FROM points WHERE user_id = ?", [userId]);
  await dbRun(points, "INSERT INTO points (user_id, balance) VALUES (?, ?)", [userId, balance]);
  await dbRun(points, "DELETE FROM points_log WHERE user_id = ?", [userId]);
  // Un seul « maintenant » pour tout le jeu de données : deux mouvements « à J-5 » doivent
  // porter la même date, même si la base met du temps entre deux insertions.
  const now = Date.now();
  let running = 0;
  for (const [daysAgo, delta] of moves) {
    running += delta;
    await dbRun(points, "INSERT INTO points_log (user_id, delta, balance, created_at) VALUES (?, ?, ?, ?)", [userId, delta, running, now - daysAgo * DAY]);
  }
}

beforeEach(async () => {
  await dbRun(points, "DELETE FROM points");
  await dbRun(points, "DELETE FROM points_log");
});

describe("la courbe des soldes", () => {
  it("sans dresseur ni journal : un seul instant, aucune série", async () => {
    const result = await history();
    assert.equal(result.series.length, 0);
    assert.equal(result.times.length, 1);
    assert.equal(result.from, result.to);
  });

  it("un dresseur au solde sans journal est dans la courbe, sans valeur connue", async () => {
    await dbRun(points, "DELETE FROM points_log");
    await dbRun(points, "INSERT INTO points (user_id, balance) VALUES ('inconnu', 50)");
    await dbRun(points, "DELETE FROM points_log");
    const { series } = await history();
    assert.equal(series.length, 1);
    assert.equal(series[0].balance, 50);
    assert.ok(series[0].values.every((value) => value === null), "le journal ne le connaît pas");
  });

  it("les dresseurs vont du plus riche au plus pauvre, à égalité par identifiant", async () => {
    await trainer("b", [[2, 100]]);
    await trainer("a", [[2, 100]]);
    await trainer("riche", [[2, 900]]);
    await trainer("pauvre", [[2, 5]]);
    const { series } = await history();
    assert.deepEqual(series.map((entry) => entry.userId), ["riche", "a", "b", "pauvre"]);
  });

  it("la courbe commence avec le journal et finit au solde actuel, en reportant les valeurs tant que rien ne bouge", async () => {
    await trainer("u1", [[10, 100], [5, 200]]);
    const result = await history();
    const [entry] = result.series;
    assert.equal(result.times.length, 241);
    assert.equal(entry.values.length, result.times.length);
    assert.ok(Math.abs(result.from - (Date.now() - 10 * DAY)) < 5000, "elle commence au premier mouvement");
    assert.equal(entry.values[0], 100);
    assert.equal(entry.values.at(-1), 300);
    assert.equal(entry.balance, 300);
    for (let index = 1; index < entry.values.length; index++) {
      assert.ok(entry.values[index] >= entry.values[index - 1], "le solde ne décroît pas : il n'y a eu que des gains");
    }
    assert.deepEqual([...new Set(entry.values)], [100, 300], "deux paliers seulement, reportés entre les mouvements");
  });

  it("les instants sont croissants et ne dépassent pas maintenant", async () => {
    await trainer("u1", [[3, 10]]);
    const { times, to } = await history();
    for (let index = 1; index < times.length; index++) assert.ok(times[index] >= times[index - 1]);
    assert.equal(times.at(-1) <= to, true);
  });

  it("`since` borne le début : le solde de départ est celui du dernier mouvement avant", async () => {
    await trainer("u1", [[10, 100], [5, 200], [1, -50]]);
    const result = await history({ since: Date.now() - 6 * DAY });
    const [entry] = result.series;
    assert.ok(Math.abs(result.from - (Date.now() - 6 * DAY)) < 5000);
    assert.equal(entry.values[0], 100, "le gain de 10 jours est déjà dans le solde de départ");
    assert.equal(entry.values.at(-1), 250);
  });

  it("un dresseur arrivé après le début part de zéro, puis saute à son premier solde", async () => {
    await trainer("ancien", [[10, 100]]);
    await trainer("nouveau", [[2, 400]]);
    const { series } = await history();
    const entry = series.find((row) => row.userId === "nouveau");
    assert.equal(entry.values[0], 0);
    assert.equal(entry.values.at(-1), 400);
  });

  it("deux mouvements dans le même intervalle : l'intervalle garde le dernier", async () => {
    await trainer("u1", [[10, 100], [5, 50], [5, 25]]);
    const [entry] = (await history()).series;
    assert.equal(entry.values.at(-1), 175);
    assert.ok(entry.values.includes(175));
    assert.ok(!entry.values.includes(150), "le solde intermédiaire est absorbé par l'intervalle");
  });

  it("un début dans le futur retombe sur un seul instant", async () => {
    await trainer("u1", [[3, 100]]);
    const result = await history({ since: Date.now() + DAY });
    assert.equal(result.times.length, 1);
    assert.equal(result.series[0].values.length, 1);
  });

  it("un solde qui diminue se voit : la courbe suit le solde de chaque mouvement", async () => {
    await trainer("u1", [[10, 500], [4, -300]]);
    const [entry] = (await history()).series;
    assert.equal(entry.values[0], 500);
    assert.equal(entry.values.at(-1), 200);
  });
});
