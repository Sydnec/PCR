// Ce que Discord affiche : l'embed d'une rencontre du parc safari, la fiche d'une
// espèce, l'annonce d'une apparition, l'inventaire. On lit le JSON de l'embed, ce
// que Discord reçoit, pas son rendu.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, openDatabases, speciesByName } from "./helpers.js";

const sandbox = createSandbox({ config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } } } });
// Les embeds importent des modules qui ouvrent les bases : on les attend et on les
// ferme, sinon le dossier jetable disparaît sous leurs pieds.
await openDatabases();
const embeds = await import("../modules/pokemon/embeds.js");
const data = await import("../modules/pokemon/data.js");
const { getPokemonConfig, getSafariConfig } = await import("../modules/pokemon/config.js");

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

describe("la comparaison de deux dresseurs (/pk comparer)", () => {
  const GEN1 = { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } };
  const entry = (speciesId, overrides = {}) => ({
    speciesId, arrivalId: speciesId, total: 3, normal: 3, shiny: 0, free: 3, freeNormal: 3, spare: 2, reserved: 0, ...overrides,
  });
  const matchOf = (give, get) => ({ give, get, swaps: Math.min(give.length, get.length) });
  const entriesOf = (from, count, overrides = {}) =>
    data.allSpecies().slice(from, from + count).map((one) => entry(one.id, overrides));
  const partner = { id: "p1", username: "p", displayName: "Partenaire" };
  const state = (overrides = {}) => ({ partner, reserve: false, ...overrides });
  const size = () => Math.max(1, Math.floor(getPokemonConfig().box.pageSize));
  const json = (view) => ({ embed: view.embeds[0].toJSON(), rows: view.components.map((row) => row.toJSON()) });
  const idsOf = (rows) => rows.flatMap((row) => row.components.map((component) => component.custom_id));

  it("deux listes qui se partagent la même page : la plus courte s'arrête, l'autre continue", () => {
    const match = matchOf(entriesOf(0, size() * 2 + 3), entriesOf(60, 3));
    assert.equal(embeds.comparePage(match, 0).pages, 3);

    const first = json(embeds.buildCompareView(match, state()));
    assert.match(first.embed.description, /Tu peux donner\*\* \(\d+\)\n`#001` \*\*Bulbizarre\*\*/);
    assert.match(first.embed.description, /Tu peux recevoir\*\* \(3\)\n`#061`/);
    assert.match(first.embed.footer.text, /^Page 1\/3/);

    const last = json(embeds.buildCompareView(match, state({ page: 2 })));
    assert.match(last.embed.description, /Tu peux recevoir\*\* \(3\)\n\*Rien de plus sur cette page\.\*/, "la liste la plus courte n'a plus rien à montrer");
    assert.match(last.embed.footer.text, /^Page 3\/3/);
    assert.deepEqual(last.rows.map((row) => row.components.length), [1, 4], "pas de menu pour un côté sans ligne sur cette page : un menu, puis ◀ 3/3 ▶ et le bouton");

    const beyond = json(embeds.buildCompareView(match, state({ page: 99 })));
    assert.match(beyond.embed.footer.text, /^Page 3\/3/, "une page hors limites retombe sur la dernière");
  });

  it("chaque menu ne propose que les lignes de la page, jamais plus que Discord n'accepte", () => {
    sandbox.writeConfig({ pokemon: { ...GEN1, box: { pageSize: 25 } } });
    try {
      const wide = entriesOf(0, 60, { arrivalId: species("Mackogneur").id, shiny: 9, free: 99, freeNormal: 0, spare: 99, total: 99 });
      const match = matchOf(wide, entriesOf(70, 60, { arrivalId: species("Mackogneur").id, shiny: 9, free: 99, freeNormal: 0, spare: 99, total: 99 }));
      for (const page of [0, 1, 2]) {
        const { embed, rows } = json(embeds.buildCompareView(match, state({ page })));
        assert.ok(embed.description.length <= 4096, `page ${page} : ${embed.description.length} caractères de description`);
        assert.ok(embed.title.length <= 256 && embed.footer.text.length <= 2048);
        assert.ok(rows.length <= 5);
        const ids = idsOf(rows);
        assert.equal(new Set(ids).size, ids.length, "Discord refuse un message dont deux composants partagent un customId");
        for (const id of ids) assert.ok(id.length <= 100, `${id} : ${id.length} caractères`);
        for (const menu of rows.filter((row) => row.components[0].type === 3)) {
          const [select] = menu.components;
          assert.ok(select.options.length >= 1 && select.options.length <= 25);
          for (const option of select.options) {
            assert.ok(option.label.length <= 100 && option.description.length <= 100 && option.value.length <= 100);
          }
        }
        for (const row of rows) assert.ok(row.components.length <= 5);
      }
    } finally {
      sandbox.writeConfig({ pokemon: GEN1 });
    }
  });

  it("une page réglée à la main au-delà de 25 lignes ne fait pas planter les menus", () => {
    sandbox.writeConfig({ pokemon: { ...GEN1, box: { pageSize: 40 } } });
    try {
      const match = matchOf(entriesOf(0, 40), entriesOf(60, 40));
      const { rows } = json(embeds.buildCompareView(match, state()));
      const menus = rows.filter((row) => row.components[0].type === 3);
      assert.deepEqual(menus.map((menu) => menu.components[0].options.length), [25, 25]);
    } finally {
      sandbox.writeConfig({ pokemon: GEN1 });
    }
  });

  it("le choix coche l'option et active le bouton ; un choix qui n'est plus proposé est écarté", () => {
    const match = matchOf(entriesOf(0, 3), entriesOf(10, 3));
    const [a, , c] = match.give;
    const [d] = match.get;
    const chosen = json(embeds.buildCompareView(match, state({ give: c.speciesId, get: d.speciesId })));
    assert.deepEqual(chosen.embed.fields, [{ name: "🤝 Échange choisi", value: `**${data.getSpecies(c.speciesId).name}** ⇄ **${data.getSpecies(d.speciesId).name}**` }]);
    const [giveMenu, getMenu, paging] = chosen.rows;
    assert.deepEqual(giveMenu.components[0].options.map((option) => option.default), [false, false, true]);
    assert.deepEqual(getMenu.components[0].options.map((option) => option.default), [true, false, false]);
    assert.equal(paging.components.at(-1).disabled, false);
    assert.equal(paging.components.at(-1).custom_id, `poke_cmpgo|p1|${c.speciesId}|${d.speciesId}|0`);
    assert.equal(giveMenu.components[0].custom_id, `poke_cmpg|p1|${d.speciesId}|0|0`);
    assert.equal(getMenu.components[0].custom_id, `poke_cmpr|p1|${c.speciesId}|0|0`);

    const stale = json(embeds.buildCompareView(match, state({ give: 9999, get: a.speciesId })));
    assert.equal(stale.embed.fields, undefined, "ni l'un ni l'autre n'est proposé");
    assert.equal(stale.rows.at(-1).components.at(-1).disabled, true);
    assert.equal(stale.rows.at(-1).components.at(-1).custom_id, "poke_cmpgo|p1|0|0|0");
  });

  it("sans échange possible, il n'y a rien à choisir : ni menu ni bouton, et la pagination seulement s'il y a plusieurs pages", () => {
    const oneSided = matchOf(entriesOf(0, 3), []);
    assert.deepEqual(embeds.buildCompareView(oneSided, state()).components, []);
    const many = matchOf(entriesOf(0, size() + 1), []);
    const { rows } = json(embeds.buildCompareView(many, state()));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].components.length, 3, "◀, la page, ▶ : pas de bouton qui propose");
    assert.deepEqual(json(embeds.buildCompareView(matchOf([], []), state())).rows, []);
  });

  it("une ligne dit le numéro, le nom, combien peuvent partir, les shiny et l'espèce qui arrivera", () => {
    const machop = species("Machopeur");
    const match = matchOf(
      [
        entry(species("Rattata").id),
        entry(species("Roucool").id, { spare: 1, free: 2, freeNormal: 1 }),
        entry(species("Pikachu").id, { spare: 3, free: 3, freeNormal: 1 }),
        entry(machop.id, { arrivalId: species("Mackogneur").id, spare: 1 }),
      ],
      [entry(species("Chenipan").id)]
    );
    const { embed } = json(embeds.buildCompareView(match, state()));
    assert.match(embed.description, /`#019` \*\*Rattata\*\* ×2\n/);
    assert.match(embed.description, /\*\*Roucool\*\* ✨\n/, "un shiny peut partir : signalé, sans nombre quand il n'y en a qu'un");
    assert.match(embed.description, /\*\*Pikachu\*\* ×3 ✨2\n/);
    assert.match(embed.description, /\*\*Machopeur\*\* · arrive en \*\*Mackogneur\*\*/);
    assert.match(embed.footer.text, /✨ : un shiny fait partie de ceux qui peuvent partir/);
  });

  it("le nombre d'échanges s'accorde, et la réserve d'évolution se signale quand elle est active", () => {
    const one = json(embeds.buildCompareView(matchOf(entriesOf(0, 1), entriesOf(5, 1)), state({ reserve: true })));
    assert.match(one.embed.description, /\*\*1 échange possible\*\* : une espèce contre une espèce/);
    assert.match(one.embed.description, /🧬 De chaque côté/);
    const two = json(embeds.buildCompareView(matchOf(entriesOf(0, 2), entriesOf(5, 2)), state()));
    assert.match(two.embed.description, /\*\*2 échanges possibles\*\*/);
    assert.doesNotMatch(two.embed.description, /🧬/);
  });

  it("avec qui échanger : une ligne par dresseur, des pages, et le dit quand personne ne convient", () => {
    const list = Array.from({ length: size() + 2 }, (_, index) => ({ userId: `p-${String(index).padStart(2, "0")}`, swaps: index === 0 ? 1 : 2, give: 3, get: 2 }));
    const page0 = embeds.buildPartnersEmbed(list, { reserve: false }).toJSON();
    assert.match(page0.description, /<@p-00> · \*\*1\*\* échange · 🎁 3 · 📥 2/);
    assert.match(page0.description, /<@p-01> · \*\*2\*\* échanges/);
    assert.match(page0.footer.text, new RegExp(`^Page 1/2 · ${size() + 2} dresseurs`));
    const page1 = embeds.buildPartnersEmbed(list, { page: 1, reserve: false }).toJSON();
    assert.doesNotMatch(page1.description, /<@p-00>/, "la seconde page ne répète pas la première");
    assert.deepEqual(embeds.buildPartnersRow(list.length, 1, { reserve: true }).toJSON().components.map((button) => button.custom_id), ["poke_cmpt|1|0|prev", "poke_cmpt_noop|1", "poke_cmpt|1|0|next"]);

    const none = embeds.buildPartnersEmbed([], { reserve: true }).toJSON();
    assert.match(none.description, /Personne n'a de quoi échanger avec toi pour l'instant/);
    assert.match(none.description, /🧬/);
    const nothingToGive = embeds.buildPartnersEmbed([], { reserve: false, offers: 0 }).toJSON();
    assert.match(nothingToGive.description, /Tu n'as aucun doublon à offrir pour l'instant/, "quand c'est le dresseur qui n'a rien à donner, on n'accuse pas les autres");
    assert.doesNotMatch(nothingToGive.description, /Personne n'a de quoi/);
    assert.match(embeds.buildPartnersEmbed([], { reserve: false, offers: 3 }).toJSON().description, /Personne n'a de quoi échanger/);
  });

  it("qui a besoin d'une espèce : ce que chacun donnerait en retour, et la forme qui arrive quand elle change", () => {
    const machop = species("Machopeur");
    const offer = entry(machop.id, { arrivalId: species("Mackogneur").id, spare: 1, free: 2, freeNormal: 1 });
    const list = [{ userId: "n-a", back: 2 }, { userId: "n-b", back: 1 }, { userId: "n-c", back: 0 }];
    const json1 = embeds.buildNeedersEmbed(machop, offer, list, { reserve: false }).toJSON();
    assert.equal(json1.title, "📥 Qui a besoin de Machopeur");
    assert.match(json1.description, /Tu peux donner \*\*1\*\* Machopeur ✨\. Voici ceux à qui \*\*Mackogneur\*\* manque : Machopeur y arrive sous cette forme/);
    assert.match(json1.description, /<@n-a> · peut te donner \*\*2\*\* espèces en retour/);
    assert.match(json1.description, /<@n-b> · peut te donner \*\*1\*\* espèce en retour/);
    assert.match(json1.description, /<@n-c> · rien à te donner en retour/);

    const plain = embeds.buildNeedersEmbed(species("Rattata"), entry(species("Rattata").id), [], { reserve: false }).toJSON();
    assert.match(plain.description, /Voici ceux à qui il manque\./);
    assert.match(plain.description, /Tout le monde a déjà un Rattata/);
    assert.deepEqual(embeds.buildNeedersRow(species("Rattata").id, 3, 0, { reserve: true }).toJSON().components.map((button) => button.custom_id), [`poke_cmpn|${species("Rattata").id}|1|0|prev`, `poke_cmpn_noop|${species("Rattata").id}`, `poke_cmpn|${species("Rattata").id}|1|0|next`]);
  });
});
