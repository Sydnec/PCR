// La génération 2, qui s'ouvre d'elle-même le 30 octobre à 18 h (heure de Paris).
//
// Tout ce fichier tourne avec la 2ᵉ génération OUVERTE : on y vérifie que les
// données sont cohérentes, que chaque espèce est obtenable, que rien ne plante en
// l'affichant, et que ce qui change à l'ouverture — œufs, objets, charme, parc
// safari — se comporte comme la doc le promet. Un plantage ici serait un plantage
// devant tous les joueurs, à l'heure dite.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, dbRun, dbGet, dbAll, withRandom, speciesByName } from "./helpers.js";

const GEN1_ONLY = { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } };
const GEN2 = { pokemon: { generation: 2 } };
const sandbox = createSandbox({ config: GEN2 });
process.env.POKEMON_CHANNEL_ID = "123";
const { points } = await openDatabases();

const data = await import("../modules/pokemon/data.js");
const { getPokemonConfig, getSafariConfig } = await import("../modules/pokemon/config.js");
const items = await import("../modules/pokemon/items.js");
const charms = await import("../modules/pokemon/charms.js");
const eggs = await import("../modules/pokemon/eggs.js");
const collection = await import("../modules/pokemon/collection.js");
const generations = await import("../modules/pokemon/generations.js");
const embeds = await import("../modules/pokemon/embeds.js");
const lottery = await import("../modules/pokemon/lottery.js");
const economy = await import("../modules/economy.js");
const { routes } = await import("../modules/web/api.js");

const call = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value))));
const species = (name) => speciesByName(data.allSpecies, name);
const all = () => data.allSpecies();
const gen2 = () => all().filter((entry) => entry.generation === 2);
const asGen1 = (run) => {
  sandbox.writeConfig(GEN1_ONLY);
  try {
    return run();
  } finally {
    sandbox.writeConfig(GEN2);
  }
};
const near = (a, b, message = "") => assert.ok(Math.abs(a - b) < 1e-9, `${message} ${a} ≠ ${b}`);

describe("jeu de données", () => {
  it("la génération jouable est la 2ᵉ, avec les 251 espèces numérotées sans trou", () => {
    assert.equal(data.activeGeneration(), 2);
    assert.equal(all().length, 251);
    all().forEach((entry, index) => assert.equal(entry.id, index + 1));
    assert.equal(gen2().length, 100);
  });

  it("chaque espèce a de quoi s'afficher : nom, types, stade, taux de capture", () => {
    for (const entry of all()) {
      assert.ok(entry.name, `#${entry.id} sans nom`);
      assert.ok(entry.types?.length >= 1 && entry.types.length <= 2, `${entry.name} : types`);
      assert.ok([1, 2, 3].includes(entry.stage), `${entry.name} : stade ${entry.stage}`);
      assert.ok(Number.isFinite(entry.catchRate) && entry.catchRate > 0 && entry.catchRate <= 255, `${entry.name} : taux`);
      assert.ok([1, 2].includes(entry.generation), `${entry.name} : génération`);
      assert.ok(data.spriteUrl(entry, false) && data.spriteUrl(entry, true), `${entry.name} : image`);
      assert.ok(data.iconUrl(entry, false) && data.iconUrl(entry, true), `${entry.name} : icône`);
    }
  });

  it("chaque lignée est bien formée : l'espèce y figure, de n'importe quel maillon on retrouve la même", () => {
    for (const entry of all()) {
      if (entry.evolvesFrom) assert.ok(data.getSpecies(entry.evolvesFrom), `${entry.name} évolue d'une espèce inconnue`);
      const chain = data.evolutionChain(entry);
      assert.ok(chain.some((link) => link.id === entry.id), `${entry.name} absent de sa lignée`);
      const ids = chain.map((link) => link.id).sort((a, b) => a - b);
      assert.equal(new Set(ids).size, ids.length, `${entry.name} : doublon dans la lignée`);
      for (const link of chain) {
        const again = data.evolutionChain(link).map((other) => other.id).sort((a, b) => a - b);
        assert.deepEqual(again, ids, `${entry.name} / ${link.name}`);
      }
    }
  });

  it("une évolution ne remonte jamais le stade, et mène à une espèce de la même génération ou plus récente", () => {
    for (const entry of all()) {
      for (const target of data.evolutionTargets(entry)) {
        assert.ok(target.stage >= entry.stage, `${entry.name} → ${target.name}`);
        assert.ok(target.generation >= entry.generation || entry.isBaby, `${entry.name} → ${target.name}`);
      }
    }
  });

  it("les huit bébés de la 2ᵉ génération, et eux seulement, sont de stade 1 et flagués bébés", () => {
    const babies = all().filter((entry) => entry.isBaby).map((entry) => entry.name);
    assert.deepEqual(
      babies.sort(),
      ["Debugant", "Élekid", "Lippouti", "Magby", "Mélo", "Pichu", "Togepi", "Toudoudou"].sort()
    );
    assert.ok(all().filter((entry) => entry.isBaby).every((entry) => entry.stage === 1 && entry.generation === 2));
  });

  it("les légendaires et le mythique de la 2ᵉ génération", () => {
    const names = gen2().filter(data.isLegendary).map((entry) => entry.name);
    assert.deepEqual(names.sort(), ["Celebi", "Entei", "Ho-Oh", "Lugia", "Raikou", "Suicune"].sort());
    assert.equal(data.rarityOf(species("Celebi")), "LEGENDAIRE");
  });
});

describe("apparitions", () => {
  const spawn = () => getPokemonConfig().spawn;

  it("les bébés ne sortent que d'un œuf : poids nul à l'état sauvage comme au parc", () => {
    for (const baby of all().filter((entry) => entry.isBaby)) {
      assert.equal(data.spawnWeight(baby, spawn()), 0, baby.name);
      assert.equal(data.spawnWeight(baby, getSafariConfig()), 0, baby.name);
      assert.equal(data.isEggOnly(baby), true);
      assert.equal(data.unobtainableMark(baby), "\u{1F95A}");
    }
  });

  it("les sept formes qu'un objet est seul à donner ne se croisent pas", () => {
    const names = [...data.itemOnlySpecies()].map((id) => data.getSpecies(id).name).sort();
    assert.deepEqual(names, ["Cizayox", "Hyporoi", "Joliflor", "Porygon2", "Roigada", "Steelix", "Tarpaud"].sort());
    for (const name of names) {
      assert.equal(data.spawnWeight(species(name), spawn()), 0, name);
      assert.equal(data.isEvolutionOnly(species(name)), true, name);
    }
  });

  it("toute espèce est obtenable : à l'état sauvage, par évolution, par échange ou par un œuf", () => {
    const itemOnly = data.itemOnlySpecies();
    const unreachable = all().filter(
      (entry) =>
        data.spawnWeight(entry, spawn(), itemOnly) <= 0 &&
        !entry.isBaby &&
        !entry.evolvesFrom &&
        !entry.tradeEvolution
    );
    assert.deepEqual(unreachable.map((entry) => entry.name), []);
  });

  it("toute évolution a un parent qu'on peut croiser ou obtenir : la lignée ne boucle sur rien d'introuvable", () => {
    const itemOnly = data.itemOnlySpecies();
    for (const entry of all().filter((candidate) => data.spawnWeight(candidate, spawn(), itemOnly) <= 0 && !candidate.isBaby)) {
      let current = entry;
      const seen = new Set();
      while (data.spawnWeight(current, spawn(), itemOnly) <= 0 && current.evolvesFrom && !seen.has(current.id)) {
        seen.add(current.id);
        current = data.getSpecies(current.evolvesFrom);
      }
      const reachable = data.spawnWeight(current, spawn(), itemOnly) > 0 || current.isBaby;
      assert.ok(reachable, `${entry.name} : sa lignée ne mène à rien d'obtenable (${current.name})`);
    }
  });

  it("l'apparition tire des espèces de la 2ᵉ génération, jamais un bébé ni une forme d'objet", () => {
    const itemOnly = data.itemOnlySpecies();
    const seen = new Set();
    for (let i = 0; i < 6000; i++) {
      const picked = data.pickWeightedSpecies(spawn());
      assert.ok(data.spawnWeight(picked, spawn(), itemOnly) > 0, picked.name);
      seen.add(picked.generation);
    }
    assert.deepEqual([...seen].sort(), [1, 2]);
  });

  it("les raretés de la 1ʳᵉ génération ne bougent pas : Pikachu reste commun, Raichu peu commun", () => {
    assert.equal(data.rarityOf(species("Pikachu")), "COMMUN");
    assert.equal(data.rarityOf(species("Raichu")), "PEU_COMMUN");
    assert.equal(data.rarityOf(species("Pichu")), "COMMUN", "un bébé est de stade 1");
  });

  it("la 1ʳᵉ génération garde exactement ses chances d'apparaître : seul le total grandit", () => {
    const itemOnly = data.itemOnlySpecies();
    const weights = () => all().map((entry) => data.spawnWeight(entry, spawn(), itemOnly));
    const withGen2 = weights();
    const onlyGen1 = asGen1(() => weights());
    assert.deepEqual(withGen2.slice(0, 151), onlyGen1, "le poids d'une espèce de la 1ʳᵉ génération ne dépend pas de la 2ᵉ");
  });
});

describe("légendaires et plancher du taux de capture", () => {
  it("les cinq légendaires à taux 3 de la 2ᵉ génération sont relevés à 10, Celebi (45) ne l'est pas", () => {
    for (const name of ["Raikou", "Entei", "Suicune", "Lugia", "Ho-Oh"]) {
      assert.equal(species(name).catchRate, 3, name);
      assert.equal(data.effectiveCatchRate(species(name).catchRate), 10, name);
      assert.equal(data.difficultyOf(species(name).catchRate).label, "Très difficile", name);
    }
    assert.equal(data.effectiveCatchRate(species("Celebi").catchRate), 45);
  });

  it("le plancher ne touche que des légendaires : aucun autre Pokémon n'est sous 10", () => {
    const underFloor = all().filter((entry) => entry.catchRate < 10);
    assert.ok(underFloor.length > 0 && underFloor.every(data.isLegendary), underFloor.filter((e) => !data.isLegendary(e)).map((e) => e.name).join(", "));
  });

  it("chaque probabilité annoncée, pour toute espèce et toute ball, est une probabilité", () => {
    for (const entry of all()) {
      for (const ball of data.probabilitiesByBall(entry.catchRate)) {
        assert.ok(ball.probability > 0 && ball.probability <= 1, `${entry.name} / ${ball.key}`);
      }
      const safari = data.safariCatchProbability(entry.catchRate, 2, getSafariConfig());
      assert.ok(safari > 0 && safari <= 1, `${entry.name} / parc`);
    }
  });

  it("la Master Ball à son prix reste moins chère que l'espérance de capture d'un légendaire à taux 10", () => {
    const { balls } = getPokemonConfig().capture;
    const expected = balls.poke.price / data.catchProbability(10, balls.poke.multiplier, 1);
    assert.ok(balls.master.price < expected, `${balls.master.price} ≥ ${Math.round(expected)}`);
    assert.ok(balls.master.price > expected * 0.5, "mais pas bradée");
  });
});

describe("parc safari", () => {
  const safari = () => getSafariConfig();

  it("propose les deux générations, avec le nombre d'espèces que le parc y croise", () => {
    const choices = data.safariGenerationChoices();
    assert.deepEqual(
      choices.map((choice) => [choice.generation, choice.ordinal]),
      [[1, "1re"], [2, "2e"]]
    );
    const itemOnly = data.itemOnlySpecies();
    for (const choice of choices) {
      const expected = all().filter((entry) => entry.generation === choice.generation && data.spawnWeight(entry, safari(), itemOnly) > 0).length;
      assert.equal(choice.species, expected);
    }
    assert.ok(choices.every((choice) => choice.species > 50));
  });

  it("les générations visées se nettoient : une seule est retenue, les deux valent « toutes »", () => {
    assert.deepEqual(data.safariGenerations("2"), [2]);
    assert.deepEqual(data.safariGenerations([1]), [1]);
    assert.equal(data.safariGenerations("1,2"), null);
    assert.equal(data.safariGenerations([2, 1, 2]), null);
    assert.equal(data.safariGenerations("3"), null, "une génération fermée ne se vise pas");
    assert.deepEqual(data.safariGenerations("2,9"), [2]);
  });

  it("une visite qui vise la 2ᵉ génération ne croise que ses espèces, et la 1ʳᵉ que les siennes", () => {
    for (let i = 0; i < 1500; i++) {
      assert.equal(data.rollSafariEncounter(safari(), [], [2]).species.generation, 2);
      assert.equal(data.rollSafariEncounter(safari(), [], [1]).species.generation, 1);
    }
    const generationsSeen = new Set();
    for (let i = 0; i < 1500; i++) generationsSeen.add(data.rollSafariEncounter(safari()).species.generation);
    assert.deepEqual([...generationsSeen].sort(), [1, 2]);
  });

  it("le choix des générations s'affiche : un menu à deux options, toutes cochées par défaut", () => {
    const [menu, enter] = embeds.buildSafariGenerationPicker("free", 7).map((row) => row.toJSON());
    const select = menu.components[0];
    assert.deepEqual(select.options.map((option) => option.value), ["1", "2"]);
    assert.ok(select.options.every((option) => option.default));
    assert.equal(select.max_values, 2);
    assert.match(select.options[1].label, /2e génération/);
    assert.equal(enter.components[0].custom_id, "poke_safari_go|free|7|1,2");
    const [, onlySecond] = embeds.buildSafariGenerationPicker("paid", 0, [2]).map((row) => row.toJSON());
    assert.equal(onlySecond.components[0].custom_id, "poke_safari_go|paid|0|2");
  });

  it("une rencontre de n'importe quelle espèce s'affiche, lignée comprise, dans les limites de Discord", () => {
    for (const entry of all()) {
      const lineage = new Map(data.evolutionChain(entry).map((link) => [link.id, { normal: 1, shiny: 0 }]));
      const session = {
        id: 1, user_id: "u", status: "ACTIVE", actions_left: 5, encounter_no: 1, encounter_species_id: entry.id,
        encounter_is_shiny: 0, encounter_catch_rate: entry.catchRate, encounter_bait: 0, encounter_form: null, encounter_sex: null,
      };
      const view = embeds.buildSafariView(session, { owned: { normal: 1, shiny: 0 }, lineage });
      const embed = view.embeds[0].toJSON();
      assert.ok(embed.fields.length <= 25, entry.name);
      for (const field of embed.fields) assert.ok(field.value.length <= 1024, `${entry.name} / ${field.name}`);
      assert.ok(embed.footer.text.length <= 2048, entry.name);
      assert.equal(view.components[0].toJSON().components.length, 3);
    }
  });

  it("la lignée d'un bébé et de sa forme adulte tient dans le champ « Forme de base », qui sont tous deux de stade 1", () => {
    const lineage = new Map(data.evolutionChain(species("Pichu")).map((link) => [link.id, { normal: 0, shiny: 0 }]));
    const session = {
      id: 1, user_id: "u", status: "ACTIVE", actions_left: 5, encounter_no: 1, encounter_species_id: species("Pikachu").id,
      encounter_is_shiny: 0, encounter_catch_rate: 190, encounter_bait: 0, encounter_form: null, encounter_sex: null,
    };
    const embed = embeds.buildSafariView(session, { owned: null, lineage }).embeds[0].toJSON();
    const base = embed.fields.find((field) => field.name === "Forme de base").value.split("\n");
    assert.equal(base.length, 2);
    assert.match(base[0], /Pichu 🥚/);
    assert.match(base[1], /▸ ❔ `#025` __\*\*Pikachu\*\*__/);
    assert.match(embed.footer.text, /œuf/);
  });
});

describe("objets, loterie et charme", () => {
  it("les trois objets de la 2ᵉ génération s'ouvrent : ils tombent et se gagnent", () => {
    for (const key of ["pierre_soleil", "roche_royale", "catalyseur"]) {
      const item = items.getItem(key);
      assert.equal(items.itemOpen(item), true, key);
      assert.ok(items.itemDropWeight(item) > 0, `${key} : butin`);
      assert.ok(items.itemLotteryWeight(item) > 0, `${key} : loterie`);
    }
    asGen1(() => {
      for (const key of ["pierre_soleil", "roche_royale", "catalyseur"]) {
        assert.equal(items.itemDropWeight(items.getItem(key)), 0, `${key} fermé en 1ʳᵉ génération`);
      }
    });
  });

  it("chaque forme d'objet pointe vers une espèce qui existe, de la 2ᵉ génération", () => {
    for (const item of items.getItems().filter((entry) => entry.evolution?.targets)) {
      for (const [from, to] of Object.entries(item.evolution.targets)) {
        assert.ok(data.getSpecies(from), `${item.key} : ${from}`);
        assert.equal(data.getSpecies(to)?.generation, 2, `${item.key} : ${to}`);
      }
    }
  });

  it("l'ouverture ne retire rien à la loterie : chaque objet garde exactement sa chance, les nouveaux prennent sur « rien »", () => {
    const share = () =>
      new Map(
        items.getItems().map((item) => {
          const total = items.getItems().reduce((sum, other) => sum + items.itemLotteryWeight(other), 0);
          return [item.key, (items.lotteryWinChance() * items.itemLotteryWeight(item)) / total];
        })
      );
    const before = asGen1(() => share());
    const after = share();
    for (const [key, chance] of before) {
      if (chance > 0) near(after.get(key), chance, key);
    }
    const nothingBefore = asGen1(() => 1 - items.lotteryWinChance());
    assert.ok(1 - items.lotteryWinChance() < nothingBefore, "« rien » recule");
    for (const key of ["pierre_soleil", "roche_royale", "catalyseur"]) assert.ok(after.get(key) > 0, key);
  });

  it("ce que tiennent les Pokémon ne change pas non plus pour les objets de la 1ʳᵉ génération", () => {
    const itemShare = () => {
      const total = items.getItems().reduce((sum, item) => sum + items.itemDropWeight(item), 0);
      return new Map(items.getItems().map((item) => [item.key, (items.heldItemChance() * items.itemDropWeight(item)) / total]));
    };
    const before = asGen1(() => itemShare());
    const after = itemShare();
    for (const [key, chance] of before) if (chance > 0) near(after.get(key), chance, key);
  });

  it("la loterie tire sans planter dans la 2ᵉ génération, et ses probabilités font 1", () => {
    for (let i = 0; i < 3000; i++) {
      const result = lottery.rollLottery();
      if (result) {
        assert.ok(items.itemLotteryWeight(result.item) > 0);
        assert.ok(result.quantity >= 1);
      }
    }
    const total = items.getItems().reduce((sum, item) => sum + items.itemLotteryWeight(item), 0);
    const win = items.lotteryWinChance();
    assert.ok(win > 0 && win <= 1);
    const probabilities = items.getItems().map((item) => (win * items.itemLotteryWeight(item)) / total);
    near(probabilities.reduce((sum, value) => sum + value, 0), win);
  });

  it("le Charme Chroma de la 2ᵉ génération demande ses espèces hors légendaires, et celui de la 1ʳᵉ ne bouge pas", () => {
    assert.equal(charms.charmSpecies(2).length, 94);
    assert.equal(charms.charmSpecies(1).length, 146);
    assert.ok(charms.charmSpecies(2).every((entry) => entry.generation === 2 && !data.isLegendary(entry)));
    assert.equal(items.getCharmItem(2).key, "charme_chroma_2");
    assert.equal(items.getCharmItem(1).key, "charme_chroma_1");
    assert.equal(items.getCharmItem(3), null);
  });

  it("les bébés comptent pour le charme : on peut les obtenir, par un œuf", () => {
    const names = charms.charmSpecies(2).map((entry) => entry.name);
    assert.ok(names.includes("Pichu") && names.includes("Togepi"));
  });
});

describe("évolutions", () => {
  const evolution = () => getPokemonConfig().evolution;

  it("toute espèce qui évolue a un plan, ou un refus qui dit pourquoi — jamais une exception", () => {
    for (const entry of all()) {
      if (!data.evolutionTargets(entry).length) continue;
      const plan = collection.describeEvolution(entry.id);
      if (plan.error) {
        assert.match(plan.error, /Catalyseur|Pierre Soleil|Roche Royale|n'évolue qu'avec/, `${entry.name} : ${plan.error}`);
      } else {
        assert.ok(plan.points >= 0 && plan.sacrifices >= 0 && plan.required >= 2, entry.name);
      }
    }
  });

  it("un bébé qui devient adulte paie le tarif du stade 2, comme toute première évolution", () => {
    for (const name of ["Pichu", "Mélo", "Toudoudou", "Togepi", "Lippouti", "Élekid", "Magby"]) {
      const plan = collection.describeEvolution(species(name).id);
      assert.equal(plan.error, undefined, name);
      assert.equal(plan.points, evolution()[2].points, name);
      assert.equal(plan.sacrifices, evolution()[2].duplicates - 1, name);
    }
  });

  it("Debugant a trois cibles de stade 1 : le hasard coûte le tarif du stade, le choix coûte plus", () => {
    const random = collection.describeEvolution(species("Debugant").id);
    assert.equal(random.branching, true);
    assert.deepEqual(random.targets.map((target) => target.name), ["Kicklee", "Tygnon", "Kapoera"]);
    assert.equal(random.points, evolution()[2].points);
    const chosen = collection.describeEvolution(species("Debugant").id, species("Tygnon").id);
    assert.equal(chosen.points, evolution().branchChoicePoints);
    assert.equal(chosen.target.name, "Tygnon");
  });

  it("Évoli a cinq cibles dont Mentali et Noctali, et l'Évolyte les offre au tarif du stade", () => {
    const eevee = collection.describeEvolution(species("Évoli").id);
    assert.deepEqual(eevee.targets.map((target) => target.name).sort(), ["Aquali", "Mentali", "Noctali", "Pyroli", "Voltali"]);
    const free = collection.describeEvolution(species("Évoli").id, species("Noctali").id, "evolyte");
    assert.equal(free.points, 0);
  });

  it("les formes qu'un objet est seul à donner exigent cet objet, et la bonne forme sort avec lui", () => {
    const needs = { Onix: "Catalyseur", Insécateur: "Catalyseur", Hypocéan: "Catalyseur", Porygon: "Catalyseur" };
    for (const [name, label] of Object.entries(needs)) {
      assert.match(collection.describeEvolution(species(name).id).error, new RegExp(label), name);
    }
    const withItem = collection.describeEvolution(species("Onix").id, null, "catalyseur");
    assert.equal(withItem.error, undefined);
    assert.equal(withItem.target.name, "Steelix");
    assert.equal(collection.describeEvolution(species("Ortide").id, null, "pierre_soleil").target.name, "Joliflor");
    assert.equal(collection.describeEvolution(species("Têtarte").id, null, "roche_royale").target.name, "Tarpaud");
  });

  it("l'évolution d'un bébé se joue de bout en bout : sacrifices, points, et le même individu qui change d'espèce", async () => {
    await dbRun(points, "DELETE FROM pokemon_owned");
    await dbRun(points, "DELETE FROM points");
    const cost = evolution()[2];
    const ids = [];
    for (let i = 0; i < cost.duplicates + 1; i++) {
      const { lastID } = await dbRun(
        points,
        "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at) VALUES ('u1', ?, 0, 'M', 'oeuf', ?)",
        [species("Pichu").id, i + 1]
      );
      ids.push(lastID);
    }
    await dbRun(points, "INSERT INTO points (user_id, balance) VALUES ('u1', ?)", [cost.points + 100]);
    const result = await call(collection.evolve, "u1", { speciesId: species("Pichu").id, isShiny: false }, null, null);
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.target.name, "Pikachu");
    assert.equal(result.plan.points, cost.points);
    assert.equal(await call(economy.getBalance, "u1"), 100);
    const left = await dbAll(points, "SELECT id, species_id FROM pokemon_owned ORDER BY id");
    assert.equal(left.length, ids.length - (cost.duplicates - 1));
    assert.equal(left.filter((row) => row.species_id === species("Pikachu").id).length, 1);
    assert.ok(left.some((row) => row.species_id === species("Pichu").id), "il reste toujours un Pichu");
  });

  describe("les formes qu'un objet est seul à donner, de bout en bout", () => {
    const give = (name, count = 3) =>
      Promise.all(
        Array.from({ length: count }, (_, index) =>
          dbRun(points, "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at) VALUES ('u1', ?, 0, 'M', 'test', ?)", [species(name).id, index + 1])
        )
      ).then((results) => results.map((result) => result.lastID));
    const stock = (key) => call(items.getItemCount, "u1", key);
    const grant = (key, quantity) => call(items.grantItem, "u1", key, quantity, { source: "test" });
    const run = (name, id, helper = null, chosen = null) =>
      new Promise((resolve, reject) =>
        collection.evolve("u1", { speciesId: species(name).id, isShiny: null, pokemonId: id }, chosen, helper, (error, value) => (error ? reject(error) : resolve(value)))
      );

    beforeEach(async () => {
      for (const table of ["pokemon_owned", "points", "pokemon_inventory", "pokemon_item_log"]) await dbRun(points, `DELETE FROM ${table}`);
      await dbRun(points, "INSERT INTO points (user_id, balance) VALUES ('u1', 10000)");
    });

    it("la Pierre Soleil fait d'un Ortide un Joliflor, et elle est consommée", async () => {
      const ids = await give("Ortide", 2);
      await grant("pierre_soleil", 2);
      const result = await run("Ortide", ids[1], "pierre_soleil");
      assert.equal(result.ok, true, result.reason);
      assert.equal(result.target.name, "Joliflor");
      assert.equal(await stock("pierre_soleil"), 1);
    });

    it("sans elle, Ortide devient Rafflesia : la forme à objet n'est jamais tirée", async () => {
      const outcomes = new Set();
      for (const value of [0, 0.5, 0.99]) {
        await dbRun(points, "DELETE FROM pokemon_owned");
        const ids = await give("Ortide", 3);
        const result = await withRandom(value, async () => run("Ortide", ids[2]));
        assert.equal(result.ok, true, result.reason);
        outcomes.add(result.target.name);
      }
      assert.deepEqual([...outcomes], ["Rafflesia"]);
    });

    it("Onix sans Catalyseur n'évolue pas, et rien ne lui est retiré", async () => {
      const ids = await give("Onix", 3);
      const result = await run("Onix", ids[2]);
      assert.equal(result.ok, false);
      assert.match(result.reason, /n'évolue qu'avec \*\*Catalyseur\*\*/);
      assert.equal((await dbAll(points, "SELECT id FROM pokemon_owned")).length, 3);
    });

    it("le Catalyseur donne Steelix, et l'échange ne le donne pas", async () => {
      const ids = await give("Onix", 2);
      await grant("catalyseur", 1);
      const result = await run("Onix", ids[1], "catalyseur");
      assert.equal(result.ok, true, result.reason);
      assert.equal(result.target.name, "Steelix");

      await dbRun(points, "DELETE FROM pokemon_owned");
      const mine = await give("Onix", 2);
      const theirs = await dbRun(points, "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at) VALUES ('u2', ?, 0, 'M', 'test', 1)", [species("Roucool").id]);
      await dbRun(points, "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at) VALUES ('u2', ?, 0, 'M', 'test', 2)", [species("Roucool").id]);
      const tradeId = await call(collection.createTrade, {
        fromUserId: "u1", toUserId: "u2", offerSpeciesId: species("Onix").id, requestSpeciesId: species("Roucool").id, offerPokemonId: mine[0], requestPokemonId: theirs.lastID, channelId: "x",
      });
      const trade = await new Promise((resolve, reject) => collection.acceptTrade(tradeId, (error, value) => (error ? reject(error) : resolve(value))));
      assert.equal(trade.ok, true, trade.reason);
      assert.deepEqual(trade.evolutions, [], "un Onix échangé reste un Onix : c'est le Catalyseur qui donne Steelix");
    });

    it("une panne à l'arrivée de la forme rend la Roche Royale, les points et les sacrifices", async () => {
      const ids = await give("Têtarte", 3);
      await grant("roche_royale", 1);
      const before = await dbAll(points, "SELECT id, species_id FROM pokemon_owned ORDER BY id");
      await dbRun(points, `CREATE TRIGGER panne BEFORE INSERT ON pokemon_owned WHEN NEW.species_id = ${species("Tarpaud").id} BEGIN SELECT RAISE(ABORT, 'panne'); END`);
      await assert.rejects(() => run("Têtarte", ids[2], "roche_royale"), /panne/);
      await dbRun(points, "DROP TRIGGER panne");
      assert.deepEqual(await dbAll(points, "SELECT id, species_id FROM pokemon_owned ORDER BY id"), before);
      assert.equal(await stock("roche_royale"), 1);
      assert.equal(await call(economy.getBalance, "u1"), 10000);
    });

    it("la fiche de Zarbi montre les lettres qu'on a, celle d'une espèce sans formes n'en dit rien", async () => {
      const unown = species("Zarbi");
      for (const key of ["A", "B"]) {
        await dbRun(points, "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at, form) VALUES ('u1', ?, 0, NULL, 'test', 1, ?)", [unown.id, key]);
      }
      const sheet = await call(collection.getSpeciesOwnership, "u1", unown);
      assert.deepEqual([...sheet.forms].sort(), ["A", "B"]);
      assert.equal((await call(collection.getSpeciesOwnership, "u1", species("Rattata"))).forms, null);
    });
  });
});

describe("œufs", () => {
  beforeEach(async () => {
    for (const table of ["pokemon_owned", "pokemon_eggs", "points"]) await dbRun(points, `DELETE FROM ${table}`);
  });
  const give = (name, sex, { shiny = 0 } = {}) =>
    dbRun(points, "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at) VALUES ('u1', ?, ?, ?, 'test', 1)", [
      species(name).id,
      shiny,
      sex,
    ]);
  const group = (name, sex, shiny = false) => ({ speciesId: species(name).id, isShiny: shiny, sex });

  it("huit familles pondent, et seul un parent de la famille a un bébé", () => {
    const families = eggs.babyFamilies();
    assert.equal(families.length, 8);
    assert.equal(eggs.babyOf(species("Pikachu"))?.name, "Pichu");
    assert.equal(eggs.babyOf(species("Raichu"))?.name, "Pichu");
    assert.equal(eggs.babyOf(species("Pichu")), null, "le bébé ne pond pas");
    assert.equal(eggs.babyOf(species("Rattata")), null);
    assert.equal(eggs.canBreed(species("Métamorph")), true);
    assert.equal(eggs.canBreed(species("Rattata")), false);
    for (const { baby, parents } of families) {
      assert.ok(parents.size >= 1 && !parents.has(baby.id), baby.name);
    }
  });

  it("décrit l'œuf d'un couple, ou le refus", () => {
    const parent = (name, sex) => ({ species: species(name), sex });
    assert.equal(eggs.describeEgg(parent("Pikachu", "M"), parent("Raichu", "F")).baby.name, "Pichu");
    assert.match(eggs.describeEgg(parent("Pikachu", "M"), parent("Pikachu", "M")).error, /mâle et une femelle/);
    assert.match(eggs.describeEgg(parent("Pikachu", "M"), parent("Rondoudou", "F")).error, /même famille/);
    assert.match(eggs.describeEgg(parent("Rattata", "M"), parent("Pikachu", "F")).error, /n'a pas de bébé/);
    assert.match(eggs.describeEgg(parent("Métamorph", null), parent("Métamorph", null)).error, /Deux Métamorph/);
    const withDitto = eggs.describeEgg(parent("Métamorph", null), parent("Togetic", "F"));
    assert.equal(withDitto.baby.name, "Togepi");
    assert.equal(withDitto.mother.species.name, "Togetic");
  });

  it("chaque famille pond son bébé : les parents deviennent stériles, et l'œuf éclot en ce bébé", async () => {
    for (const { baby, parents } of eggs.babyFamilies()) {
      await dbRun(points, "DELETE FROM pokemon_owned");
      await dbRun(points, "DELETE FROM pokemon_eggs");
      const parent = data.getSpecies([...parents][0]).name;
      await give(parent, "M");
      await give(parent, "F");
      const laid = await call(eggs.layEgg, "u1", group(parent, "M"), group(parent, "F"));
      assert.equal(laid.ok, true, `${baby.name} : ${laid.reason}`);
      assert.equal(laid.egg.species_id, baby.id);
      const sterile = await dbAll(points, "SELECT sterile FROM pokemon_owned");
      assert.ok(sterile.every((row) => row.sterile === 1), "les parents ne pondent qu'une fois");

      const hatched = await call(eggs.hatchEgg, laid.egg.id);
      assert.equal(hatched.species.id, baby.id);
      const born = await dbAll(points, "SELECT origin FROM pokemon_owned WHERE species_id = ?", [baby.id]);
      assert.deepEqual(born, [{ origin: "oeuf" }]);
    }
  });

  it("un seul œuf à la fois, et un parent ne pond qu'une fois dans sa vie", async () => {
    await give("Pikachu", "M");
    await give("Pikachu", "F");
    await give("Pikachu", "M");
    await give("Pikachu", "F");
    const first = await call(eggs.layEgg, "u1", group("Pikachu", "M"), group("Pikachu", "F"));
    assert.equal(first.ok, true);
    const second = await call(eggs.layEgg, "u1", group("Pikachu", "M"), group("Pikachu", "F"));
    assert.equal(second.ok, false);
    assert.match(second.reason, /couves déjà un œuf/);
    await call(eggs.hatchEgg, first.egg.id);
    const third = await call(eggs.layEgg, "u1", group("Pikachu", "M"), group("Pikachu", "F"));
    assert.equal(third.ok, true, "les deux autres parents sont fertiles");
    await call(eggs.hatchEgg, third.egg.id);
    const exhausted = await call(eggs.layEgg, "u1", group("Pikachu", "M"), group("Pikachu", "F"));
    assert.equal(exhausted.ok, false);
    assert.match(exhausted.reason, /fertile|une fois dans sa vie/);
  });

  it("un œuf ne s'ouvre qu'une fois", async () => {
    await give("Pikachu", "M");
    await give("Pikachu", "F");
    const laid = await call(eggs.layEgg, "u1", group("Pikachu", "M"), group("Pikachu", "F"));
    const [first, second] = await Promise.all([call(eggs.hatchEgg, laid.egg.id), call(eggs.hatchEgg, laid.egg.id)]);
    assert.equal([first, second].filter(Boolean).length, 1);
    assert.equal((await dbAll(points, "SELECT * FROM pokemon_owned WHERE species_id = ?", [species("Pichu").id])).length, 1);
  });

  it("les chances de shiny d'un œuf doublent par parent shiny", () => {
    assert.equal(eggs.eggShinyFactor(0), 1);
    assert.equal(eggs.eggShinyFactor(1), 2);
    assert.equal(eggs.eggShinyFactor(2), 4);
  });

  it("avec la 1ʳᵉ génération seule, aucune famille ne pond et le refus l'explique", () => {
    asGen1(() => {
      assert.equal(eggs.babyFamilies().length, 0);
      const result = eggs.describeEgg({ species: species("Pikachu"), sex: "M" }, { species: species("Pikachu"), sex: "F" });
      assert.match(result.error, /arrivent avec la génération 2/);
    });
  });
});

describe("annonce de l'ouverture", () => {
  const announcements = [];
  const client = {
    channels: {
      fetch: async () => ({
        send: async (message) => {
          announcements.push(message);
        },
      }),
    },
  };
  beforeEach(async () => {
    announcements.length = 0;
    await dbRun(points, "DELETE FROM pokemon_generations");
  });

  it("annonce la 2ᵉ génération une seule fois, même si le minuteur passe chaque minute", async () => {
    await generations.announceOpenedGenerations(client);
    await generations.announceOpenedGenerations(client);
    await generations.announceOpenedGenerations(client);
    assert.equal(announcements.length, 1);
    const embed = announcements[0].embeds[0].toJSON();
    assert.match(embed.title, /2e génération est ouverte/);
    const rows = await dbAll(points, "SELECT generation FROM pokemon_generations");
    assert.deepEqual(rows, [{ generation: 2 }]);
  });

  it("ne dit rien tant que la 2ᵉ n'est pas ouverte : la 1ʳᵉ ne s'annonce jamais", async () => {
    await asGen1(() => generations.announceOpenedGenerations(client));
    assert.equal(announcements.length, 0);
    assert.equal((await dbAll(points, "SELECT * FROM pokemon_generations")).length, 0);
  });

  it("un bot éteint à l'heure dite l'annonce à son retour, une seule fois", async () => {
    sandbox.writeConfig({ pokemon: { generationOpenings: { 2: "2026-10-30T18:00:00+01:00" } } });
    // Le 30 octobre à 18 h est passé quand ce test tourne, ou ne l'est pas encore :
    // activeGeneration en décide, et l'annonce suit — jamais l'un sans l'autre.
    const open = data.activeGeneration() >= 2;
    await generations.announceOpenedGenerations(client);
    await generations.announceOpenedGenerations(client);
    assert.equal(announcements.length, open ? 1 : 0);
    sandbox.writeConfig(GEN2);
  });

  it("l'annonce décrit ce qu'apporte la génération : espèces, légendaires, bébés, objets, charme", () => {
    const description = generations.buildGenerationEmbed(2).toJSON().description;
    assert.match(description, /\*\*100\*\* nouvelles espèces/);
    assert.match(description, /Raikou.*Celebi|Celebi.*Raikou/);
    assert.match(description, /Pichu/);
    assert.match(description, /Pierre Soleil/);
    assert.match(description, /Charme Chroma/);
    assert.match(description, /ses 94 espèces/);
    assert.ok(description.length < 4096);
  });

  it("une annonce impossible à envoyer est revendiquée quand même : elle ne se répète pas chaque minute", async () => {
    const broken = { channels: { fetch: async () => ({ send: async () => { throw new Error("salon fermé"); } }) } };
    await generations.announceOpenedGenerations(broken);
    await generations.announceOpenedGenerations(client);
    assert.equal(announcements.length, 0);
  });
});

describe("ouverture programmée", () => {
  it("la 2ᵉ s'ouvre à l'instant dit, heure de Paris, sans redémarrage", () => {
    const opening = getPokemonConfig().generationOpenings;
    assert.equal(opening[2], "2026-10-30T18:00:00+01:00", "la date du jeu");
    sandbox.writeConfig({ pokemon: { generationOpenings: { 2: opening[2] } } });
    try {
      assert.equal(data.activeGeneration(Date.parse("2026-10-30T17:59:59+01:00")), 1);
      assert.equal(data.activeGeneration(Date.parse("2026-10-30T18:00:00+01:00")), 2);
      assert.equal(data.activeGeneration(Date.parse("2026-10-30T16:59:59Z")), 1);
      assert.equal(data.activeGeneration(Date.parse("2026-10-30T17:00:00Z")), 2);
    } finally {
      sandbox.writeConfig(GEN2);
    }
  });

  it("Paris est bien à UTC+1 le 30 octobre : l'heure d'été s'est terminée le dimanche 25", () => {
    const parisHour = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date("2026-10-30T17:00:00Z"))
      .find((part) => part.type === "hour").value;
    assert.equal(parisHour, "18");
  });

  it("à l'ouverture, les espèces de la 2ᵉ génération entrent partout d'un coup", () => {
    sandbox.writeConfig(GEN1_ONLY);
    const closed = data.allSpecies().length;
    sandbox.writeConfig({ pokemon: { generationOpenings: { 2: "2000-01-01T00:00:00+01:00" } } });
    assert.equal(data.allSpecies().length, 251);
    assert.equal(closed, 151);
    sandbox.writeConfig(GEN2);
  });
});

describe("site", () => {
  const route = (method, path) => routes.find((entry) => entry.method === method && entry.path === path);
  const run = (method, path, extra = {}) => route(method, path).handler({ user: { id: "u1" }, body: {}, params: {}, query: {}, bot: null, ...extra });

  it("la liste des espèces compte les 251, bébés et formes d'objet marqués comme tels", async () => {
    const { generation, species: list } = await run("GET", "/api/species");
    assert.equal(generation, 2);
    assert.equal(list.length, 251);
    const by = (name) => list.find((entry) => entry.name === name);
    assert.equal(by("Pichu").baby, true);
    assert.equal(by("Pichu").obtention, "egg");
    assert.equal(by("Steelix").obtention, "evolution");
    assert.equal(by("Alakazam").obtention, "evolution");
    assert.equal(by("Roucool").obtention, "wild");
    assert.equal(by("Pikachu").breeder, true);
    assert.equal(by("Rattata").breeder, false);
    assert.equal(by("Lugia").catchRate, 10);
    assert.equal(by("Celebi").catchRate, 45);
  });

  it("chaque espèce se lit seule, avec sa lignée", async () => {
    for (const entry of all()) {
      const card = await run("GET", "/api/species/:speciesId", { params: { speciesId: String(entry.id) } });
      assert.equal(card.id, entry.id);
      assert.ok(card.chain.includes(entry.id));
    }
  });

  it("les règles en chiffres se calculent dans la 2ᵉ génération, sans bébé dans les raretés d'apparition", async () => {
    const rules = await run("GET", "/api/rules");
    assert.ok(rules.spawn.rarities.length >= 3);
    const share = rules.spawn.rarities.reduce((sum, rarity) => sum + rarity.share, 0);
    near(share, 1, "les parts de rareté");
    const species = rules.spawn.rarities.reduce((sum, rarity) => sum + rarity.species, 0);
    const itemOnly = data.itemOnlySpecies();
    const expected = all().filter((entry) => data.spawnWeight(entry, getPokemonConfig().spawn, itemOnly) > 0).length;
    assert.equal(species, expected, "autant d'espèces que le pool d'apparition");
    assert.equal(rules.safari.rarities.reduce((sum, rarity) => sum + rarity.species, 0) > 0, true);
  });

  it("le catalogue porte les objets de la 2ᵉ génération", async () => {
    const catalogue = await run("GET", "/api/catalogue");
    const keys = catalogue.items.map((item) => item.key);
    for (const key of ["pierre_soleil", "roche_royale", "catalyseur", "charme_chroma_2"]) assert.ok(keys.includes(key), key);
  });

  it("la lignée d'un bébé se lit, avec ce qu'on possède", async () => {
    await dbRun(points, "DELETE FROM pokemon_owned");
    await dbRun(points, "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at) VALUES ('u1', ?, 0, 'M', 'oeuf', 1)", [species("Pichu").id]);
    const { lineage } = await run("GET", "/api/me/lineage/:speciesId", { params: { speciesId: String(species("Pikachu").id) } });
    assert.deepEqual(
      lineage.map((link) => [link.speciesId, link.owned.normal]),
      [[species("Pichu").id, 1], [species("Pikachu").id, 0], [species("Raichu").id, 0]]
    );
  });
});

describe("tous les affichages, pour toutes les espèces", () => {
  it("la fiche, l'annonce d'apparition et le parc ne plantent pour aucune des 251 espèces, shiny ou non", () => {
    for (const entry of all()) {
      for (const shiny of [false, true]) {
        const card = embeds.buildSpeciesInfoEmbed(entry, { isShiny: shiny }).toJSON();
        assert.ok(card.title.includes(entry.name), entry.name);
        assert.ok(card.fields.length <= 25);
        const spawn = embeds
          .buildSpawnEmbed(
            { id: 1, is_shiny: shiny ? 1 : 0, catch_rate: entry.catchRate, rarity: data.rarityOf(entry), throw_count: 0, held_item: null, sex: null, charm_shiny: 0, form: null },
            entry,
            []
          )
          .toJSON();
        assert.ok(spawn.title.includes(entry.name), entry.name);
      }
    }
  });

  it("Zarbi porte ses 26 lettres, une par individu", () => {
    const unown = species("Zarbi");
    const forms = data.speciesForms(unown);
    assert.equal(forms.length, 26);
    assert.ok(forms.every((form) => form.key && form.name));
    assert.equal(data.speciesForms(unown, 1).length, 0, "aucune en 1ʳᵉ génération : Zarbi n'y existe pas");
    const picked = withRandom(0, () => data.rollForm(unown));
    assert.ok(forms.some((form) => form.key === picked));
    assert.equal(data.rollForm(species("Pikachu")), null);
  });

  it("le dernier Pokémon est Celebi, n°251, mythique et toujours verrouillé à l'arrivée", () => {
    assert.equal(all().at(-1).name, "Celebi");
    assert.equal(data.lockedByDefault(251, false), true);
    assert.equal(embeds.dexNumber(species("Celebi")), "#251");
  });

  it("la lecture brute d'une espèce de la 2ᵉ génération reste possible une fois la génération refermée : une collection la garde", () => {
    asGen1(() => {
      assert.equal(data.getAvailableSpecies(251), null);
      assert.equal(data.getSpecies(251).name, "Celebi");
      assert.equal(data.allSpecies().length, 151);
    });
  });

  it("une collection qui contient des espèces de la 2ᵉ génération s'affiche en 1ʳᵉ génération sans planter", async () => {
    await dbRun(points, "DELETE FROM pokemon_owned");
    for (const name of ["Pichu", "Celebi", "Roucool"]) {
      await dbRun(points, "INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, origin, obtained_at) VALUES ('u1', ?, 0, 'M', 'test', 1)", [species(name).id]);
    }
    const rows = await dbAll(points, "SELECT * FROM pokemon_owned");
    asGen1(() => {
      assert.doesNotThrow(() => embeds.buildDexEmbed({ username: "x", displayAvatarURL: () => "https://exemple.test/a.png" }, rows, 0).toJSON());
      assert.doesNotThrow(() => embeds.collectionStats(rows));
    });
    const row = await dbGet(points, "SELECT COUNT(*) AS n FROM pokemon_owned");
    assert.equal(row.n, 3);
  });
});
