// La boîte PC du site : des boîtes nommées où chacun range ses Pokémon comme il
// l'entend, et des surnoms. Rien de tout ça ne change le jeu — ni ce qu'on
// possède, ni ce qui peut partir. Les places et les noms de boîtes sont du
// rangement réservé au site, où glisser un Pokémon d'une case à l'autre a un
// sens ; le surnom se donne aussi sur Discord (/pk renommer), par la même
// fonction (renamePokemon).
//
// Une place (`pc_pos`) est un numéro de case sur l'ensemble des boîtes : boîte =
// pc_pos / slotsPerBox. Elle se retient dans la ligne de l'individu et le suit
// quand il évolue. Deux Pokémon peuvent prétendre à la même case après une
// course ou un échange : la disposition le tranche à la lecture (le premier
// arrivé la garde, l'autre prend la première case libre), si bien qu'aucune
// place n'a besoin d'être réservée et que rien ne peut se perdre. Un Pokémon qui
// arrive sans place en reçoit une à la première lecture du PC.
//
// Une boîte archivée se range à part : elle passe en fin de liste sur le site,
// hors des flèches, et le placement automatique l'évite. On peut toujours y
// déposer un Pokémon à la main.
//
// On range aussi par lots : plusieurs Pokémon d'un coup dans une boîte, qui
// débordent dans les suivantes (movePokemonMany), et une boîte entière qui change
// de rang avec son nom, son archivage et son contenu (moveBox).
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
// arrivée, prennent les premières cases libres hors des boîtes archivées
// (`archived`, avec `slotsPerBox` et `maxBoxes`). Un PC plein jusqu'au plafond
// ne perd personne : le Pokémon prend alors une case libre d'une boîte
// archivée, et à défaut une case au-delà du plafond, comme avant l'archivage.
export function layoutPc(rows, { archived = new Set(), slotsPerBox = 1, maxBoxes = Infinity } = {}) {
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
  const limit = maxBoxes * slotsPerBox;
  const archivedPos = (pos) => archived.has(Math.floor(pos / slotsPerBox));
  const freeFrom = (start, accept) => {
    for (let pos = start; pos < limit; pos++) if (!taken.has(pos) && accept(pos)) return pos;
    return null;
  };
  let next = 0;
  for (const row of waiting) {
    let pos = freeFrom(0, (candidate) => !archivedPos(candidate)) ?? freeFrom(0, archivedPos);
    if (pos === null) {
      while (taken.has(next) || next < limit) next++;
      pos = next;
    }
    taken.add(pos);
    placed.push({ row, pos });
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

// Les boîtes réglées par le dresseur : leur nom (vide : celui par défaut) et
// leur archivage.
function boxSettings(userId, cb) {
  db.all(
    "SELECT box, name, archived FROM pokemon_pc_boxes WHERE user_id = ?",
    [userId],
    (err, rows) =>
      cb(
        err,
        new Map(
          (rows ?? []).map((row) => [row.box, { name: row.name || null, archived: Boolean(row.archived) }])
        )
      )
  );
}

const archivedBoxes = (settings) =>
  new Set([...settings].filter(([, entry]) => entry.archived).map(([box]) => box));

// Les individus d'un dresseur, ses réglages de boîtes et la disposition qui en
// découle : la lecture du PC comme le déplacement partent de la même.
function readPc(userId, config, cb) {
  getIndividuals(userId, (err, rows) => {
    if (err) return cb(err);
    boxSettings(userId, (err, settings) => {
      if (err) return cb(err);
      const archived = archivedBoxes(settings);
      cb(null, { settings, archived, layout: layoutPc(rows, { archived, ...config }) });
    });
  });
}

export const defaultBoxName = (box) => `Boîte ${box + 1}`;

// Le PC d'un dresseur : ses boîtes (nom compris) et la place de chacun de ses
// Pokémon. Autant de boîtes qu'il en faut, plus une vide pour pouvoir y ranger.
// La boîte vide de la fin doit pouvoir recevoir : une boîte archivée n'en
// tient pas lieu, il en vient une de plus.
// Combien de boîtes le PC montre : autant qu'il en faut, plus une vide pour
// pouvoir y ranger (voir getPc).
function boxCount(config, layout, archived) {
  const boxOf = (pos) => Math.floor(pos / config.slotsPerBox);
  const occupied = new Set(layout.map(({ pos }) => boxOf(pos)));
  const lastBox = Math.max(-1, ...occupied, ...archived);
  let count = Math.max(config.minBoxes, Math.min(config.maxBoxes, lastBox + 2), lastBox + 1);
  while (count < config.maxBoxes && (archived.has(count - 1) || occupied.has(count - 1))) count++;
  return count;
}

export function getPc(userId, cb) {
  const config = pcConfig();
  readPc(userId, config, (err, { settings, archived, layout } = {}) => {
    if (err) return cb(err);
    persistLayout(layout);
    const count = boxCount(config, layout, archived);
    cb(null, {
      config,
      boxes: Array.from({ length: count }, (_, box) => {
        const entry = settings.get(box);
        return {
          box,
          name: entry?.name ?? defaultBoxName(box),
          custom: Boolean(entry?.name),
          defaultName: defaultBoxName(box),
          archived: Boolean(entry?.archived),
        };
      }),
      layout,
    });
  });
}

// Archiver une boîte, ou la rendre aux autres. Une boîte vide ne s'archive
// pas : c'est celle qui reçoit, et l'archiver en ferait apparaître une autre,
// jusqu'au plafond.
export function archiveBox(userId, box, archived, cb) {
  const config = pcConfig();
  if (!Number.isInteger(box) || box < 0 || box >= config.maxBoxes) {
    return cb(null, { ok: false, reason: "Cette boîte n'existe pas." });
  }
  if (!archived) {
    // Sans nom à elle, la ligne n'a plus rien à retenir.
    return db.run(
      "UPDATE pokemon_pc_boxes SET archived = 0 WHERE user_id = ? AND box = ?",
      [userId, box],
      (err) => {
        if (err) return cb(err);
        db.run(
          "DELETE FROM pokemon_pc_boxes WHERE user_id = ? AND box = ? AND name = ''",
          [userId, box],
          (err) => (err ? cb(err) : cb(null, { ok: true, archived: false }))
        );
      }
    );
  }
  readPc(userId, config, (err, { layout } = {}) => {
    if (err) return cb(err);
    const inBox = layout.filter(({ pos }) => Math.floor(pos / config.slotsPerBox) === box).length;
    if (!inBox) {
      return cb(null, {
        ok: false,
        reason: "Cette boîte est vide : range-y d'abord des Pokémon pour l'archiver.",
      });
    }
    db.run(
      `INSERT INTO pokemon_pc_boxes (user_id, box, name, archived) VALUES (?, ?, '', 1)
       ON CONFLICT (user_id, box) DO UPDATE SET archived = 1`,
      [userId, box],
      (err) => (err ? cb(err) : cb(null, { ok: true, archived: true }))
    );
  });
}

// Range un Pokémon à une case. Si elle est occupée, l'occupant prend la place
// qu'il quitte : un échange de cases, comme dans les jeux.
export function movePokemon(userId, pokemonId, targetPos, cb) {
  const config = pcConfig();
  if (!validPos(targetPos) || targetPos >= config.maxBoxes * config.slotsPerBox) {
    return cb(null, { ok: false, reason: "Cette case n'existe pas." });
  }
  readPc(userId, config, (err, { layout } = {}) => {
    if (err) return cb(err);
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

// Écrit des places d'un coup : `moves` = [{ row, pos }], chaque place gardée par celle
// que la lecture a vue (`pc_pos IS ?`), comme movePokemon. Une instruction par lot
// de lignes, sous la limite de paramètres de SQLite : un rangement de 300 Pokémon ne
// fait pas 300 allers-retours. `cb(err, placed)` : combien ont vraiment bougé — un
// Pokémon déplacé entre-temps depuis un autre onglet garde sa nouvelle place.
const PLACE_CHUNK = 2000;
function placeMany(userId, moves, cb) {
  let placed = 0;
  const next = (start) => {
    const chunk = moves.slice(start, start + PLACE_CHUNK);
    if (!chunk.length) return cb(null, placed);
    db.run(
      `UPDATE pokemon_owned SET pc_pos = CASE id ${chunk.map(() => "WHEN ? THEN ?").join(" ")} END
        WHERE user_id = ? AND (${chunk.map(() => "(id = ? AND pc_pos IS ?)").join(" OR ")})`,
      [
        ...chunk.flatMap(({ row, pos }) => [row.id, pos]),
        userId,
        ...chunk.flatMap(({ row }) => [row.id, row.pc_pos ?? null]),
      ],
      function (err) {
        if (err) return cb(err, placed);
        placed += this.changes;
        next(start + PLACE_CHUNK);
      }
    );
  };
  next(0);
}

// Range plusieurs Pokémon dans une boîte : dans ses cases libres, puis dans celles des
// boîtes qui suivent, archivées exceptées (le placement automatique les évite aussi),
// dans l'ordre où ils sont rangés aujourd'hui. Ceux qui sont déjà dans la boîte visée
// y restent. Faute de place jusqu'au plafond, rien ne bouge et le refus donne les
// chiffres. `cb(err, { ok, moved, skipped })` : `skipped`, ceux qu'un autre onglet a
// déplacés entre la lecture et l'écriture.
export function movePokemonMany(userId, pokemonIds, targetBox, cb) {
  const config = pcConfig();
  if (!Number.isInteger(targetBox) || targetBox < 0 || targetBox >= config.maxBoxes) {
    return cb(null, { ok: false, reason: "Cette boîte n'existe pas." });
  }
  const ids = [...new Set(pokemonIds)];
  if (!ids.length) return cb(null, { ok: false, reason: "Choisis au moins un Pokémon." });
  readPc(userId, config, (err, { archived, settings, layout } = {}) => {
    if (err) return cb(err);
    const byId = new Map(layout.map((entry) => [entry.row.id, entry]));
    const stranger = ids.find((id) => !byId.has(id));
    if (stranger !== undefined) {
      return cb(null, { ok: false, reason: `Le Pokémon #${stranger} n'est pas à toi.` });
    }
    const boxOf = (pos) => Math.floor(pos / config.slotsPerBox);
    const selected = new Set(ids);
    const moving = layout
      .filter(({ row, pos }) => selected.has(row.id) && boxOf(pos) !== targetBox)
      .sort((a, b) => a.pos - b.pos);
    if (!moving.length) return cb(null, { ok: true, moved: 0, skipped: 0 });

    // Les cases que libèrent les Pokémon qui partent comptent comme libres.
    const taken = new Set(
      layout.filter(({ row, pos }) => !selected.has(row.id) || boxOf(pos) === targetBox).map(({ pos }) => pos)
    );
    const free = [];
    for (let box = targetBox; box < config.maxBoxes && free.length < moving.length; box++) {
      if (box !== targetBox && archived.has(box)) continue;
      for (let slot = 0; slot < config.slotsPerBox && free.length < moving.length; slot++) {
        const pos = box * config.slotsPerBox + slot;
        if (!taken.has(pos)) free.push(pos);
      }
    }
    if (free.length < moving.length) {
      const name = settings.get(targetBox)?.name ?? defaultBoxName(targetBox);
      return cb(null, {
        ok: false,
        reason:
          `Il ne reste que ${free.length.toLocaleString("fr-FR")} case${free.length > 1 ? "s" : ""} ` +
          `libre${free.length > 1 ? "s" : ""} à partir de « ${name} » (boîtes archivées non comprises), ` +
          `et tu en ranges ${moving.length.toLocaleString("fr-FR")}.`,
      });
    }
    const moves = moving
      .map((entry, index) => ({ row: entry.row, pos: free[index] }))
      .filter(({ row, pos }) => row.pc_pos !== pos);
    placeMany(userId, moves, (err, placed) => {
      if (err) return cb(err);
      cb(null, { ok: true, moved: placed, skipped: moves.length - placed });
    });
  });
}

// Change une boîte de rang, comme un onglet : la boîte `from` passe au rang `to` avec
// son nom, son archivage et ses Pokémon (chacun garde sa case), et les boîtes d'entre
// les deux se décalent d'un cran. Les Pokémon d'abord ; si les réglages des boîtes ne
// s'écrivent pas ensuite, les Pokémon reviennent à leur place, gardés sur celle qu'ils
// viennent de prendre : rien ne bouge à moitié.
export function moveBox(userId, from, to, cb) {
  const config = pcConfig();
  readPc(userId, config, (err, { settings, archived, layout } = {}) => {
    if (err) return cb(err);
    const count = boxCount(config, layout, archived);
    const valid = (box) => Number.isInteger(box) && box >= 0 && box < count;
    if (!valid(from) || !valid(to)) return cb(null, { ok: false, reason: "Cette boîte n'existe pas." });
    if (from === to) return cb(null, { ok: true });

    const [low, high] = from < to ? [from, to] : [to, from];
    const step = from < to ? -1 : 1;
    // Le nouveau rang de chaque boîte de l'intervalle.
    const rankOf = (box) => (box === from ? to : box >= low && box <= high ? box + step : box);
    const S = config.slotsPerBox;
    const boxOf = (pos) => Math.floor(pos / S);
    const moves = layout
      .filter(({ pos }) => boxOf(pos) >= low && boxOf(pos) <= high)
      .map(({ row, pos }) => ({ row, pos: rankOf(boxOf(pos)) * S + (pos % S), from: pos }))
      .filter(({ row, pos }) => row.pc_pos !== pos);

    // Une seule instruction pour tous les réglages de l'intervalle : renuméroter des
    // lignes une à une heurterait la clé (user_id, box) en chemin. Une boîte sans
    // réglage y prend une ligne vide (nom par défaut, non archivée), que la fin efface.
    const boxes = Array.from({ length: high - low + 1 }, (_, index) => low + index);
    const newSettings = boxes.map((box) => {
      const source = boxes.find((candidate) => rankOf(candidate) === box);
      const entry = settings.get(source);
      return [box, entry?.name ?? "", entry?.archived ? 1 : 0];
    });
    const writeSettings = (next) =>
      db.run(
        `INSERT INTO pokemon_pc_boxes (user_id, box, name, archived)
         VALUES ${newSettings.map(() => "(?, ?, ?, ?)").join(", ")}
         ON CONFLICT (user_id, box) DO UPDATE SET name = excluded.name, archived = excluded.archived`,
        newSettings.flatMap((entry) => [userId, ...entry]),
        next
      );

    placeMany(userId, moves, (err) => {
      if (err) return cb(err);
      writeSettings((settingsError) => {
        if (settingsError) {
          const back = moves.map(({ row, pos, from: previous }) => ({
            row: { ...row, pc_pos: pos },
            pos: row.pc_pos ?? previous,
          }));
          return placeMany(userId, back, (restoreError) => {
            if (restoreError) handleException("Retour des Pokémon d'une boîte déplacée :", restoreError);
            cb(settingsError);
          });
        }
        db.run(
          "DELETE FROM pokemon_pc_boxes WHERE user_id = ? AND name = '' AND archived = 0",
          [userId],
          (cleanError) => {
            if (cleanError) handleException("Nettoyage des boîtes sans réglage :", cleanError);
            cb(null, { ok: true });
          }
        );
      });
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
  // Un nom vide rend à la boîte son nom par défaut ; archivée, elle garde sa
  // ligne, et son archivage.
  if (!clean) {
    const done = (err) =>
      err ? cb(err) : cb(null, { ok: true, name: defaultBoxName(box), custom: false });
    return db.run(
      "UPDATE pokemon_pc_boxes SET name = '' WHERE user_id = ? AND box = ? AND archived = 1",
      [userId, box],
      (err) => {
        if (err) return done(err);
        db.run(
          "DELETE FROM pokemon_pc_boxes WHERE user_id = ? AND box = ? AND archived = 0",
          [userId, box],
          done
        );
      }
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
      // `cut` : la limite a rogné la saisie, et l'appelant peut le dire.
      cb(null, {
        ok: true,
        nickname: clean,
        cut: [...(cleanName(nickname, Infinity) ?? "")].length > pcConfig().nicknameLength,
      });
    }
  );
}
