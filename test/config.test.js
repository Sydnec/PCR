// La configuration : les valeurs de base viennent du code (DEFAULTS), config.json
// n'est que l'ajustement à chaud, et /admin config n'écrit que dans celui-ci.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createSandbox } from "./helpers.js";

const sandbox = createSandbox();
const {
  DEFAULTS,
  getConfig,
  readConfigValue,
  writeConfigValue,
  configOverrideStatus,
  listConfigPaths,
  previewConfigValue,
} = await import("../modules/config.js");

const onDisk = () => JSON.parse(fs.readFileSync(sandbox.configFile, "utf8"));

describe("lecture", () => {
  beforeEach(() => sandbox.removeConfig());

  it("sans config.json, tout vient du code", () => {
    assert.deepEqual(JSON.parse(JSON.stringify(getConfig())), JSON.parse(JSON.stringify(DEFAULTS)));
    assert.deepEqual(configOverrideStatus(), { ok: true, exists: false });
  });

  it("un réglage à chaud ne remplace que sa clé, le reste retombe sur le code", () => {
    sandbox.writeConfig({ pokemon: { capture: { balls: { master: { price: 1234 } } } } });
    const balls = getConfig().pokemon.capture.balls;
    assert.equal(balls.master.price, 1234);
    assert.equal(balls.master.multiplier, DEFAULTS.pokemon.capture.balls.master.multiplier);
    assert.equal(balls.poke.price, DEFAULTS.pokemon.capture.balls.poke.price);
    assert.equal(getConfig().pokemon.spawn.messagesPerSpawn, DEFAULTS.pokemon.spawn.messagesPerSpawn);
  });

  it("est relu à chaque accès, sans redémarrage", () => {
    sandbox.writeConfig({ pokemon: { lottery: { winChance: 0.1 } } });
    assert.equal(getConfig().pokemon.lottery.winChance, 0.1);
    sandbox.writeConfig({ pokemon: { lottery: { winChance: 0.9 } } });
    assert.equal(getConfig().pokemon.lottery.winChance, 0.9);
    sandbox.removeConfig();
    assert.equal(getConfig().pokemon.lottery.winChance, DEFAULTS.pokemon.lottery.winChance);
  });

  it("ne laisse pas une clé « __proto__ » polluer les objets", () => {
    sandbox.writeRaw('{ "__proto__": { "pollue": true }, "pokemon": { "constructor": { "x": 1 } } }');
    const config = getConfig();
    assert.equal({}.pollue, undefined);
    assert.equal(config.pollue, undefined);
    assert.notEqual(Object.getPrototypeOf(config.pokemon), null);
    assert.equal(typeof config.pokemon.constructor, "function");
  });

  it("un fichier illisible retombe sur le code, et le dit", () => {
    sandbox.writeRaw("{ pas du json");
    assert.equal(getConfig().pokemon.capture.balls.master.price, DEFAULTS.pokemon.capture.balls.master.price);
    const status = configOverrideStatus();
    assert.equal(status.ok, false);
    assert.equal(status.exists, true);
    assert.match(status.reason, /illisible/);
  });

  it("un fichier lisible est annoncé comme tel", () => {
    sandbox.writeConfig({});
    assert.deepEqual(configOverrideStatus(), { ok: true, exists: true });
  });
});

describe("lecture d'un réglage", () => {
  beforeEach(() => sandbox.removeConfig());

  it("donne la valeur courante, celle du code et le type", () => {
    sandbox.writeConfig({ pokemon: { capture: { throwCooldownSeconds: 9 } } });
    const read = readConfigValue("pokemon.capture.throwCooldownSeconds");
    assert.equal(read.ok, true);
    assert.equal(read.type, "nombre");
    assert.equal(read.current, 9);
    assert.equal(read.fallback, DEFAULTS.pokemon.capture.throwCooldownSeconds);
  });

  it("une clé inconnue n'existe pas : le schéma est DEFAULTS", () => {
    const read = readConfigValue("pokemon.nimportequoi");
    assert.equal(read.ok, false);
    assert.match(read.reason, /inconnu/i);
  });

  it("une branche se lit en bloc", () => {
    const read = readConfigValue("pokemon.capture.balls.master");
    assert.equal(read.ok, true);
    assert.equal(read.type, "objet");
  });

  it("liste les chemins modifiables, filtrés, sans les nœuds intermédiaires", () => {
    const paths = listConfigPaths("minCatchRate").map((entry) => entry.path);
    assert.deepEqual(paths, ["pokemon.capture.minCatchRate"]);
    assert.ok(!listConfigPaths().some((entry) => entry.path === "pokemon.capture"));
  });
});

describe("écriture (/admin config)", () => {
  beforeEach(() => sandbox.removeConfig());

  it("n'écrit que la valeur changée, jamais les défauts", () => {
    const result = writeConfigValue("pokemon.capture.throwCooldownSeconds", "7");
    assert.deepEqual(result, {
      ok: true,
      path: "pokemon.capture.throwCooldownSeconds",
      before: DEFAULTS.pokemon.capture.throwCooldownSeconds,
      after: 7,
    });
    assert.deepEqual(onDisk(), { pokemon: { capture: { throwCooldownSeconds: 7 } } });
    assert.equal(getConfig().pokemon.capture.throwCooldownSeconds, 7);
  });

  it("garde les réglages déjà posés", () => {
    writeConfigValue("pokemon.capture.throwCooldownSeconds", "7");
    writeConfigValue("pokemon.lottery.winChance", "0,5");
    assert.deepEqual(onDisk(), {
      pokemon: { capture: { throwCooldownSeconds: 7 }, lottery: { winChance: 0.5 } },
    });
  });

  it("ne laisse aucun fichier temporaire derrière lui", () => {
    writeConfigValue("pokemon.capture.throwCooldownSeconds", "7");
    assert.deepEqual(
      fs.readdirSync(sandbox.dir).filter((name) => name.includes("tmp")),
      []
    );
  });

  it("impose le type de la valeur par défaut", () => {
    assert.equal(writeConfigValue("pokemon.lottery.winChance", "beaucoup").ok, false);
    assert.equal(writeConfigValue("pokemon.lottery.enabled", "peut-être").ok, false);
    assert.equal(writeConfigValue("pokemon.lottery.enabled", "non").after, false);
    assert.equal(writeConfigValue("pokemon.lottery.enabled", "oui").after, true);
    assert.deepEqual(
      writeConfigValue("pokemon.spawn.pingRarities", "RARE, LEGENDAIRE").after,
      ["RARE", "LEGENDAIRE"]
    );
    assert.equal(writeConfigValue("pokemon.spawn.pingRarities", " , ").ok, false);
  });

  it("refuse une clé inconnue, une branche et un chemin interdit sans toucher au fichier", () => {
    assert.equal(writeConfigValue("pokemon.nimportequoi", "1").ok, false);
    assert.equal(writeConfigValue("pokemon.capture.balls", "1").ok, false);
    assert.equal(writeConfigValue("pokemon.__proto__.x", "1").ok, false);
    assert.equal(writeConfigValue("", "1").ok, false);
    assert.equal(fs.existsSync(sandbox.configFile), false);
  });

  it("refuse les valeurs hors bornes : une faute de frappe ne se rattrape pas", () => {
    assert.equal(writeConfigValue("redistribution.contributionPercent", "101").ok, false);
    assert.equal(writeConfigValue("redistribution.contributionPercent", "-1").ok, false);
    assert.equal(writeConfigValue("pokemon.spawn.shinyOdds", "0").ok, false);
    assert.equal(writeConfigValue("pokemon.box.pageSize", "99").ok, false);
    assert.equal(fs.existsSync(sandbox.configFile), false);
  });

  it("borne le plancher de capture et le facteur de fuite des légendaires", () => {
    assert.equal(writeConfigValue("pokemon.capture.minCatchRate", "300").ok, false);
    assert.equal(writeConfigValue("pokemon.capture.minCatchRate", "-5").ok, false);
    assert.equal(writeConfigValue("pokemon.capture.minCatchRate", "0").ok, true);
    assert.equal(writeConfigValue("pokemon.capture.minCatchRate", "255").ok, true);
    assert.equal(writeConfigValue("pokemon.spawn.legendaryFleeMultiplier", "0,5").ok, false);
    assert.equal(writeConfigValue("pokemon.spawn.legendaryFleeMultiplier", "0").ok, false);
    assert.equal(writeConfigValue("pokemon.spawn.legendaryFleeMultiplier", "3").ok, true);
  });

  it("refuse une majoration des générations récentes sous 1 : elle favoriserait les anciennes", () => {
    const refused = writeConfigValue("pokemon.spawn.generationBoost", "0,5");
    assert.equal(refused.ok, false);
    assert.match(refused.reason, /en dessous du minimum autorisé \(1\)/);
    assert.equal(writeConfigValue("pokemon.spawn.generationBoost", "0").ok, false);
    assert.equal(fs.existsSync(sandbox.configFile), false, "rien n'est écrit après un refus");
    assert.equal(writeConfigValue("pokemon.spawn.generationBoost", "1").ok, true);
    assert.equal(writeConfigValue("pokemon.spawn.generationBoost", "2,5").ok, true);
    assert.equal(getConfig().pokemon.spawn.generationBoost, 2.5);
  });

  it("refuse une progression de la Master Ball sous 1 : chaque achat coûterait moins que le précédent", () => {
    const refused = writeConfigValue("pokemon.capture.balls.master.priceGrowth", "0,9");
    assert.equal(refused.ok, false);
    assert.match(refused.reason, /en dessous du minimum autorisé \(1\)/);
    assert.equal(fs.existsSync(sandbox.configFile), false, "rien n'est écrit après un refus");
    assert.equal(writeConfigValue("pokemon.capture.balls.master.priceGrowth", "1").ok, true, "1 : prix fixe");
    assert.equal(writeConfigValue("pokemon.capture.balls.master.priceGrowth", "1,5").ok, true);
    assert.equal(getConfig().pokemon.capture.balls.master.priceGrowth, 1.5);
  });

  it("exige une date ISO complète, fuseau compris, pour ouvrir une génération", () => {
    for (const bad of ["2", "demain", "2026-10-30", "2026-10-30T18:00:00"]) {
      assert.equal(
        writeConfigValue("pokemon.generationOpenings.2", bad).ok,
        false,
        `« ${bad} » devrait être refusée`
      );
    }
    assert.equal(
      writeConfigValue("pokemon.generationOpenings.2", "2026-10-30T18:00:00+01:00").ok,
      true
    );
  });

  it("ne rouvre pas la génération au-delà de ce que contient le jeu de données", () => {
    assert.equal(writeConfigValue("pokemon.generation", "99").ok, false);
    assert.equal(writeConfigValue("pokemon.generation", "2").ok, true);
  });

  it("échoue plutôt que d'effacer des réglages quand le fichier est illisible", () => {
    sandbox.writeRaw("{ cassé");
    const result = writeConfigValue("pokemon.capture.throwCooldownSeconds", "7");
    assert.equal(result.ok, false);
    assert.match(result.reason, /illisible/);
    assert.equal(fs.readFileSync(sandbox.configFile, "utf8"), "{ cassé");
  });
});

describe("rendu", () => {
  it("aperçoit une valeur sur une ligne", () => {
    assert.equal(previewConfigValue(5), "5");
    assert.equal(previewConfigValue(true), "true");
    assert.equal(previewConfigValue(["RARE", "LEGENDAIRE"]), "RARE, LEGENDAIRE");
  });
});

describe("cohérence de DEFAULTS", () => {
  const { pokemon } = DEFAULTS;

  it("chaque ball a un prix, un multiplicateur et un emoji ; une seule garantit la capture", () => {
    const balls = Object.entries(pokemon.capture.balls);
    for (const [key, ball] of balls) {
      assert.ok(ball.price > 0, `${key} : prix`);
      assert.ok(ball.multiplier > 0, `${key} : multiplicateur`);
      assert.ok(ball.emoji, `${key} : emoji`);
    }
    assert.deepEqual(
      balls.filter(([, ball]) => ball.guaranteed).map(([key]) => key),
      ["master"]
    );
  });

  it("les balls montent en prix avec leur multiplicateur", () => {
    const { poke, super: great, hyper } = pokemon.capture.balls;
    assert.ok(poke.price < great.price && great.price < hyper.price);
    assert.ok(poke.multiplier < great.multiplier && great.multiplier < hyper.multiplier);
  });

  it("le plancher de capture est un taux valide (0 à 255)", () => {
    assert.ok(pokemon.capture.minCatchRate >= 0 && pokemon.capture.minCatchRate <= 255);
  });

  it("un légendaire ne reste pas moins longtemps qu'un Pokémon ordinaire", () => {
    assert.ok(pokemon.spawn.legendaryFleeMultiplier >= 1);
    const { min, max } = pokemon.spawn.fleeAfterMinutes;
    assert.ok(min > 0 && max >= min);
  });

  it("tout objet-ball du catalogue pointe vers une ball qui existe", () => {
    for (const [key, item] of Object.entries(pokemon.items)) {
      if (item.ball) assert.ok(pokemon.capture.balls[item.ball], `${key} → ${item.ball}`);
    }
  });

  it("un objet qui tombe ou se gagne a un poids positif", () => {
    for (const [key, item] of Object.entries(pokemon.items)) {
      if (item.dropWeight !== undefined) assert.ok(item.dropWeight > 0, `${key} : dropWeight`);
      if (item.lotteryWeight !== undefined) assert.ok(item.lotteryWeight > 0, `${key} : lotteryWeight`);
      if (item.lot) assert.ok(item.lot.min >= 1 && item.lot.max >= item.lot.min, `${key} : lot`);
      if (item.sellValue !== undefined) assert.ok(item.sellValue > 0, `${key} : sellValue`);
    }
  });

  it("les probabilités du jeu sont des probabilités", () => {
    const { lottery, spawn } = pokemon;
    for (const value of [lottery.winChance, lottery.lotDecay, spawn.heldItemChance, spawn.itemDropChance]) {
      assert.ok(value > 0 && value <= 1);
    }
  });

  it("les paliers de points des messages sont décroissants et ont un repli", () => {
    const { messagePointsDistribution: distribution } = DEFAULTS;
    assert.ok(distribution.default > 0);
    const ranks = Object.keys(distribution)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => a - b)
      .map((key) => distribution[key]);
    for (let i = 1; i < ranks.length; i++) assert.ok(ranks[i] <= ranks[i - 1]);
  });

  it("le fichier du jeu de données se trouve à côté du module", () => {
    assert.ok(fs.existsSync(path.join(import.meta.dirname, "..", "modules", "pokemon-data.json")));
  });
});
