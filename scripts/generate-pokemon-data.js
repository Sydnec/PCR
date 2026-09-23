// Génère le dataset Pokémon utilisé par le système de capture.
//
// Usage : node scripts/generate-pokemon-data.js [--gen 2] [--csv-dir ./chemin]
//
// --gen est la DERNIÈRE génération incluse : le fichier contient toutes les
// espèces jusqu'à elle, et le bot n'en montre que celles des générations
// activées (`pokemon.generation`). Préparer une génération, c'est donc
// régénérer ce fichier ; l'ouvrir aux joueurs, c'est un réglage à chaud.
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

const GENERATION = Number(argOf("--gen") || 2);
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

  // pokemon_types référence les formes ; l'id de la forme par défaut est égal
  // à l'id d'espèce, ce qui suffit ici.
  const typesBySpecies = new Map();
  for (const row of pokemonTypeRows) {
    const id = Number(row.pokemon_id);
    if (!species.has(id)) continue;
    const list = typesBySpecies.get(id) || [];
    list[Number(row.slot) - 1] = frenchTypes.get(Number(row.type_id));
    typesBySpecies.set(id, list);
  }

  // Espèces obtenues par échange : elles ne doivent jamais apparaître à l'état
  // sauvage, seules la fusion de doublons et l'échange y donnent accès. La
  // génération 2 en ajoute six, dont la source est souvent de génération 1
  // (Onix, Insécateur, Hypocéan, Ramoloss, Têtard, Porygon) : c'est la cible
  // qui porte le marqueur, et elle reste cachée tant que sa génération l'est.
  const tradeEvolutions = new Set();
  for (const row of evolutionRows) {
    if (row.evolution_trigger_id === TRADE_TRIGGER) {
      tradeEvolutions.add(Number(row.evolved_species_id));
    }
  }

  const inGeneration = (id) =>
    species.has(id) && Number(species.get(id).generation_id) <= GENERATION;
  const isBaby = (id) => species.get(id).is_baby === "1";

  const preEvolutionOf = (id) => {
    const raw = species.get(id).evolves_from_species_id;
    return raw ? Number(raw) : null;
  };

  // Le stade se calcule en remontant la chaîne, sans compter les bébés et en
  // s'arrêtant dès qu'on sort des générations incluses. Sans ce garde-fou, 11
  // Pokémon de génération 1 (Pikachu <- Pichu, Ronflex <- Goinfrex, Leveinard
  // <- Ptiravi...) seraient classés en stade 2 ou 3 à cause de bébés introduits
  // plus tard, et deviendraient ultra-rares à tort — et ouvrir la génération 2
  // rebattrait les raretés de la première. Le stade ne dépend donc jamais des
  // générations activées : un bébé est de stade 1, sa forme adulte aussi.
  const stageOf = (id) => {
    let stage = 1;
    let current = id;
    while (true) {
      const previous = preEvolutionOf(current);
      if (previous === null || !inGeneration(previous)) return stage;
      if (!isBaby(previous)) stage++;
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
    maxGeneration: GENERATION,
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
        isBaby: isBaby(id),
        tradeEvolution: tradeEvolutions.has(id),
        types: (typesBySpecies.get(id) || []).filter(Boolean),
        evolvesFrom: previous !== null && inGeneration(previous) ? previous : null,
        evolvesInto: evolutionsOf.get(id),
        sprite: `${SPRITE_BASE}/${id}.png`,
        spriteShiny: `${SPRITE_BASE}/shiny/${id}.png`,
      };
    }),
  };

  const outputPath = path.join(__dirname, "../modules/pokemon-data.json");
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
  console.log(
    `   Bébés : ${dataset.species.filter((s) => s.isBaby).map((s) => s.name).join(", ")}`
  );
}

main().catch((error) => {
  console.error("❌ Échec de la génération :", error.message);
  process.exit(1);
});
