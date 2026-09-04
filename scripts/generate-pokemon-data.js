// Génère le dataset Pokémon utilisé par le système de capture.
//
// Usage : node scripts/generate-pokemon-data.js [--gen 1] [--csv-dir ./chemin]
//
// Les données proviennent du dataset CSV officiel de PokéAPI, servi par
// raw.githubusercontent.com (pokeapi.co lui-même est bloqué par certains proxys).
// Le fichier produit est commité : la production ne fait AUCUN appel réseau.
//
// --csv-dir lit les CSV déjà présents sur le disque au lieu de les télécharger,
// pour régénérer hors-ligne ou derrière un proxy récalcitrant. Les fichiers
// attendus sont ceux listés dans CSV_FILES ci-dessous.
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CSV_BASE =
  "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";
const SPRITE_BASE =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork";

// Identifiant de la langue française dans le dataset PokéAPI
const FRENCH = "5";
// Identifiant du déclencheur d'évolution "échange" dans evolution_triggers.csv
const TRADE_TRIGGER = "2";

const CSV_FILES = [
  "pokemon_species.csv",
  "pokemon_species_names.csv",
  "pokemon_types.csv",
  "type_names.csv",
  "pokemon_evolution.csv",
];

const argOf = (flag) => {
  const index = process.argv.indexOf(flag);
  return index !== -1 ? process.argv[index + 1] : null;
};

const GENERATION = argOf("--gen") || "1";
const CSV_DIR = argOf("--csv-dir");

// Parseur CSV minimal : gère les champs entre guillemets et les guillemets doublés.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift();
  return rows.map((cells) =>
    Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]))
  );
}

async function loadCsv(fileName) {
  if (CSV_DIR) {
    return parseCsv(fs.readFileSync(path.resolve(CSV_DIR, fileName), "utf8"));
  }
  const { data } = await axios.get(`${CSV_BASE}/${fileName}`, {
    headers: { "User-Agent": "PCR-bot/1.0 (dataset generator)" },
    responseType: "text",
    transformResponse: [(d) => d],
  });
  return parseCsv(data);
}

async function main() {
  console.log(
    CSV_DIR
      ? `Lecture du dataset PokéAPI depuis ${CSV_DIR} (génération ${GENERATION})...`
      : `Téléchargement du dataset PokéAPI (génération ${GENERATION})...`
  );
  const [
    speciesRows,
    speciesNameRows,
    pokemonTypeRows,
    typeNameRows,
    evolutionRows,
  ] = await Promise.all(CSV_FILES.map(loadCsv));

  const species = new Map(speciesRows.map((r) => [Number(r.id), r]));

  const frenchNames = new Map();
  for (const row of speciesNameRows) {
    if (row.local_language_id === FRENCH) {
      frenchNames.set(Number(row.pokemon_species_id), row.name);
    }
  }

  const frenchTypes = new Map();
  for (const row of typeNameRows) {
    if (row.local_language_id === FRENCH) {
      frenchTypes.set(Number(row.type_id), row.name);
    }
  }

  // pokemon_types référence les formes ; en génération 1 l'id de forme par
  // défaut est égal à l'id d'espèce, ce qui suffit ici.
  const typesBySpecies = new Map();
  for (const row of pokemonTypeRows) {
    const id = Number(row.pokemon_id);
    if (!species.has(id)) continue;
    const list = typesBySpecies.get(id) || [];
    list[Number(row.slot) - 1] = frenchTypes.get(Number(row.type_id));
    typesBySpecies.set(id, list);
  }

  // Espèces obtenues par échange : elles ne doivent jamais apparaître à l'état
  // sauvage, seule la fusion de doublons y donne accès.
  const tradeEvolutions = new Set();
  for (const row of evolutionRows) {
    if (row.evolution_trigger_id === TRADE_TRIGGER) {
      tradeEvolutions.add(Number(row.evolved_species_id));
    }
  }

  const inGeneration = (id) =>
    species.has(id) && species.get(id).generation_id === GENERATION;

  const preEvolutionOf = (id) => {
    const raw = species.get(id).evolves_from_species_id;
    return raw ? Number(raw) : null;
  };

  // Le stade se calcule en remontant la chaîne, mais en s'arrêtant dès qu'on
  // sort de la génération ciblée. Sans ce garde-fou, 11 Pokémon de génération 1
  // (Pikachu <- Pichu, Ronflex <- Goinfrex, Leveinard <- Ptiravi...) seraient
  // classés en stade 2 ou 3 à cause de bébés introduits plus tard, et
  // deviendraient ultra-rares à tort.
  const stageOf = (id) => {
    let stage = 1;
    let current = id;
    while (true) {
      const previous = preEvolutionOf(current);
      if (previous === null || !inGeneration(previous)) return stage;
      stage++;
      current = previous;
    }
  };

  const ids = [...species.keys()].filter(inGeneration).sort((a, b) => a - b);

  const evolutionsOf = new Map(ids.map((id) => [id, []]));
  for (const id of ids) {
    const previous = preEvolutionOf(id);
    if (previous !== null && inGeneration(previous)) {
      evolutionsOf.get(previous).push(id);
    }
  }

  const dataset = {
    generation: Number(GENERATION),
    generatedAt: new Date().toISOString().slice(0, 10),
    source: "PokéAPI CSV dataset (github.com/PokeAPI/pokeapi, data/v2/csv)",
    species: ids.map((id) => {
      const row = species.get(id);
      const previous = preEvolutionOf(id);
      return {
        id,
        name: frenchNames.get(id) || row.identifier,
        slug: row.identifier,
        generation: Number(row.generation_id),
        catchRate: Number(row.capture_rate),
        stage: stageOf(id),
        isLegendary: row.is_legendary === "1",
        isMythical: row.is_mythical === "1",
        tradeEvolution: tradeEvolutions.has(id),
        types: (typesBySpecies.get(id) || []).filter(Boolean),
        evolvesFrom: previous !== null && inGeneration(previous) ? previous : null,
        evolvesInto: evolutionsOf.get(id),
        sprite: `${SPRITE_BASE}/${id}.png`,
        spriteShiny: `${SPRITE_BASE}/shiny/${id}.png`,
      };
    }),
  };

  const outputPath = path.join(
    __dirname,
    `../modules/pokemon-gen${GENERATION}.json`
  );
  fs.writeFileSync(outputPath, JSON.stringify(dataset, null, 2) + "\n");

  const byStage = dataset.species.reduce((acc, s) => {
    acc[s.stage] = (acc[s.stage] || 0) + 1;
    return acc;
  }, {});
  const legendaries = dataset.species.filter((s) => s.isLegendary || s.isMythical);
  const trades = dataset.species.filter((s) => s.tradeEvolution);

  console.log(`✅ ${dataset.species.length} espèces écrites dans ${outputPath}`);
  console.log(`   Stades : ${JSON.stringify(byStage)}`);
  console.log(`   Légendaires : ${legendaries.map((s) => s.name).join(", ")}`);
  console.log(`   Évolutions par échange : ${trades.map((s) => s.name).join(", ")}`);
}

main().catch((error) => {
  console.error("❌ Échec de la génération :", error.message);
  process.exit(1);
});
