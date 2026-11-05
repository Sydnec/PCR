// `pcr deploy`, lancé par les workflows de déploiement (la prod sur un tag, le bot
// de test sur un push de development). Il installe avec npm ci, qui vide
// node_modules d'abord : recharger PM2 après une installation ratée relancerait
// le bot sans ses dépendances. Le script tourne pour de vrai, avec de faux npm,
// pm2 et git placés en tête du PATH qui notent seulement leurs appels : aucune
// installation, aucun processus touché.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.join(import.meta.dirname, "..", "pcr");

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-deploy-"));
  fs.mkdirSync(path.join(dir, "bin"));
  for (const tool of ["npm", "pm2", "git"]) {
    const stub = path.join(dir, "bin", tool);
    fs.writeFileSync(stub, `#!/bin/bash\necho "${tool} $*" >> "$PCR_CALLS"\n[ "$1" = "ci" ] && exit "\${NPM_CI_STATUS:-0}"\nexit 0\n`);
    fs.chmodSync(stub, 0o755);
  }
  // Deux dossiers de bot, comme sur le serveur : la prod et le bot de test.
  for (const bot of ["pcr", "pcr-test"]) {
    fs.mkdirSync(path.join(dir, bot));
    fs.writeFileSync(path.join(dir, bot, "package.json"), JSON.stringify({ name: "pcr" }, null, 2));
  }
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function run(command, npmCiStatus = 0, folder = "pcr") {
  const calls = path.join(dir, "calls.log");
  const result = spawnSync("bash", [SCRIPT, command], {
    cwd: path.join(dir, folder),
    env: { ...process.env, PATH: `${path.join(dir, "bin")}:${process.env.PATH}`, PCR_CALLS: calls, NPM_CI_STATUS: String(npmCiStatus) },
    encoding: "utf8",
  });
  const log = fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n") : [];
  return { status: result.status, output: result.stdout + result.stderr, calls: log };
}

describe("pcr deploy", () => {
  it("installe exactement le lockfile (npm ci), puis recharge et sauvegarde PM2", () => {
    const { status, calls } = run("deploy", 0);
    assert.equal(status, 0);
    assert.deepEqual(calls, ["npm ci", "pm2 describe PCR", "pm2 reload PCR --update-env", "pm2 save"]);
  });

  it("un npm ci en échec arrête le déploiement en erreur, sans toucher à PM2", () => {
    const { status, output, calls } = run("deploy", 1);
    assert.equal(status, 1, "le workflow (set -e) doit voir l'échec");
    assert.match(output, /npm ci a échoué/);
    assert.deepEqual(calls, ["npm ci"]);
  });

  it("pcr update ne se dit pas terminé après un déploiement raté", () => {
    const { status, output, calls } = run("update", 1);
    assert.equal(status, 1);
    assert.doesNotMatch(output, /Mise à jour terminée/);
    assert.deepEqual(calls, ["git pull", "npm ci"]);
  });
});

describe("pcr : le bot visé est celui du dossier", () => {
  it("le dossier pcr-test déploie le process PCR-TEST, sans toucher à PCR", () => {
    const { status, calls } = run("deploy", 0, "pcr-test");
    assert.equal(status, 0);
    assert.deepEqual(calls, ["npm ci", "pm2 describe PCR-TEST", "pm2 reload PCR-TEST --update-env", "pm2 save"]);
  });

  it("un redémarrage depuis le dossier de test ne vise que le bot de test", () => {
    const { status, calls } = run("restart", 0, "pcr-test");
    assert.equal(status, 0);
    assert.deepEqual(calls, ["pm2 restart PCR-TEST"]);
  });

  it("hors du dossier d'un bot, pcr refuse et n'appelle ni PM2 ni npm", () => {
    const { status, output, calls } = run("restart", 0, "bin");
    assert.equal(status, 1);
    assert.match(output, /depuis le dossier d'un bot PCR/);
    assert.deepEqual(calls, []);
  });
});
