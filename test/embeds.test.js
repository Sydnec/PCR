// Ce que Discord affiche : l'embed d'une rencontre du parc safari, la fiche d'une
// espèce, l'annonce d'une apparition, l'inventaire. On lit le JSON de l'embed, ce
// que Discord reçoit, pas son rendu.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, speciesByName } from "./helpers.js";

createSandbox({ config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } } });
// Les embeds importent des modules qui ouvrent les bases : on les attend et on les
// ferme, sinon le dossier jetable disparaît sous leurs pieds.
await openDatabases();
const embeds = await import("../modules/pokemon/embeds.js");
const data = await import("../modules/pokemon/data.js");
const { getSafariConfig } = await import("../modules/pokemon/config.js");

const species = (name) => speciesByName(data.allSpecies, name);
const safari = () => getSafariConfig();

const session = (name, overrides = {}) => ({
  id: 1,
  user_id: "u1",
  status: "ACTIVE",
  actions_left: 24,
  encounter_no: 3,
  encounter_species_id: species(name).id,
  encounter_is_shiny: 0,
  encounter_catch_rate: species(name).catchRate,
  encounter_bait: 0,
  encounter_sex: null,
  encounter_form: null,
  shared_at: null,
  ...overrides,
});

// Ce que getOwnedVariantsFor rend : une entrée par maillon, même à zéro.
const lineageOf = (name, counts = {}) =>
  new Map(
    data
      .evolutionChain(species(name))
      .map((link) => [link.id, counts[link.name] ?? { normal: 0, shiny: 0 }])
  );

const encounter = (name, { owned, lineage, ...overrides } = {}) => {
  const row = session(name, overrides);
  const view = embeds.buildSafariView(row, {
    owned: owned ?? { normal: 0, shiny: 0 },
    lineage: lineage === undefined ? lineageOf(name) : lineage,
  });
  return { view, embed: view.embeds[0].toJSON() };
};
const names = (embed) => embed.fields.map((field) => field.name);
const field = (embed, name) => embed.fields.find((entry) => entry.name === name);

describe("rencontre du parc safari : la lignée", () => {
  it("montre un champ par stade, avec ce que le dresseur possède", () => {
    const { embed } = encounter("Bulbizarre", {
      lineage: lineageOf("Bulbizarre", { Herbizarre: { normal: 2, shiny: 0 } }),
    });
    assert.deepEqual(names(embed), [
      "Rareté",
      "Type",
      "Chances de capture",
      "Forme de base",
      "Stade 1",
      "Stade 2",
      "Actions restantes",
    ]);
    assert.match(field(embed, "Forme de base").value, /▸ ❔ `#001` __\*\*Bulbizarre\*\*__/);
    assert.match(field(embed, "Stade 1").value, /✅ `#002` Herbizarre ×2/);
    assert.match(field(embed, "Stade 2").value, /❔ `#003` Florizarre/);
  });

  it("n'affiche pas « Ton Pokédex » en plus de la lignée : le Pokémon n'y figure qu'une fois", () => {
    const { embed } = encounter("Bulbizarre", { owned: { normal: 1, shiny: 0 } });
    assert.ok(!names(embed).includes("Ton Pokédex"));
    const mentions = embed.fields.filter((entry) => entry.value.includes("Bulbizarre"));
    assert.equal(mentions.length, 1);
  });

  it("une espèce sans lignée garde « Ton Pokédex », puisque rien d'autre ne le dit", () => {
    const { embed } = encounter("Tauros", { owned: { normal: 1, shiny: 0 } });
    assert.deepEqual(names(embed), [
      "Rareté",
      "Type",
      "Chances de capture",
      "Ton Pokédex",
      "Actions restantes",
    ]);
    assert.equal(field(embed, "Ton Pokédex").value, "✅ Déjà capturé");
  });

  it("dit « Il te manque ! » à qui n'a pas l'espèce, et signale un shiny inédit", () => {
    assert.equal(
      field(encounter("Tauros").embed, "Ton Pokédex").value,
      "🆕 Il te manque !"
    );
    const shiny = encounter("Tauros", { encounter_is_shiny: 1, owned: { normal: 2, shiny: 0 } }).embed;
    assert.match(field(shiny, "Ton Pokédex").value, /Shiny inédit/);
  });

  it("les actions restantes viennent en dernier, la lignée avant", () => {
    const { embed } = encounter("Salamèche");
    assert.equal(names(embed).at(-1), "Actions restantes");
    assert.equal(names(embed).indexOf("Forme de base"), 3);
  });

  it("une lignée à embranchement empile ses cibles dans le champ de leur stade", () => {
    const { embed } = encounter("Évoli", {
      lineage: lineageOf("Évoli", { Aquali: { normal: 1, shiny: 0 } }),
    });
    const stage = field(embed, "Stade 1").value.split("\n");
    assert.equal(stage.length, 3);
    assert.match(stage[0], /✅ `#134` Aquali ×1/);
  });

  it("sur un shiny, « possédé » veut dire « possédé en shiny », et les deux compteurs restent", () => {
    const { embed } = encounter("Salamèche", {
      encounter_is_shiny: 1,
      lineage: lineageOf("Salamèche", {
        Salamèche: { normal: 1, shiny: 0 },
        Reptincel: { normal: 0, shiny: 1 },
      }),
    });
    assert.match(field(embed, "Forme de base").value, /❔.*Salamèche.*×1/);
    assert.match(field(embed, "Stade 1").value, /✅.*Reptincel ✨×1/);
  });

  it("explique la pastille 🔒 d'une évolution qu'on ne croise pas à l'état sauvage", () => {
    const { embed } = encounter("Abra");
    assert.match(field(embed, "Stade 2").value, /Alakazam 🔒/);
    assert.match(embed.footer.text, /Introuvable à l'état sauvage/);
    assert.match(embed.footer.text, /rencontre n°3/);
  });

  it("sans pastille à expliquer, le pied de page ne porte que la rencontre", () => {
    const { embed } = encounter("Bulbizarre");
    assert.equal(embed.footer.text, "Parc safari · Pokédex n°1 · rencontre n°3");
  });

  it("une collection illisible omet la lignée et la pastille plutôt que d'annoncer zéro", () => {
    const view = embeds.buildSafariView(session("Bulbizarre"), { owned: null, lineage: null });
    const embed = view.embeds[0].toJSON();
    assert.deepEqual(names(embed), ["Rareté", "Type", "Chances de capture", "Actions restantes"]);
  });

  it("reste très en dessous des limites de Discord pour toutes les espèces jouables", () => {
    for (const entry of data.allSpecies()) {
      const { embed } = encounter(entry.name);
      assert.ok(embed.fields.length <= 25, entry.name);
      for (const f of embed.fields) assert.ok(f.value.length <= 1024, `${entry.name} / ${f.name}`);
      assert.ok(embed.footer.text.length <= 2048, entry.name);
      assert.ok(embed.title.length <= 256, entry.name);
    }
  });
});

describe("rencontre du parc safari : le reste", () => {
  it("annonce les chances de capture et le risque de fuite de la PROCHAINE action", () => {
    const base = encounter("Bulbizarre").embed;
    assert.match(field(base, "Chances de capture").value, /💨 5 % qu'il détale/);
    const baited = encounter("Bulbizarre", { encounter_bait: 1 }).embed;
    const value = field(baited, "Chances de capture").value;
    assert.match(value, /🍎 ×2 \(1 appât\)/);
    assert.match(value, /💨 8 % qu'il détale/);
  });

  it("annonce la probabilité que le tirage utilise, plancher compris", () => {
    const { embed } = encounter("Mewtwo");
    const probability = data.safariCatchProbability(species("Mewtwo").catchRate, 0, safari());
    assert.ok(field(embed, "Chances de capture").value.startsWith(`${(probability * 100).toFixed(1)} %`));
  });

  it("annonce un shiny comme tel", () => {
    const { embed } = encounter("Salamèche", { encounter_is_shiny: 1 });
    assert.match(embed.title, /SHINY/);
    assert.match(embed.title, /✨/);
  });

  it("ferme le bouton d'appât au plafond", () => {
    const open = encounter("Bulbizarre").view.components[0].toJSON().components;
    const capped = encounter("Bulbizarre", { encounter_bait: 2 }).view.components[0].toJSON().components;
    assert.equal(open.length, 3);
    assert.ok(!open[1].disabled);
    assert.equal(capped[1].disabled, true);
    assert.ok(open[0].custom_id.startsWith("poke_safari_ball|1|24"));
  });

  it("une visite terminée affiche le bilan et propose de le partager", () => {
    const view = embeds.buildSafariView(session("Bulbizarre", { status: "FINISHED", actions_left: 0 }), {
      catches: [],
    });
    assert.equal(view.components.length, 1);
    assert.match(view.components[0].toJSON().components[0].custom_id, /^poke_safari_share\|1$/);
    const shared = embeds.buildSafariView(
      session("Bulbizarre", { status: "FINISHED", actions_left: 0, shared_at: 5 }),
      { catches: [] }
    );
    assert.deepEqual(shared.components, []);
  });

  it("ajoute la phrase de reprise sans la garder d'une action à l'autre", () => {
    const resumed = embeds.buildSafariView(session("Bulbizarre"), { resumed: true });
    assert.match(resumed.content, /reprends ta visite/);
    assert.equal(embeds.buildSafariView(session("Bulbizarre")).content, null);
  });

  it("dit ce qui s'est passé à chaque issue", () => {
    const line = (outcome) =>
      embeds.safariOutcomeLine(
        { outcome, species: species("Bulbizarre"), isShiny: false, sex: null, form: null, probability: 0.18, baitStacks: 1 },
        safari()
      );
    assert.match(line("CATCH"), /capturé/);
    assert.match(line("MISS"), /Raté/);
    assert.match(line("MISS_FLED"), /détaler/);
    assert.match(line("BAIT"), /appât/);
    assert.match(line("BAIT_FLED"), /détale aussitôt/);
    assert.match(line("FLED"), /t'éclipses/);
    assert.match(line("FLEE_FAILED"), /barre la route/);
  });
});

describe("fiche d'une espèce", () => {
  const card = (name, options) => embeds.buildSpeciesInfoEmbed(species(name), options).toJSON();

  it("annonce la difficulté et la probabilité du plancher, pas du taux brut", () => {
    const embed = card("Mewtwo");
    assert.match(field(embed, "Difficulté").value, /^Très difficile\n/);
    const poke = data.probabilitiesByBall(species("Mewtwo").catchRate)[0];
    assert.match(field(embed, "Difficulté").value, new RegExp(`${(poke.probability * 100).toFixed(1)} %`));
  });

  it("reprend le taux figé d'une apparition, pas celui du jeu de données", () => {
    const embed = card("Salamèche", { catchRate: 255 });
    assert.match(field(embed, "Difficulté").value, /^Très facile/);
  });

  it("une espèce sans lignée n'a qu'un champ « Ton Pokédex »", () => {
    const embed = card("Tauros", { owned: new Map([[species("Tauros").id, { normal: 2, shiny: 0 }]]) });
    assert.equal(embed.fields.filter((entry) => entry.name === "Ton Pokédex").length, 1);
    assert.match(field(embed, "Ton Pokédex").value, /✅ `#128` __\*\*Tauros\*\*__ ×2/);
  });

  it("une lignée se lit stade par stade, l'espèce consultée marquée", () => {
    const embed = card("Herbizarre");
    assert.deepEqual(
      embed.fields.slice(-3).map((entry) => entry.name),
      ["Forme de base", "Stade 1", "Stade 2"]
    );
    assert.match(field(embed, "Stade 1").value, /▸ ❔ `#002` __\*\*Herbizarre\*\*__/);
  });

  it("explique 🔒 dans le pied de page", () => {
    assert.match(card("Kadabra").footer.text, /Introuvable à l'état sauvage/);
    assert.equal(card("Salamèche").footer, undefined);
  });

  it("la fiche d'un Pokémon rare est complète : type, rareté, difficulté, sexe", () => {
    const embed = card("Dracaufeu");
    assert.deepEqual(names(embed).slice(0, 4), ["Type", "Rareté", "Difficulté", "Sexe"]);
    assert.match(field(embed, "Rareté").value, /Rare/);
  });
});

describe("annonce d'une apparition", () => {
  const spawn = (name, overrides = {}) => ({
    id: 5,
    is_shiny: 0,
    catch_rate: species(name).catchRate,
    rarity: data.rarityOf(species(name)),
    throw_count: 0,
    held_item: null,
    sex: null,
    charm_shiny: 0,
    form: null,
    ...overrides,
  });

  it("annonce un légendaire comme « Très difficile », avec les chances du plancher pour chaque ball", () => {
    const embed = embeds.buildSpawnEmbed(spawn("Mewtwo"), species("Mewtwo"), []).toJSON();
    const difficulty = embed.fields.find((entry) => entry.name.startsWith("Difficulté"));
    assert.match(difficulty.name, /Très difficile/);
    for (const ball of data.probabilitiesByBall(species("Mewtwo").catchRate)) {
      if (ball.guaranteed) continue;
      assert.ok(difficulty.value.includes(`${(ball.probability * 100).toFixed(1)} %`), ball.key);
    }
  });

  it("la difficulté annoncée vient du taux figé de l'apparition", () => {
    const embed = embeds.buildSpawnEmbed(spawn("Salamèche", { catch_rate: 255 }), species("Salamèche"), []).toJSON();
    assert.match(embed.fields.find((entry) => entry.name.startsWith("Difficulté")).name, /Très facile/);
  });

  it("annonce un shiny comme tel", () => {
    const embed = embeds.buildSpawnEmbed(spawn("Salamèche", { is_shiny: 1 }), species("Salamèche"), []).toJSON();
    assert.match(embed.title, /shiny/i);
  });
});

describe("inventaire", () => {
  const user = { username: "dresseur", displayAvatarURL: () => "https://exemple.test/a.png" };

  it("montre le prix de revente des objets qui se revendent, et rien pour les autres", () => {
    const embed = embeds
      .buildInventoryEmbed(
        [
          { item_key: "super_bonbon", count: 3 },
          { item_key: "ball_master", count: 1 },
        ],
        { user }
      )
      .toJSON();
    const bonbon = embed.fields.find((entry) => entry.name.includes("Super Bonbon"));
    const master = embed.fields.find((entry) => entry.name.includes("Master Ball"));
    assert.match(bonbon.name, /×3/);
    assert.match(bonbon.value, /Se revend \*\*300\*\* points pièce/);
    assert.ok(!master.value.includes("Se revend"));
  });

  it("compte les objets en poche", () => {
    const embed = embeds
      .buildInventoryEmbed([{ item_key: "super_bonbon", count: 3 }, { item_key: "pepite", count: 2 }], { user })
      .toJSON();
    assert.match(embed.description, /\*\*5\*\* objets/);
  });
});

describe("noms et numéros", () => {
  it("accole le sexe et le shiny au nom", () => {
    assert.equal(embeds.displayName(species("Pikachu"), true, "F"), "✨ Pikachu ♀");
    assert.equal(embeds.displayName(species("Pikachu"), false, "M"), "Pikachu ♂");
    assert.equal(embeds.displayName(species("Pikachu"), false), "Pikachu");
  });

  it("numérote sur trois chiffres", () => {
    assert.equal(embeds.dexNumber(species("Pikachu")), "#025");
    assert.equal(embeds.dexNumber(species("Mewtwo")), "#150");
  });
});
