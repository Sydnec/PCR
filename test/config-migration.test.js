// Avant, /admin config écrivait dans config.local.json et config.json était le
// réglage versionné. Le premier démarrage reprend l'ancienne surcharge comme
// config.json : sans cela, les réglages posés depuis Discord seraient ignorés en
// silence après la mise à jour.
//
// La reprise se fait au chargement du module. Le premier scénario démarre un vrai
// processus, comme le bot au redémarrage ; les autres rechargent le module sous
// une adresse neuve dans le processus du test — un démarrage de Node et de
// discord.js coûte environ 1,5 s, et tous les scénarios ne l'exigent pas.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MODULE = path.join(import.meta.dirname, "..", "modules", "config.js");

let loads = 0;
async function loadInProcess(dir) {
  const previous = process.env.PCR_DATA_DIR;
  process.env.PCR_DATA_DIR = dir;
  try {
    const { getConfig } = await import(`${MODULE}?run=${++loads}`);
    return { price: getConfig().pokemon.capture.balls.master.price };
  } finally {
    if (previous === undefined) delete process.env.PCR_DATA_DIR;
    else process.env.PCR_DATA_DIR = previous;
  }
}

async function boot(files, { realProcess = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-migration-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), JSON.stringify(content));
    }
    let result;
    if (realProcess) {
      const script = `
        const { getConfig } = await import(${JSON.stringify(MODULE)});
        console.log(JSON.stringify({ price: getConfig().pokemon.capture.balls.master.price }));
      `;
      const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        env: { ...process.env, PCR_DATA_DIR: dir, DOTENV_CONFIG_QUIET: "true" },
        encoding: "utf8",
      });
      result = JSON.parse(stdout.trim().split("\n").at(-1));
    } else {
      result = await loadInProcess(dir);
    }
    return {
      ...result,
      names: fs.readdirSync(dir).sort(),
      config: fs.existsSync(path.join(dir, "config.json"))
        ? JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"))
        : null,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const hot = (price) => ({ pokemon: { capture: { balls: { master: { price } } } } });

describe("reprise de config.local.json", () => {
  it("devient config.json, et ses réglages s'appliquent", async () => {
    const result = await boot({ "config.local.json": hot(1234) }, { realProcess: true });
    assert.deepEqual(result.names, ["config.json"]);
    assert.deepEqual(result.config, hot(1234));
    assert.equal(result.price, 1234);
  });

  it("recouvre l'ancien config.json versionné, dont les valeurs sont désormais dans le code", async () => {
    const result = await boot({ "config.json": hot(20000), "config.local.json": hot(1234) });
    assert.deepEqual(result.names, ["config.json"]);
    assert.equal(result.price, 1234);
  });

  it("ne touche à rien quand il n'y a pas d'ancienne surcharge", async () => {
    const result = await boot({ "config.json": hot(777) });
    assert.deepEqual(result.names, ["config.json"]);
    assert.equal(result.price, 777);
  });

  it("démarre sans aucun fichier, sur les valeurs du code", async () => {
    const result = await boot({});
    assert.deepEqual(result.names, []);
    assert.equal(result.config, null);
    assert.ok(result.price > 0);
  });
});
