// L'entrée au parc safari : gratuite par le message d'un parc ouvert, ou payante
// par /pk safari (un ticket d'abord, des points sinon). Tout ce qui se débite se
// rend quand l'entrée n'a pas lieu.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbGet, dbAll, eventually, eventuallyStable } from "./helpers.js";

const sandbox = createSandbox({
  config: { pokemon: { generation: 2 } },
});
const { points } = await openDatabases();
const safari = await import("../modules/pokemon/safari.js");
const items = await import("../modules/pokemon/items.js");
const economy = await import("../modules/economy.js");
const { getSafariConfig } = await import("../modules/pokemon/config.js");

const call = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value))));
const HOUR = 3_600_000;
const price = () => getSafariConfig().entryPrice;
const balance = (user = "u1") => call(economy.getBalance, user);
const setBalance = (amount, user = "u1") =>
  dbRun(points, "INSERT INTO points (user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = ?", [user, amount, amount]);
const tickets = (user = "u1") => call(items.getItemCount, user, "ticket_safari");
const grantTicket = (n = 1, user = "u1") => call((...a) => items.grantItem(user, "ticket_safari", n, { source: "test" }, a.at(-1)));
const sessions = () => dbAll(points, "SELECT * FROM pokemon_safari_sessions ORDER BY id");
const openPark = (overrides = {}) =>
  dbRun(
    points,
    "INSERT INTO pokemon_safari_parks (status, opened_at, expires_at, reserved_for) VALUES ('OPEN', ?, ?, ?)",
    [Date.now(), overrides.expiresAt ?? Date.now() + 2 * HOUR, overrides.reservedFor ?? null]
  ).then(({ lastID }) => lastID);

beforeEach(async () => {
  for (const table of ["pokemon_safari_sessions", "pokemon_safari_parks", "pokemon_inventory", "pokemon_item_log", "points", "points_log", "pokemon_owned"]) {
    await dbRun(points, `DELETE FROM ${table}`);
  }
});

describe("entrée payante", () => {
  it("débite le prix, ouvre une visite de toutes les actions, sur une rencontre", async () => {
    await setBalance(price() + 100);
    const result = await call(safari.startPaidSession, "u1", {});
    assert.equal(result.ok, true);
    assert.equal(await balance(), 100);
    const [session] = await sessions();
    assert.equal(session.entry_cost, price());
    assert.equal(session.actions_left, getSafariConfig().actionsPerSession);
    assert.equal(session.status, "ACTIVE");
    assert.equal(session.encounter_no, 1);
    assert.ok(session.encounter_species_id > 0);
    assert.equal(session.park_id, null, "pas de parc derrière une entrée payante");
  });

  it("la visite dure au moins le plancher réglé", async () => {
    await setBalance(price());
    await call(safari.startPaidSession, "u1", {});
    const [session] = await sessions();
    assert.ok(session.expires_at - Date.now() >= getSafariConfig().sessionMinDurationMinutes * 60_000 - 5000);
  });

  it("refuse un solde insuffisant, avec les chiffres, sans rien prélever", async () => {
    await setBalance(price() - 1);
    const result = await call(safari.startPaidSession, "u1", {});
    assert.equal(result.ok, false);
    assert.equal(result.code, "BALANCE");
    assert.match(result.reason, new RegExp(`coûte \\*\\*${price()}\\*\\* points, tu en as \\*\\*${price() - 1}\\*\\*`));
    assert.equal(await balance(), price() - 1);
    assert.equal((await sessions()).length, 0);
  });

  it("un Ticket Safari passe avant les points", async () => {
    await setBalance(price() * 2);
    await grantTicket(2);
    const result = await call(safari.startPaidSession, "u1", {});
    assert.equal(result.ok, true);
    assert.equal(result.ticket.key, "ticket_safari");
    assert.equal(await tickets(), 1);
    assert.equal(await balance(), price() * 2, "aucun point débité");
    assert.equal((await sessions())[0].entry_cost, 0);
  });

  it("un ticket ignore le délai entre deux entrées achetées", async () => {
    await setBalance(price());
    await call(safari.startPaidSession, "u1", {});
    await dbRun(points, "UPDATE pokemon_safari_sessions SET status = 'FINISHED'");
    await grantTicket(1);
    const second = await call(safari.startPaidSession, "u1", {});
    assert.equal(second.ok, true);
    assert.equal(await tickets(), 0);
  });

  it("deux entrées achetées d'affilée sont refusées pendant le délai, sans débit", async () => {
    await setBalance(price() * 3);
    await call(safari.startPaidSession, "u1", {});
    await dbRun(points, "UPDATE pokemon_safari_sessions SET status = 'FINISHED'");
    const second = await call(safari.startPaidSession, "u1", {});
    assert.equal(second.ok, false);
    assert.equal(second.code, "COOLDOWN");
    assert.ok(second.retryAt > Date.now());
    assert.equal(await balance(), price() * 2, "un seul achat débité");
  });

  it("l'entrée se rouvre après le délai", async () => {
    await setBalance(price() * 2);
    await call(safari.startPaidSession, "u1", {});
    await dbRun(points, "UPDATE pokemon_safari_sessions SET status = 'FINISHED', started_at = ?", [
      Date.now() - (getSafariConfig().entryCooldownHours + 1) * HOUR,
    ]);
    assert.equal((await call(safari.startPaidSession, "u1", {})).ok, true);
  });

  it("une visite en cours se rouvre, sans payer deux fois", async () => {
    await setBalance(price() * 2);
    const first = await call(safari.startPaidSession, "u1", {});
    const again = await call(safari.startPaidSession, "u1", {});
    assert.equal(again.resumed, true);
    assert.equal(again.session.id, first.session.id);
    assert.equal(await balance(), price());
    assert.equal((await sessions()).length, 1);
  });

  it("des clics simultanés n'ouvrent qu'une visite et ne débitent qu'une entrée", async () => {
    await setBalance(price() * 5);
    const results = await Promise.all(Array.from({ length: 5 }, () => call(safari.startPaidSession, "u1", {})));
    assert.equal((await sessions()).length, 1);
    assert.equal(results.filter((result) => result.ok).length, 5, "tous reçoivent la visite");
    await eventuallyStable(async () => assert.equal(await balance(), price() * 4, "un seul débit net, les autres remboursés"));
  });

  it("garde les générations visées pour toute la visite, et les encounters en viennent", async () => {
    await setBalance(price());
    const result = await call(safari.startPaidSession, "u1", { generations: [2] });
    assert.equal(result.ok, true);
    const [session] = await sessions();
    assert.equal(session.generations, "2");
    const species = (await import("../modules/pokemon/data.js")).getSpecies(session.encounter_species_id);
    assert.equal(species.generation, 2);
  });

  it("ne garde rien quand les deux générations sont visées : c'est « toutes »", async () => {
    await setBalance(price());
    await call(safari.startPaidSession, "u1", { generations: [1, 2] });
    assert.equal((await sessions())[0].generations, null);
  });

  it("une visite expirée ne bloque pas une nouvelle entrée", async () => {
    await setBalance(price() * 2);
    await call(safari.startPaidSession, "u1", {});
    await dbRun(points, "UPDATE pokemon_safari_sessions SET expires_at = ?, started_at = ?", [
      Date.now() - 1000,
      Date.now() - (getSafariConfig().entryCooldownHours + 1) * HOUR,
    ]);
    const second = await call(safari.startPaidSession, "u1", {});
    assert.equal(second.ok, true);
    assert.equal(second.resumed, undefined);
    const rows = await sessions();
    assert.equal(rows[0].status, "EXPIRED");
    assert.equal(rows[1].status, "ACTIVE");
  });
});

describe("entrée gratuite par un parc ouvert", () => {
  it("ouvre une visite sans rien débiter, et compte l'entrée dans le parc", async () => {
    const parkId = await openPark();
    const result = await call(safari.enterPark, "u1", parkId, {});
    assert.equal(result.ok, true);
    const [session] = await sessions();
    assert.equal(session.park_id, parkId);
    assert.equal(session.entry_cost, 0);
    await eventually(async () => assert.equal((await dbGet(points, "SELECT entries FROM pokemon_safari_parks WHERE id = ?", [parkId])).entries, 1));
  });

  it("la visite dure jusqu'à la fermeture du parc, au plancher près", async () => {
    const closesAt = Date.now() + 5 * HOUR;
    const parkId = await openPark({ expiresAt: closesAt });
    await call(safari.enterPark, "u1", parkId, {});
    assert.equal((await sessions())[0].expires_at, closesAt);
    await dbRun(points, "DELETE FROM pokemon_safari_sessions");
    // Jamais deux parcs publics ouverts à la fois : le premier ferme avant le second.
    await dbRun(points, "UPDATE pokemon_safari_parks SET status = 'CLOSED'");
    const almostClosed = await openPark({ expiresAt: Date.now() + 60_000 });
    await call(safari.enterPark, "u2", almostClosed, {});
    const late = (await sessions())[0];
    assert.ok(late.expires_at - Date.now() >= getSafariConfig().sessionMinDurationMinutes * 60_000 - 5000);
  });

  it("une seule entrée par parc et par dresseur", async () => {
    const parkId = await openPark();
    await call(safari.enterPark, "u1", parkId, {});
    await dbRun(points, "UPDATE pokemon_safari_sessions SET status = 'FINISHED'");
    const again = await call(safari.enterPark, "u1", parkId, {});
    assert.equal(again.ok, false);
    assert.equal(again.code, "ALREADY_ENTERED");
    assert.equal((await sessions()).length, 1);
  });

  it("refuse un parc fermé, expiré ou inconnu", async () => {
    const closed = await openPark();
    await dbRun(points, "UPDATE pokemon_safari_parks SET status = 'CLOSED'");
    assert.match((await call(safari.enterPark, "u1", closed, {})).reason, /fermé ses portes/);
    const expired = await openPark({ expiresAt: Date.now() - 1000 });
    assert.match((await call(safari.enterPark, "u1", expired, {})).reason, /fermé ses portes/);
    assert.match((await call(safari.enterPark, "u1", 9999, {})).reason, /fermé ses portes/);
    assert.equal((await sessions()).length, 0);
  });

  it("un parc réservé n'ouvre qu'à son ayant droit", async () => {
    const parkId = await openPark({ reservedFor: "invite" });
    const stranger = await call(safari.enterPark, "u1", parkId, {});
    assert.equal(stranger.ok, false);
    assert.match(stranger.reason, /réservé à un autre dresseur/);
    assert.equal((await call(safari.enterPark, "invite", parkId, {})).ok, true);
  });

  it("cible les générations dès l'entrée gratuite", async () => {
    const parkId = await openPark();
    await call(safari.enterPark, "u1", parkId, { generations: [1] });
    const [session] = await sessions();
    assert.equal(session.generations, "1");
    const species = (await import("../modules/pokemon/data.js")).getSpecies(session.encounter_species_id);
    assert.equal(species.generation, 1);
  });

  it("des clics simultanés d'un même dresseur n'ouvrent qu'une visite et ne comptent qu'une entrée", async () => {
    const parkId = await openPark();
    await Promise.all(Array.from({ length: 4 }, () => call(safari.enterPark, "u1", parkId, {})));
    assert.equal((await sessions()).length, 1);
    await eventuallyStable(async () => assert.equal((await dbGet(points, "SELECT entries FROM pokemon_safari_parks WHERE id = ?", [parkId])).entries, 1));
  });

  it("une visite déjà ouverte se rouvre même si le parc a fermé depuis", async () => {
    const parkId = await openPark();
    const first = await call(safari.enterPark, "u1", parkId, {});
    await dbRun(points, "UPDATE pokemon_safari_parks SET status = 'CLOSED'");
    const again = await call(safari.enterPark, "u1", parkId, {});
    assert.equal(again.resumed, true);
    assert.equal(again.session.id, first.session.id);
  });
});

describe("ce que le dresseur peut faire du parc", () => {
  it("sans parc ni ticket : acheter, et bloqué faute de points", async () => {
    await setBalance(price() - 1);
    const offer = await call(safari.getEntryOffer, "u1");
    assert.equal(offer.enabled, true);
    assert.equal(offer.ongoing, null);
    assert.equal(offer.freePark, null);
    assert.equal(offer.price, price());
    assert.equal(offer.blocked, "balance");
    assert.equal(offer.tickets, 0);
  });

  it("assez de points : l'achat est possible", async () => {
    await setBalance(price());
    assert.equal((await call(safari.getEntryOffer, "u1")).blocked, null);
  });

  it("un parc ouvert offre l'entrée, un parc réservé à un autre non", async () => {
    await openPark({ reservedFor: "autre" });
    assert.equal((await call(safari.getEntryOffer, "u1")).freePark, null);
    const open = await openPark();
    assert.equal((await call(safari.getEntryOffer, "u1")).freePark.id, open);
  });

  it("un parc réservé à ce dresseur passe avant l'événement public", async () => {
    await openPark();
    const mine = await openPark({ reservedFor: "u1" });
    assert.equal((await call(safari.findFreeParkFor, "u1")).id, mine);
  });

  it("un parc déjà visité n'est plus offert", async () => {
    const parkId = await openPark();
    await call(safari.enterPark, "u1", parkId, {});
    await dbRun(points, "UPDATE pokemon_safari_sessions SET status = 'FINISHED'");
    assert.equal((await call(safari.getEntryOffer, "u1")).freePark, null);
  });

  it("un ticket débloque l'achat, même sans points ni après un achat récent", async () => {
    await grantTicket(1);
    const offer = await call(safari.getEntryOffer, "u1");
    assert.equal(offer.tickets, 1);
    assert.equal(offer.blocked, null);
  });

  it("annonce le délai entre deux achats", async () => {
    await setBalance(price() * 2);
    await call(safari.startPaidSession, "u1", {});
    await dbRun(points, "UPDATE pokemon_safari_sessions SET status = 'FINISHED'");
    const offer = await call(safari.getEntryOffer, "u1");
    assert.equal(offer.blocked, "cooldown");
    assert.ok(offer.retryAt > Date.now());
  });

  it("une visite en cours est rendue avec sa rencontre et sa lignée", async () => {
    await setBalance(price());
    await call(safari.startPaidSession, "u1", {});
    const offer = await call(safari.getEntryOffer, "u1");
    assert.ok(offer.ongoing);
    assert.ok(offer.ongoing.lineage instanceof Map);
    assert.ok(offer.ongoing.lineage.has(offer.ongoing.session.encounter_species_id));
  });

  it("le parc désactivé est annoncé comme tel", async () => {
    sandbox.writeConfig({ pokemon: { generation: 2, safari: { enabled: false } } });
    try {
      assert.equal((await call(safari.getEntryOffer, "u1")).enabled, false);
    } finally {
      sandbox.writeConfig({ pokemon: { generation: 2 } });
    }
  });
});

describe("fin de visite", () => {
  it("balayer les sessions closes celles dont l'heure est passée", async () => {
    await setBalance(price());
    await call(safari.startPaidSession, "u1", {});
    await dbRun(points, "UPDATE pokemon_safari_sessions SET expires_at = ?", [Date.now() - 1000]);
    await call(safari.sweepSafari, { channels: { fetch: async () => null } });
    assert.equal((await sessions())[0].status, "EXPIRED");
  });

  it("le bilan d'une visite liste ses prises", async () => {
    await setBalance(price());
    const { session } = await call(safari.startPaidSession, "u1", {});
    await dbRun(
      points,
      "INSERT INTO pokemon_safari_catches (session_id, species_id, is_shiny, caught_at) VALUES (?, 25, 0, 1)",
      [session.id]
    );
    const catches = await call(safari.getSessionCatches, session.id);
    assert.equal(catches.length, 1);
    assert.equal(catches[0].species_id, 25);
  });
});
