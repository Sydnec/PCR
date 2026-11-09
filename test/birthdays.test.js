// Tests de la fonctionnalité anniversaires : règles pures (parsing, dates)
// et invariant de base (la garde anti-doublon ne félicite qu'une fois par an).
// Exécuter : node --test test/
//
// Les fonctions datées reçoivent `now` en paramètre : aucun test ne dépend de
// la date d'exécution, le hasard comme le calendrier sont figés.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  parseBirthday,
  formatBirthday,
  celebrationDayOf,
  nextOccurrence,
  daysUntil,
  isToday,
} from "../modules/birthdays.js";

// ---------- Parsing ----------

test("parseBirthday accepte JJ/MM", () => {
  assert.deepEqual(parseBirthday("24/07"), { day: 24, month: 7, year: null });
  // Zéros facultatifs, espaces tolérés : la saisie humaine n'est pas un format.
  assert.deepEqual(parseBirthday(" 4/7 "), { day: 4, month: 7, year: null });
});

test("parseBirthday accepte JJ/MM/AAAA", () => {
  assert.deepEqual(parseBirthday("29/02/2000"), { day: 29, month: 2, year: 2000 });
});

test("parseBirthday refuse les dates inexistantes", () => {
  // Le 31 avril n'existe pas.
  assert.equal(parseBirthday("31/04"), null);
  // 2001 n'est pas bissextile : pas de 29 février.
  assert.equal(parseBirthday("29/02/2001"), null);
  assert.equal(parseBirthday("0/5"), null);
  assert.equal(parseBirthday("32/1"), null);
  assert.equal(parseBirthday("24/13"), null);
  // Formats hors gabarit, année à deux chiffres comprise.
  assert.equal(parseBirthday("demain"), null);
  assert.equal(parseBirthday("24/7/98"), null);
  assert.equal(parseBirthday(""), null);
});

test("parseBirthday refuse les années invraisemblables", () => {
  // Centenaire invraisemblable sur un serveur Discord, date future : fautes
  // de frappe, pas des préférences.
  assert.equal(parseBirthday("01/01/1899"), null);
  assert.equal(parseBirthday("01/01/2999"), null);
});

test("parseBirthday tolère le 29 février sans année", () => {
  // Année inconnue : février compte 29 jours, la validation ne tranche pas.
  assert.deepEqual(parseBirthday("29/02"), { day: 29, month: 2, year: null });
});

// ---------- Affichage ----------

test("formatBirthday complète à deux chiffres et omet l'année absente", () => {
  assert.equal(formatBirthday({ day: 4, month: 7, year: null }), "04/07");
  assert.equal(formatBirthday({ day: 29, month: 2, year: 2000 }), "29/02/2000");
});

// ---------- Calendrier ----------

test("le 29 février se fête le 28 les années non bissextiles", () => {
  const birthday = { day: 29, month: 2 };
  assert.equal(celebrationDayOf(birthday, 2000), 29);
  assert.equal(celebrationDayOf(birthday, 2001), 28);
});

test("nextOccurrence pointe cette année si la date n'est pas passée", () => {
  // 2026-11-09, midi : le 24 juillet 2026 est passé, il remonte à 2027.
  const now = new Date(2026, 10, 9, 12, 0);
  const row = { day: 24, month: 7, year: null };
  const next = nextOccurrence(row, now);
  assert.equal(next.getFullYear(), 2027);
  assert.equal(next.getMonth(), 6);
  assert.equal(next.getDate(), 24);
  assert.equal(daysUntil(row, now), 257);
});

test("nextOccurrence pointe aujourd'hui le jour même", () => {
  const now = new Date(2026, 10, 9, 12, 0);
  const row = { day: 9, month: 11, year: null };
  assert.equal(daysUntil(row, now), 0);
});

test("isToday décale le 29 février les années communes", () => {
  const birthday = { day: 29, month: 2, year: null };
  // 2024 est bissextile : le 29 février tombe le 29.
  assert.equal(isToday(birthday, new Date(2024, 1, 29)), true);
  // 2025 ne l'est pas : il tombe le 28.
  assert.equal(isToday(birthday, new Date(2025, 1, 28)), true);
  assert.equal(isToday(birthday, new Date(2025, 1, 29)), false);
});

// ---------- Garde anti-doublon ----------

// Le verrou vit dans points.db, lue au chargement du module : l'env doit être
// posé AVANT l'import dynamique, d'où l'absence d'import statique ici. Les
// tests travaillent dans un dossier jetable, jamais dans les vraies données
// (convention PCR_DATA_DIR de points-db.js).
test("la garde anti-doublon ne félicite qu'une fois par an", async () => {
  process.env.PCR_DATA_DIR = mkdtempSync(join(tmpdir(), "pcr-test-"));
  const pointsDb = (await import("../modules/points-db.js")).default;

  const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
      pointsDb.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
      });
    });

  // La table est créée par points-db.js au démarrage du bot ; la redéclarer
  // ici lève la course entre l'ouverture de la base et le premier test.
  await run(`CREATE TABLE IF NOT EXISTS birthdays (
    user_id TEXT PRIMARY KEY,
    day INTEGER NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER,
    last_wished_year INTEGER
  )`);

  await run(
    "INSERT OR IGNORE INTO birthdays (user_id, day, month, year) VALUES (?, 9, 11, 1998)",
    ["utilisateur_test"]
  );

  // Verrou : l'UPDATE gardé ne réussit que la première fois.
  const claim = (year) =>
    run(
      "UPDATE birthdays SET last_wished_year = ? WHERE user_id = ? AND (last_wished_year IS NULL OR last_wished_year <> ?)",
      [year, "utilisateur_test", year]
    );

  const first = await claim(2026);
  assert.equal(first.changes, 1);
  const second = await claim(2026);
  assert.equal(second.changes, 0);

  // L'année suivante, la garde se lève d'elle-même.
  const nextYear = await claim(2027);
  assert.equal(nextYear.changes, 1);

  // Rendu « non félicité » (retentative après un envoi raté) : la garde
  // redevient armée.
  await run("UPDATE birthdays SET last_wished_year = NULL WHERE user_id = ?", ["utilisateur_test"]);
  const rearmed = await claim(2027);
  assert.equal(rearmed.changes, 1);
});
