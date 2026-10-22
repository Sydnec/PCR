// `pcr deploy`, lancé par le workflow de déploiement sur chaque tag. Il installe
// avec npm ci, qui vide node_modules d'abord : recharger PM2 après une
// installation ratée relancerait le bot sans ses dépendances. Le script tourne
// pour de vrai, avec de faux npm, pm2 et git placés en tête du PATH qui notent
// seulement leurs appels : aucune installation, aucun processus touché.
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
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function run(command, npmCiStatus) {
  const calls = path.join(dir, "calls.log");
  const result = spawnSync("bash", [SCRIPT, command], {
    cwd: dir,
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
