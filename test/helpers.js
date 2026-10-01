// Outils des tests.
//
// Chaque fichier de test tourne dans son propre processus (node --test), avec un
// dossier jetable pour les bases et la configuration : PCR_DATA_DIR est posé AVANT
// d'importer le moindre module du bot, qui lit ce chemin à son chargement. Un
// test n'écrit donc jamais dans points.db, botdata-<année>.db ni config.json du
// dépôt, et la CI n'a rien à nettoyer.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after } from "node:test";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// À appeler en tête de fichier, avant les `await import(...)` des modules testés.
export function createSandbox({ config = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-test-"));
  process.env.PCR_DATA_DIR = dir;
  // dotenv 18 journalise chaque chargement du .env : inutile dans un test.
  process.env.DOTENV_CONFIG_QUIET = "true";
  const configFile = path.join(dir, "config.json");
  if (config) fs.writeFileSync(configFile, JSON.stringify(config));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return {
    dir,
    configFile,
    // Les réglages à chaud, tels qu'ils sont sur le disque : le bot les relit à
    // chaque accès, sans redémarrage.
    writeConfig: (value) => fs.writeFileSync(configFile, JSON.stringify(value)),
    writeRaw: (text) => fs.writeFileSync(configFile, text),
    removeConfig: () => fs.rmSync(configFile, { force: true }),
  };
}

// ---------------------- Bases ----------------------

export const dbRun = (db, sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (error) {
      if (error) reject(error);
      else resolve({ changes: this.changes, lastID: this.lastID });
    })
  );
export const dbGet = (db, sql, params = []) =>
  new Promise((resolve, reject) =>
    db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row)))
  );
export const dbAll = (db, sql, params = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)))
  );

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Les bases se créent en cascade de rappels, sans signal de fin. Plutôt que
// d'attendre « assez longtemps », on lit le code qui les crée : chaque table,
// index et déclencheur `IF NOT EXISTS`, et chaque `addColumn(...)`, doit exister
// avant le premier test. Un objet ajouté plus tard au schéma est donc attendu
// sans toucher à ces tests.
function expectedSchema(sourceFile) {
  const source = fs.readFileSync(path.join(ROOT, sourceFile), "utf8");
  const objects = [
    ...source.matchAll(/CREATE (?:UNIQUE )?(TABLE|INDEX|TRIGGER) IF NOT EXISTS ([a-z_]+)/g),
  ].map(([, kind, name]) => ({ kind: kind.toLowerCase(), name }));
  const columns = [...source.matchAll(/addColumn\(\s*"([a-z_]+)",\s*"([a-z_]+)"/g)].map(
    ([, table, column]) => ({ table, column })
  );
  return { objects, columns };
}

export async function waitForSchema(db, sourceFile, { timeout = 15000 } = {}) {
  const { objects, columns } = expectedSchema(sourceFile);
  const deadline = Date.now() + timeout;
  let missing = [];
  while (Date.now() < deadline) {
    const rows = await dbAll(db, "SELECT type, name FROM sqlite_master");
    const known = new Set(rows.map((row) => `${row.type}:${row.name}`));
    missing = objects.filter(({ kind, name }) => !known.has(`${kind}:${name}`)).map((o) => o.name);
    for (const { table, column } of columns) {
      if (!known.has(`table:${table}`)) continue;
      const info = await dbAll(db, `PRAGMA table_info(${table})`);
      if (!info.some((entry) => entry.name === column)) missing.push(`${table}.${column}`);
    }
    if (!missing.length) return;
    await sleep(25);
  }
  throw new Error(`Schéma de ${sourceFile} incomplet : ${missing.join(", ")}`);
}

// Les deux bases du bot, prêtes : points.db (le jeu) et botdata (les statistiques).
export async function openDatabases() {
  const { default: points } = await import("../modules/points-db.js");
  const { default: stats } = await import("../modules/db.js");
  await Promise.all([
    waitForSchema(points, "modules/points-db.js"),
    waitForSchema(stats, "modules/db.js"),
  ]);
  // Rien ne doit rester ouvert : sans cela, le processus de test ne se termine pas.
  after(() => Promise.all([points, stats].map((db) => new Promise((done) => db.close(done)))));
  return { points, stats };
}

// ---------------------- Hasard ----------------------

// Fige Math.random le temps de `run` : une valeur, ou une suite (la dernière se
// répète). Le jeu tire au sort partout : un test qui ne le fige pas est une
// loterie.
export async function withRandom(values, run) {
  const sequence = Array.isArray(values) ? [...values] : [values];
  const real = Math.random;
  Math.random = () => (sequence.length > 1 ? sequence.shift() : sequence[0]);
  try {
    return await run();
  } finally {
    Math.random = real;
  }
}

// ---------------------- Données de jeu ----------------------

export const speciesByName = (allSpecies, name) => {
  const found = allSpecies().find((entry) => entry.name === name);
  if (!found) throw new Error(`Espèce introuvable : ${name}`);
  return found;
};
