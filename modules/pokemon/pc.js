// La boîte PC du site : des boîtes nommées où chacun range ses Pokémon comme il
// l'entend, et des surnoms. Rien de tout ça ne change le jeu — ni ce qu'on
// possède, ni ce qui peut partir — : c'est du rangement, réservé au site, où
// glisser un Pokémon d'une case à l'autre a un sens.
//
// Une place (`pc_pos`) est un numéro de case sur l'ensemble des boîtes : boîte =
// pc_pos / slotsPerBox. Elle se retient dans la ligne de l'individu et le suit
// quand il évolue. Deux Pokémon peuvent prétendre à la même case après une
// course ou un échange : la disposition le tranche à la lecture (le premier
// arrivé la garde, l'autre prend la première case libre), si bien qu'aucune
// place n'a besoin d'être réservée et que rien ne peut se perdre. Un Pokémon qui
// arrive sans place en reçoit une à la première lecture du PC.
import db from "../points-db.js";
import { handleException } from "../utils.js";
import { getPokemonConfig } from "./config.js";
import { getIndividuals } from "./collection.js";

export function pcConfig() {
  const pc = getPokemonConfig().pc ?? {};
  const slotsPerBox = Math.max(1, Math.round(Number(pc.slotsPerBox) || 30));
  const maxBoxes = Math.max(1, Math.round(Number(pc.maxBoxes) || 60));
  return {
    slotsPerBox,
    columns: Math.max(1, Math.round(Number(pc.columns) || 6)),
    minBoxes: Math.min(maxBoxes, Math.max(1, Math.round(Number(pc.minBoxes) || 8))),
    maxBoxes,
    boxNameLength: Math.max(1, Math.round(Number(pc.boxNameLength) || 20)),
    nicknameLength: Math.max(1, Math.round(Number(pc.nicknameLength) || 12)),
  };
}

const validPos = (value) => Number.isInteger(value) && value >= 0;

// La place de chaque individu. Ceux qui ont une place la gardent (le plus
// ancien l'emporte sur une case disputée) ; les autres, dans l'ordre de leur
// arrivée, prennent les premières cases libres.
export function layoutPc(rows) {
  const taken = new Set();
  const placed = [];
  const waiting = [];
  const byPos = [...rows].sort(
    (a, b) => (a.pc_pos ?? Infinity) - (b.pc_pos ?? Infinity) || a.id - b.id
  );
  for (const row of byPos) {
    if (validPos(row.pc_pos) && !taken.has(row.pc_pos)) {
      taken.add(row.pc_pos);
      placed.push({ row, pos: row.pc_pos });
    } else {
      waiting.push(row);
    }
  }
  waiting.sort((a, b) => a.obtained_at - b.obtained_at || a.id - b.id);
  let next = 0;
  for (const row of waiting) {
    while (taken.has(next)) next++;
    taken.add(next);
    placed.push({ row, pos: next });
  }
  return placed;
}

// Retient les places attribuées à la lecture. La garde sur l'ancienne valeur
// évite d'écraser un déplacement arrivé entre-temps.
function persistLayout(layout) {
  for (const { row, pos } of layout) {
    if (row.pc_pos === pos) continue;
    db.run(
      "UPDATE pokemon_owned SET pc_pos = ? WHERE id = ? AND user_id = ? AND pc_pos IS ?",
      [pos, row.id, row.user_id, row.pc_pos ?? null],
      (err) => {
        if (err) handleException("Rangement de la boîte PC :", err);
      }
    );
  }
}

function boxNames(userId, cb) {
  db.all("SELECT box, name FROM pokemon_pc_boxes WHERE user_id = ?", [userId], (err, rows) =>
    cb(err, new Map((rows ?? []).map((row) => [row.box, row.name])))
  );
}

export const defaultBoxName = (box) => `Boîte ${box + 1}`;

// Le PC d'un dresseur : ses boîtes (nom compris) et la place de chacun de ses
// Pokémon. Autant de boîtes qu'il en faut, plus une vide pour pouvoir y ranger.
export function getPc(userId, cb) {
  const config = pcConfig();
  getIndividuals(userId, (err, rows) => {
    if (err) return cb(err);
    boxNames(userId, (err, names) => {
      if (err) return cb(err);
      const layout = layoutPc(rows);
      persistLayout(layout);
      const lastBox = layout.reduce(
        (max, { pos }) => Math.max(max, Math.floor(pos / config.slotsPerBox)),
        -1
      );
      const count = Math.max(config.minBoxes, Math.min(config.maxBoxes, lastBox + 2), lastBox + 1);
      cb(null, {
        config,
        boxes: Array.from({ length: count }, (_, box) => ({
          box,
          name: names.get(box) ?? defaultBoxName(box),
          custom: names.has(box),
          defaultName: defaultBoxName(box),
        })),
        layout,
      });
    });
  });
}

// Range un Pokémon à une case. Si elle est occupée, l'occupant prend la place
// qu'il quitte : un échange de cases, comme dans les jeux.
export function movePokemon(userId, pokemonId, targetPos, cb) {
  const config = pcConfig();
  if (!validPos(targetPos) || targetPos >= config.maxBoxes * config.slotsPerBox) {
    return cb(null, { ok: false, reason: "Cette case n'existe pas." });
  }
  getIndividuals(userId, (err, rows) => {
    if (err) return cb(err);
    const layout = layoutPc(rows);
    const moving = layout.find(({ row }) => row.id === pokemonId);
    if (!moving)
      return cb(null, { ok: false, reason: `Le Pokémon #${pokemonId} n'est pas à toi.` });
    if (moving.pos === targetPos) return cb(null, { ok: true });
    const occupant = layout.find(({ pos }) => pos === targetPos);

    // Chaque écriture est gardée par la place lue : un déplacement fait entre-temps
    // depuis un autre onglet n'est jamais écrasé. Si c'est l'occupant qui a
    // bougé, deux Pokémon peuvent se retrouver sur la même case, ce que la
    // lecture suivante tranche sans rien perdre.
    const place = ({ row }, pos, next) =>
      db.run(
        "UPDATE pokemon_owned SET pc_pos = ? WHERE id = ? AND user_id = ? AND pc_pos IS ?",
        [pos, row.id, userId, row.pc_pos ?? null],
        function (err) {
          next(err, this ? this.changes === 1 : false);
        }
      );
    place(moving, targetPos, (err, moved) => {
      if (err) return cb(err);
      if (!moved) {
        return cb(null, {
          ok: false,
          reason: `Le Pokémon #${pokemonId} a bougé entre-temps : recharge ta boîte.`,
        });
      }
      if (!occupant) return cb(null, { ok: true });
      place(occupant, moving.pos, (err) => (err ? cb(err) : cb(null, { ok: true })));
    });
  });
}

// Un nom saisi par un dresseur : une ligne, sans caractères de contrôle, sans
// espaces superflus, et pas plus long que la configuration ne le permet. Vide,
// il vaut « pas de nom ».
function cleanName(value, maxLength) {
  const text = String(value ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...text].slice(0, maxLength).join("") || null;
}

export function renameBox(userId, box, name, cb) {
  const config = pcConfig();
  if (!Number.isInteger(box) || box < 0 || box >= config.maxBoxes) {
    return cb(null, { ok: false, reason: "Cette boîte n'existe pas." });
  }
  const clean = cleanName(name, config.boxNameLength);
  // Un nom vide rend à la boîte son nom par défaut.
  if (!clean) {
    return db.run(
      "DELETE FROM pokemon_pc_boxes WHERE user_id = ? AND box = ?",
      [userId, box],
      (err) => (err ? cb(err) : cb(null, { ok: true, name: defaultBoxName(box), custom: false }))
    );
  }
  db.run(
    `INSERT INTO pokemon_pc_boxes (user_id, box, name) VALUES (?, ?, ?)
     ON CONFLICT (user_id, box) DO UPDATE SET name = excluded.name`,
    [userId, box, clean],
    (err) => (err ? cb(err) : cb(null, { ok: true, name: clean, custom: true }))
  );
}

export function renamePokemon(userId, pokemonId, nickname, cb) {
  const clean = cleanName(nickname, pcConfig().nicknameLength);
  db.run(
    "UPDATE pokemon_owned SET nickname = ? WHERE id = ? AND user_id = ?",
    [clean, pokemonId, userId],
    function (err) {
      if (err) return cb(err);
      if (this.changes !== 1) {
        return cb(null, { ok: false, reason: `Le Pokémon #${pokemonId} n'est pas à toi.` });
      }
      cb(null, { ok: true, nickname: clean });
    }
  );
}
