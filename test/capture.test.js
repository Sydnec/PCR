// Les règles pures de la capture : probabilités, plancher du taux, difficulté,
// raretés, poids d'apparition, parc safari, générations.
//
// La génération est épinglée sur la première par une ouverture programmée dans un
// futur lointain : la 2ᵉ s'ouvre d'elle-même le 30 octobre, et un test qui
// dépendrait de l'horloge changerait de résultat ce jour-là.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createSandbox, withRandom, speciesByName } from "./helpers.js";

const sandbox = createSandbox({
  config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } },
});
const data = await import("../modules/pokemon/data.js");
const { getPokemonConfig, getSafariConfig } = await import("../modules/pokemon/config.js");

const {
  catchProbability,
  effectiveCatchRate,
  probabilitiesByBall,
  difficultyOf,
  rarityOf,
  isLegendary,
  spawnWeight,
  pickWeightedSpecies,
  evolutionChain,
  rollShiny,
  safariBaitFactor,
  safariBaitCapped,
  safariFleeChance,
  safariCatchProbability,
  safariGenerations,
  safariGenerationChoices,
  activeGeneration,
  generationOrdinal,
  allSpecies,
  lockedByDefault,
  isEvolutionOnly,
  isEggOnly,
  unobtainableMark,
} = data;
const species = (name) => speciesByName(allSpecies, name);
const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""} ${actual} ≠ ${expected}`);

// Un réglage à chaud le temps de `run`, puis la configuration d'origine : le bot
// relit le fichier à chaque accès, il n'y a rien d'autre à recharger.
const withConfig = (value, run) => {
  const before = JSON.parse(fs.readFileSync(sandbox.configFile, "utf8"));
  sandbox.writeConfig(value);
  try {
    return run();
  } finally {
    sandbox.writeConfig(before);
  }
};
// La première génération seule, quelle que soit la date du jour.
const pinned = (extra = {}) => ({
  pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" }, ...extra },
});

describe("probabilité de capture", () => {
  it("suit la formule officielle : taux × ball / 765", () => {
    near(catchProbability(45, 1, 1), 45 / 765);
    near(catchProbability(255, 2, 1), 510 / 765);
    near(catchProbability(120, 4, 1), 480 / 765);
  });

  it("reste une probabilité, quoi qu'on lui passe", () => {
    assert.equal(catchProbability(255, 255, 1), 1);
    assert.equal(catchProbability(255, 4, 100), 1);
    assert.equal(catchProbability(0, 1, 0), 0);
    assert.ok(catchProbability(-50, 1, 1) >= 0);
  });

  it("le curseur global rend tout le jeu plus ou moins dur sans changer la hiérarchie", () => {
    const easy = catchProbability(45, 1, 1);
    near(catchProbability(45, 1, 0.5), easy / 2);
    assert.ok(catchProbability(10, 1, 0.5) < catchProbability(45, 1, 0.5));
  });
});

describe("plancher du taux de capture", () => {
  it("relève un taux plus bas, sans toucher aux autres", () => {
    assert.equal(effectiveCatchRate(3), 10);
    assert.equal(effectiveCatchRate(9), 10);
    assert.equal(effectiveCatchRate(10), 10);
    assert.equal(effectiveCatchRate(45), 45);
    assert.equal(effectiveCatchRate(255), 255);
  });

  it("un légendaire à taux 3 est capturé comme un taux 10, jamais comme un taux 3", () => {
    near(catchProbability(3, 1, 1), 10 / 765);
    near(catchProbability(3, 4, 1), 40 / 765);
    assert.equal(catchProbability(3, 1, 1), catchProbability(10, 1, 1));
  });

  it("Mew (taux 45) n'est pas relevé : il n'a jamais été difficile", () => {
    assert.equal(species("Mew").catchRate, 45);
    assert.equal(effectiveCatchRate(species("Mew").catchRate), 45);
  });

  it("une valeur illisible vaut le plancher, pas NaN", () => {
    assert.equal(effectiveCatchRate(undefined), 10);
    assert.equal(effectiveCatchRate("abc"), 10);
    assert.equal(effectiveCatchRate(null), 10);
  });

  it("se règle à chaud : à 0, le taux de l'espèce s'applique tel quel", () => {
    withConfig(pinned({ capture: { minCatchRate: 0 } }), () => {
      assert.equal(effectiveCatchRate(3), 3);
      near(catchProbability(3, 1, 1), 3 / 765);
    });
    withConfig(pinned({ capture: { minCatchRate: 50 } }), () => {
      assert.equal(effectiveCatchRate(3), 50);
      assert.equal(effectiveCatchRate(45), 50);
      assert.equal(effectiveCatchRate(120), 120);
    });
  });

  it("tous les légendaires de la génération jouable sont au moins au plancher", () => {
    for (const legendary of allSpecies().filter(isLegendary)) {
      assert.ok(
        effectiveCatchRate(legendary.catchRate) >= getPokemonConfig().capture.minCatchRate,
        legendary.name
      );
    }
  });
});

describe("probabilités par ball (ce que les embeds annoncent)", () => {
  it("annonce les balls du catalogue dans l'ordre, la Master Ball étant garantie", () => {
    const balls = probabilitiesByBall(45);
    assert.deepEqual(
      balls.map((ball) => ball.key),
      Object.keys(getPokemonConfig().capture.balls)
    );
    const master = balls.find((ball) => ball.key === "master");
    assert.equal(master.probability, 1);
    assert.equal(master.guaranteed, true);
  });

  it("monte avec le multiplicateur, et reste dans [0, 1]", () => {
    const [poke, great, hyper] = probabilitiesByBall(45);
    assert.ok(poke.probability < great.probability && great.probability < hyper.probability);
    for (const ball of probabilitiesByBall(3)) {
      assert.ok(ball.probability >= 0 && ball.probability <= 1);
    }
  });

  it("annonce le même chiffre que le tirage, plancher compris", () => {
    for (const rate of [3, 10, 45, 120, 255]) {
      for (const ball of probabilitiesByBall(rate).filter((entry) => !entry.guaranteed)) {
        near(ball.probability, catchProbability(rate, ball.multiplier, 1), `taux ${rate}`);
      }
    }
  });

  it("les prix sont proportionnels : sans plafond, toutes les balls coûtent autant par capture", () => {
    const costs = probabilitiesByBall(45)
      .filter((ball) => !ball.guaranteed)
      .map((ball) => ball.price / ball.probability);
    for (const cost of costs) near(cost, costs[0], "coût espéré");
  });
});

describe("difficulté", () => {
  it("découpe aux seuils annoncés", () => {
    assert.equal(difficultyOf(255).label, "Très facile");
    assert.equal(difficultyOf(190).label, "Très facile");
    assert.equal(difficultyOf(189).label, "Facile");
    assert.equal(difficultyOf(120).label, "Facile");
    assert.equal(difficultyOf(119).label, "Moyenne");
    assert.equal(difficultyOf(60).label, "Moyenne");
    assert.equal(difficultyOf(45).label, "Difficile");
    assert.equal(difficultyOf(40).label, "Difficile");
    assert.equal(difficultyOf(39).label, "Très difficile");
    assert.equal(difficultyOf(10).label, "Très difficile");
  });

  it("passe par le plancher : un légendaire n'est plus « Extrême »", () => {
    assert.equal(difficultyOf(3).label, "Très difficile");
    withConfig(pinned({ capture: { minCatchRate: 0 } }), () => {
      assert.equal(difficultyOf(3).label, "Extrême");
    });
  });

  it("le rang va de 0 (le plus facile) à 5 (le plus dur)", () => {
    assert.equal(difficultyOf(255).level, 0);
    withConfig(pinned({ capture: { minCatchRate: 0 } }), () => {
      assert.equal(difficultyOf(1).level, 5);
    });
  });
});

describe("raretés et verrou", () => {
  it("un légendaire ou un mythique est LEGENDAIRE, sinon le stade décide", () => {
    assert.equal(rarityOf(species("Mewtwo")), "LEGENDAIRE");
    assert.equal(rarityOf(species("Mew")), "LEGENDAIRE");
    assert.equal(isLegendary(species("Mew")), true);
    assert.equal(rarityOf(species("Dracaufeu")), "RARE");
    assert.equal(rarityOf(species("Reptincel")), "PEU_COMMUN");
    assert.equal(rarityOf(species("Salamèche")), "COMMUN");
  });

  it("les shiny et les légendaires arrivent verrouillés", () => {
    assert.equal(lockedByDefault(species("Mewtwo").id, false), true);
    assert.equal(lockedByDefault(species("Salamèche").id, true), true);
    assert.equal(lockedByDefault(species("Salamèche").id, false), false);
  });
});

describe("poids d'apparition", () => {
  const spawn = () => getPokemonConfig().spawn;

  it("suit le stade, et le poids propre des légendaires", () => {
    assert.equal(spawnWeight(species("Salamèche"), spawn()), spawn().weightsByStage[1]);
    assert.equal(spawnWeight(species("Reptincel"), spawn()), spawn().weightsByStage[2]);
    assert.equal(spawnWeight(species("Dracaufeu"), spawn()), spawn().weightsByStage[3]);
    assert.equal(spawnWeight(species("Mewtwo"), spawn()), spawn().legendaryWeight);
  });

  it("les évolutions par échange ne se croisent jamais à l'état sauvage", () => {
    for (const name of ["Alakazam", "Mackogneur", "Grolem", "Ectoplasma"]) {
      assert.equal(spawnWeight(species(name), spawn()), 0, name);
      assert.equal(isEvolutionOnly(species(name)), true, name);
      assert.equal(unobtainableMark(species(name)), "\u{1F512}", name);
    }
  });

  it("une espèce qu'un objet est seul à donner est hors du pool, même quand la génération s'ouvre", () => {
    const itemOnly = data.itemOnlySpecies();
    for (const id of itemOnly) {
      const target = data.getSpecies(id);
      assert.equal(spawnWeight(target, spawn(), itemOnly), 0, target.name);
    }
  });

  it("l'apparition ne tire que des espèces au poids positif, et dans toute la plage", () => {
    const itemOnly = data.itemOnlySpecies();
    const seen = new Set();
    for (let i = 0; i < 4000; i++) {
      const picked = pickWeightedSpecies(spawn());
      assert.ok(spawnWeight(picked, spawn(), itemOnly) > 0, picked.name);
      seen.add(picked.id);
    }
    assert.ok(seen.size > 100, `seulement ${seen.size} espèces vues`);
  });

  it("les extrémités du tirage sont la première et la dernière espèce du pool", () => {
    const itemOnly = data.itemOnlySpecies();
    const pool = allSpecies().filter((entry) => spawnWeight(entry, spawn(), itemOnly) > 0);
    assert.equal(withRandom(0, () => pickWeightedSpecies(spawn())).id, pool[0].id);
    assert.equal(withRandom(0.9999999, () => pickWeightedSpecies(spawn())).id, pool.at(-1).id);
  });

  it("un pool vide ne donne rien plutôt que de planter", () => {
    const empty = { ...spawn(), weightsByStage: {}, legendaryWeight: 0 };
    assert.equal(pickWeightedSpecies(empty), null);
  });

  it("la part des légendaires suit leur poids", () => {
    const itemOnly = data.itemOnlySpecies();
    let total = 0;
    let legendary = 0;
    for (const entry of allSpecies()) {
      const weight = spawnWeight(entry, spawn(), itemOnly);
      total += weight;
      if (isLegendary(entry)) legendary += weight;
    }
    assert.ok(legendary / total > 0 && legendary / total < 0.1);
  });
});

describe("lignées", () => {
  it("donne la lignée entière, quel que soit le maillon d'où l'on part", () => {
    const ids = (name) => evolutionChain(species(name)).map((link) => link.id);
    const full = [species("Bulbizarre").id, species("Herbizarre").id, species("Florizarre").id];
    assert.deepEqual(ids("Bulbizarre"), full);
    assert.deepEqual(ids("Herbizarre"), full);
    assert.deepEqual(ids("Florizarre"), full);
  });

  it("un embranchement montre toutes ses cibles", () => {
    const names = evolutionChain(species("Évoli")).map((link) => link.name);
    assert.deepEqual(names, ["Évoli", "Aquali", "Voltali", "Pyroli"]);
  });

  it("une espèce seule est sa propre lignée", () => {
    assert.deepEqual(
      evolutionChain(species("Tauros")).map((link) => link.name),
      ["Tauros"]
    );
  });
});

describe("shiny", () => {
  it("un tirage sous 1 est shiny, entre 1 et le facteur du charme il l'est pour les porteurs", () => {
    assert.deepEqual(withRandom(0, () => rollShiny(500)), { shiny: true, charm: false });
    assert.deepEqual(withRandom(1.5 / 500, () => rollShiny(500)), { shiny: false, charm: true });
    assert.deepEqual(withRandom(0.5, () => rollShiny(500)), { shiny: false, charm: false });
  });

  it("1 chance sur 1 rend tout shiny : c'est pourquoi /admin config refuse de descendre sous 1", () => {
    assert.equal(withRandom(0.999, () => rollShiny(1)).shiny, true);
    assert.equal(withRandom(0.999, () => rollShiny(2)).shiny, false);
  });
});

describe("parc safari", () => {
  const safari = () => getSafariConfig();

  it("l'appât est multiplicatif et plafonné : deux appâts suffisent", () => {
    assert.equal(safariBaitFactor(0, safari()), 1);
    assert.equal(safariBaitFactor(1, safari()), safari().baitMultiplier);
    assert.equal(safariBaitFactor(2, safari()), safari().baitMaxMultiplier);
    assert.equal(safariBaitFactor(3, safari()), safari().baitMaxMultiplier);
    assert.equal(safariBaitCapped(1, safari()), false);
    assert.equal(safariBaitCapped(2, safari()), true);
  });

  it("des appâts négatifs ou illisibles comptent pour zéro", () => {
    assert.equal(safariBaitFactor(-4, safari()), 1);
    assert.equal(safariBaitFactor("x", safari()), 1);
    assert.equal(safariFleeChance(-4, safari()), safari().wildFleeChance);
  });

  it("la nervosité monte d'un cran par baie, et reste une probabilité", () => {
    near(safariFleeChance(0, safari()), safari().wildFleeChance);
    near(safariFleeChance(1, safari()), safari().wildFleeChance + safari().wildFleeChancePerBait);
    near(safariFleeChance(2, safari()), safari().wildFleeChance + 2 * safari().wildFleeChancePerBait);
    assert.equal(safariFleeChance(1000, safari()), 1);
  });

  it("la capture au parc part du même plancher, puis la Safari Ball et l'appât multiplient", () => {
    const ball = safari().ball.multiplier;
    near(safariCatchProbability(3, 0, safari()), (10 * ball) / 765);
    near(safariCatchProbability(3, 2, safari()), (10 * ball * safari().baitMaxMultiplier) / 765);
    near(safariCatchProbability(45, 1, safari()), (45 * ball * safari().baitMultiplier) / 765);
  });

  it("l'appât n'améliore jamais une probabilité au-delà de 1", () => {
    assert.ok(safariCatchProbability(255, 2, safari()) <= 1);
  });

  it("les générations visées se nettoient : ouvertes, sans doublon, ou toutes", () => {
    assert.equal(activeGeneration(), 1);
    assert.equal(safariGenerations("1"), null, "toutes quand une seule est ouverte");
    assert.equal(safariGenerations([]), null);
    assert.equal(safariGenerations("abc"), null);
    assert.equal(safariGenerations(null), null);
  });

  it("propose les générations ouvertes, avec le nombre d'espèces que le parc y croise", () => {
    const choices = safariGenerationChoices();
    assert.equal(choices.length, 1);
    assert.equal(choices[0].generation, 1);
    assert.equal(choices[0].ordinal, "1re");
    assert.ok(choices[0].species > 100);
  });
});

describe("générations", () => {
  it("nomme les générations en français", () => {
    assert.equal(generationOrdinal(1), "1re");
    assert.equal(generationOrdinal(2), "2e");
  });

  it("la 2ᵉ s'ouvre d'elle-même à sa date, sans redémarrage", () => {
    withConfig({ pokemon: { generationOpenings: { 2: "2026-10-30T18:00:00+01:00" } } }, () => {
      assert.equal(activeGeneration(Date.parse("2026-10-30T17:59:59+01:00")), 1);
      assert.equal(activeGeneration(Date.parse("2026-10-30T18:00:00+01:00")), 2);
      assert.equal(activeGeneration(Date.parse("2027-01-01T00:00:00+01:00")), 2);
    });
  });

  it("le réglage de génération ouvre tout de suite, la plus haute des deux l'emporte", () => {
    withConfig({ pokemon: { generation: 2, generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } }, () => {
      assert.equal(activeGeneration(), 2);
    });
  });

  it("une faute de frappe ne vide pas le Pokédex ni ne promet des espèces absentes", () => {
    withConfig(pinned({ generation: 99 }), () => {
      assert.equal(activeGeneration(), 2);
    });
    withConfig(pinned({ generation: -3 }), () => {
      assert.equal(activeGeneration(), 1);
    });
    withConfig(pinned({ generation: "abc" }), () => {
      assert.equal(activeGeneration(), 1);
    });
  });

  it("les espèces des générations fermées n'apparaissent dans aucune énumération", () => {
    assert.ok(allSpecies().every((entry) => entry.generation === 1));
    assert.equal(data.dexSize(), allSpecies().length);
    assert.ok(data.getSpecies(species("Mewtwo").id));
    assert.equal(data.getAvailableSpecies(250), null, "Ho-Oh (2ᵉ génération) est fermé");
    assert.ok(data.getSpecies(250), "mais sa lecture brute reste possible : une collection le garde");
  });

  it("aucun bébé n'est jouable en première génération", () => {
    assert.ok(allSpecies().every((entry) => !isEggOnly(entry)));
  });
});
