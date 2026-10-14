// Génère les tables de pêche officielles de la génération 2.
//
// Usage : node scripts/generate-fishing-data.js [--csv-dir ./chemin]
//
// Les rencontres par canne (old-rod, good-rod, super-rod) viennent des CSV de PokéAPI
// pour Or, Argent et Cristal, par zone : dans chaque zone, la rareté d'un créneau est son
// pourcentage de chance. Le jeu n'a pas de zones, donc chaque zone de chaque version pèse
// autant, et le poids d'une espèce est la moyenne de ses chances sur toutes les zones où la
// canne pêche. Le résultat est un pourcentage par espèce, qui totalise 100 par canne.
//
// Le fichier produit (modules/pokemon-fishing.json) est commité : la production ne fait
// AUCUN appel réseau, et la config peut ajuster ce qui s'en sert. --csv-dir lit les CSV
// déjà présents sur le disque, comme generate-pokemon-data.js.
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_BASE = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";
const CSV_FILES = ["encounters.csv", "encounter_slots.csv", "encounter_methods.csv", "versions.csv"];
const VERSIONS = ["gold", "silver", "crystal"];
// Les noms de PokéAPI, et la clé qu'en fait le jeu (une canne = un pool).
const RODS = { "old-rod": "old", "good-rod": "good", "super-rod": "super" };

const csvDir = process.argv.includes("--csv-dir")
  ? process.argv[process.argv.indexOf("--csv-dir") + 1]
  : null;

// Ces CSV n'ont aucun champ entre guillemets : un découpage simple suffit.
const parse = (text) => {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const names = header.split(",");
  return lines.map((line) => Object.fromEntries(line.split(",").map((value, i) => [names[i], value])));
};

async function read(file) {
  if (csvDir) return parse(fs.readFileSync(path.join(csvDir, file), "utf8"));
  const { data } = await axios.get(`${CSV_BASE}/${file}`, { responseType: "text", timeout: 60_000 });
  return parse(data);
}

const [encounters, slots, methods, versions] = await Promise.all(CSV_FILES.map(read));

const versionIds = new Set(versions.filter((row) => VERSIONS.includes(row.identifier)).map((row) => row.id));
const methodOf = new Map(methods.map((row) => [row.id, row.identifier]));
const slotInfo = new Map(slots.map((row) => [row.id, { method: methodOf.get(row.encounter_method_id), rarity: Number(row.rarity) }]));

// (version, zone, canne) → rareté cumulée par espèce.
const areas = new Map();
for (const row of encounters) {
  if (!versionIds.has(row.version_id)) continue;
  const slot = slotInfo.get(row.encounter_slot_id);
  if (!slot || !(slot.method in RODS)) continue;
  const key = `${row.version_id}|${row.location_area_id}|${slot.method}`;
  const area = areas.get(key) ?? new Map();
  area.set(Number(row.pokemon_id), (area.get(Number(row.pokemon_id)) ?? 0) + slot.rarity);
  areas.set(key, area);
}

const totals = Object.fromEntries(Object.values(RODS).map((rod) => [rod, new Map()]));
const counts = Object.fromEntries(Object.values(RODS).map((rod) => [rod, 0]));
for (const [key, area] of areas) {
  const rod = RODS[key.split("|")[2]];
  const sum = [...area.values()].reduce((a, b) => a + b, 0) || 1;
  counts[rod]++;
  for (const [speciesId, rarity] of area) {
    totals[rod].set(speciesId, (totals[rod].get(speciesId) ?? 0) + rarity / sum);
  }
}

const output = {
  source: "PokéAPI CSV dataset (github.com/PokeAPI/pokeapi, data/v2/csv) — Or, Argent, Cristal",
  generatedAt: new Date().toISOString(),
  zones: counts,
  // [identifiant d'espèce, pourcentage], du plus fréquent au plus rare.
  rods: Object.fromEntries(
    Object.entries(totals).map(([rod, map]) => [
      rod,
      [...map]
        .map(([speciesId, weight]) => [speciesId, Math.round((10000 * weight) / counts[rod]) / 100])
        .filter(([, weight]) => weight > 0)
        .sort((a, b) => b[1] - a[1] || a[0] - b[0]),
    ])
  ),
};

const target = path.join(__dirname, "..", "modules", "pokemon-fishing.json");
// Une paire par ligne : le fichier se relit et se retouche à la main.
const text = JSON.stringify(output, null, 1).replace(/\[\n\s+(\d+),\n\s+([\d.]+)\n\s+\]/g, "[$1, $2]");
fs.writeFileSync(target, text + "\n");
for (const [rod, list] of Object.entries(output.rods)) {
  const total = list.reduce((sum, [, weight]) => sum + weight, 0);
  console.log(`${rod} : ${list.length} espèces, ${counts[rod]} zones, total ${total.toFixed(1)} %`);
}
