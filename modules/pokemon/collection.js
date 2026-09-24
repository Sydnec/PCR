// Collection des dresseurs : lecture, évolution et échanges.
//
// Un Pokémon est une ligne de pokemon_owned : un individu, avec son sexe, sa
// ball, sa fertilité et sa date d'arrivée. Les lectures agrégées (combien de
// Pikachu ?) se calculent à partir des individus, jamais d'un compteur tenu à
// côté qui finirait par ne plus dire la même chose.
import db from "../points-db.js";
import { addPoints, spendPoints } from "../economy.js";
import { handleException } from "../utils.js";
import { getPokemonConfig } from "./config.js";
import {
  dittoSpecies,
  evolutionTargets,
  getSpecies,
  lockedByDefault,
  rollSex,
  sexAfterEvolution,
  tradeEvolutionTarget,
} from "./data.js";
import { consumeItem, getItem, grantItem } from "./items.js";
import { recordFusion, recordTrade } from "./stats.js";
import { checkCharms } from "./charms.js";

// Un groupe d'individus : une espèce, une variante, et au besoin un sexe et une
// fertilité. Les commandes encodent le tout dans la valeur d'une option ; une
// partie absente veut dire « peu importe ». La variante distingue des
// individus, pas des entrées : une entrée de Pokédex est une espèce, shiny ou
// non.
//
// Ou un individu précis, par son identifiant : « #123 », tel que /pk boite
// l'affiche. Un groupe contient toujours « : », un identifiant jamais, donc les
// deux ne se confondent pas — et un nombre tapé sans dièse vaut identifiant.
export const encodeIndividual = (id) => `#${id}`;

export const parseIndividual = (value) => {
  const match = /^#?\s*(\d+)$/.exec(String(value ?? "").trim());
  return match ? Number(match[1]) : null;
};

export function encodeEntry(speciesId, isShiny, sex = null, fertile = null) {
  const parts = [speciesId, isShiny ? 1 : 0];
  if (sex || fertile !== null) parts.push(sex ?? "");
  if (fertile !== null) parts.push(fertile ? 1 : 0);
  return parts.join(":");
}

export const decodeEntry = (value) => {
  const pokemonId = parseIndividual(value);
  if (pokemonId) return { pokemonId };
  const [speciesId, shiny, sex, fertile] = String(value).split(":");
  return {
    speciesId: Number(speciesId),
    isShiny: shiny === "1",
    sex: sex === "M" || sex === "F" ? sex : null,
    fertile: fertile === "1" ? true : fertile === "0" ? false : null,
  };
};

// ====================== LECTURES ======================

// Une ligne par espèce et variante, dans la forme qu'avait l'ancienne table :
// { species_id, is_shiny, count, first_caught_at }. Le Pokédex s'en sert pour
// dire, espèce par espèce, combien de normaux et de shiny on possède.
export function getCollection(userId, cb) {
  db.all(
    `SELECT species_id, is_shiny, COUNT(*) AS count, MIN(obtained_at) AS first_caught_at
       FROM pokemon_owned
      WHERE user_id = ?
      GROUP BY species_id, is_shiny
      ORDER BY species_id, is_shiny`,
    [userId],
    cb
  );
}

// Combien le dresseur possède d'individus de la même espèce qu'un individu `o`
// de pokemon_owned, shiny compris : une entrée de Pokédex est une espèce. La
// règle du Pokédex — il en reste toujours au moins un — se lit sur ce seul
// fragment.
const ENTRY_COUNT = `(SELECT COUNT(*) FROM pokemon_owned k
    WHERE k.user_id = o.user_id AND k.species_id = o.species_id)`;

// Tous les individus d'un dresseur, `last` marquant celui qui est le dernier de
// son espèce : lui seul ne peut pas partir. Triés par espèce puis par ancienneté.
export function getIndividuals(userId, cb) {
  db.all(
    `SELECT o.*, (${ENTRY_COUNT} = 1) AS last
       FROM pokemon_owned o
      WHERE o.user_id = ?
      ORDER BY o.species_id, o.is_shiny, o.obtained_at, o.id`,
    [userId],
    (err, rows) => cb(err, rows || [])
  );
}

// Un individu, `last` compris, ou null.
export function getIndividual(pokemonId, cb) {
  db.get(
    `SELECT o.*, (${ENTRY_COUNT} = 1) AS last FROM pokemon_owned o WHERE o.id = ?`,
    [pokemonId],
    (err, row) => cb(err, row ?? null)
  );
}

// Transforme la valeur d'une option — groupe ou « #123 » — en sélecteur
// complet { speciesId, isShiny, sex, fertile, pokemonId }. Un identifiant se
// résout en base, et doit appartenir à `ownerId` : on ne désigne que ses
// propres Pokémon, ou ceux du dresseur à qui l'on demande un échange.
export function resolveSelector(ownerId, value, cb) {
  const entry = decodeEntry(value);
  if (!entry.pokemonId) return cb(null, { ...entry, pokemonId: null });
  getIndividual(entry.pokemonId, (err, row) => {
    if (err) return cb(err);
    if (!row || row.user_id !== ownerId) {
      return cb(null, { error: `Le Pokémon #${entry.pokemonId} n'est pas dans cette boîte.` });
    }
    cb(null, {
      speciesId: row.species_id,
      isShiny: Boolean(row.is_shiny),
      sex: row.sex,
      fertile: null,
      pokemonId: row.id,
      row,
    });
  });
}

// L'espèce que désigne la première option d'une commande, revalidée : tapée à
// la main ou périmée, elle peut ne rien désigner.
export function resolveSpecies(value) {
  const species = getSpecies(Number(value));
  return species ? { species } : { error: "Choisis l'espèce dans la liste d'autocomplétion." };
}

// L'individu que désigne la seconde option d'une commande, une fois l'espèce
// choisie dans la première : il doit appartenir à `ownerId` et être de cette
// espèce. Les deux valeurs se revalident, puisqu'elles peuvent être tapées à
// la main ou périmées.
export function resolveIndividual(ownerId, speciesValue, value, cb) {
  const { species, error } = resolveSpecies(speciesValue);
  if (error) return cb(null, { error });
  if (!parseIndividual(value)) {
    return cb(null, { error: `Choisis le ${species.name} dans la liste d'autocomplétion.` });
  }
  resolveSelector(ownerId, encodeIndividual(parseIndividual(value)), (err, selector) => {
    if (err || selector.error) return cb(err, selector);
    if (selector.speciesId !== species.id) {
      return cb(null, {
        error: `Le Pokémon #${selector.pokemonId} n'est pas un ${species.name}.`,
      });
    }
    cb(null, selector);
  });
}

// Les individus comptés par espèce : `total`, dont `normal` et `shiny`, et
// `free` / `freeNormal` ceux qui ne sont pas verrouillés — les seuls qui
// peuvent partir. Une entrée de Pokédex est une espèce, et ce qu'elle peut
// céder se lit ici, dans `spare` : tout sauf un, et jamais un verrouillé.
export function countBySpecies(rows) {
  const counts = new Map();
  for (const row of rows) {
    const entry = counts.get(row.species_id) ?? {
      total: 0,
      normal: 0,
      shiny: 0,
      free: 0,
      freeNormal: 0,
    };
    entry.total++;
    entry[row.is_shiny ? "shiny" : "normal"]++;
    if (!row.locked) {
      entry.free++;
      if (!row.is_shiny) entry.freeNormal++;
    }
    counts.set(row.species_id, entry);
  }
  for (const entry of counts.values()) entry.spare = Math.min(entry.free, entry.total - 1);
  return counts;
}

// Les doublons d'un dresseur, espèce par espèce dans l'ordre du Pokédex : tout
// ce qui dépasse un exemplaire, avec le `spare` de countBySpecies — la marge
// que l'échange et les sacrifices revérifient au moment de retirer.
export function listDuplicates(rows) {
  return [...countBySpecies(rows)]
    .filter(([, entry]) => entry.total > 1)
    .map(([speciesId, entry]) => ({ speciesId, ...entry }))
    .sort((a, b) => a.speciesId - b.speciesId);
}

// L'inverse : les dresseurs qui ont `speciesId` en double, ceux qui peuvent en
// céder le plus d'abord. Chaque ligne est celle de listDuplicates pour ce
// dresseur, avec son `userId` : la même marge, calculée au même endroit.
export function getSpeciesDuplicates(speciesId, cb) {
  db.all(
    "SELECT * FROM pokemon_owned WHERE species_id = ?",
    [Number(speciesId)],
    (err, rows) => {
      if (err) return cb(err, []);
      const byUser = new Map();
      for (const row of rows || []) {
        if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
        byUser.get(row.user_id).push(row);
      }
      const list = [];
      for (const [userId, own] of byUser) {
        const [entry] = listDuplicates(own);
        if (entry) list.push({ userId, ...entry });
      }
      // L'identifiant départage les égalités : la liste est relue à chaque
      // page, et un ordre qui bougerait entre deux clics montrerait un
      // dresseur deux fois et en cacherait un autre.
      list.sort(
        (a, b) =>
          b.spare - a.spare || b.total - a.total || String(a.userId).localeCompare(String(b.userId))
      );
      cb(null, list);
    }
  );
}

// Regroupe des individus par espèce et variante, et au besoin par sexe et
// fertilité. `spare` compte ceux qu'on peut céder : ceux du groupe qui ne sont
// pas verrouillés, dans la limite de ce que l'espèce peut perdre en gardant un
// exemplaire. Les
// groupes d'une même espèce — shiny compris — partagent cette marge : c'est un
// plafond, que la réservation revérifie de toute façon.
export function groupIndividuals(rows, { bySex = false, byFertility = false } = {}) {
  const groups = new Map();
  for (const row of rows) {
    const sex = bySex ? row.sex : null;
    const fertile = byFertility ? !row.sterile : null;
    const key = encodeEntry(row.species_id, row.is_shiny, sex, fertile);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        speciesId: row.species_id,
        isShiny: Boolean(row.is_shiny),
        sex,
        fertile,
        count: 0,
        spare: 0,
        free: 0,
        fertileCount: 0,
      });
    }
    const group = groups.get(key);
    group.count++;
    if (!row.locked) group.free++;
    if (!row.sterile) group.fertileCount++;
  }
  const bySpecies = countBySpecies(rows);
  for (const group of groups.values()) {
    group.spare = Math.min(group.free, bySpecies.get(group.speciesId).total - 1);
  }
  return [...groups.values()];
}

// Combien un dresseur possède d'individus d'un groupe, combien sont
// verrouillés, et combien il peut en céder. Sert aux refus, pour les dire avec
// les bons chiffres.
export function countGroup(userId, group, cb) {
  getIndividuals(userId, (err, rows) => {
    if (err) return cb(err, { owned: 0, locked: 0, spare: 0 });
    const matching = rows.filter((row) => matchesGroup(row, group));
    const free = matching.filter((row) => !row.locked).length;
    const total = countBySpecies(rows).get(Number(group.speciesId))?.total ?? 0;
    cb(null, {
      owned: matching.length,
      locked: matching.length - free,
      spare: Math.min(free, Math.max(0, total - 1)),
    });
  });
}

// Une variante absente (null) veut dire « shiny ou non ».
const anyVariant = (isShiny) => isShiny === null || isShiny === undefined;

const matchesGroup = (row, { speciesId, isShiny, sex = null, fertile = null, pokemonId = null }) =>
  (!pokemonId || row.id === Number(pokemonId)) &&
  row.species_id === Number(speciesId) &&
  (anyVariant(isShiny) || Boolean(row.is_shiny) === Boolean(isShiny)) &&
  (!sex || row.sex === sex) &&
  (fertile === null || fertile === undefined || Boolean(row.sterile) === !fertile);

// Les individus d'une espèce, shiny compris : `total`, et `free` ceux qui ne
// sont pas verrouillés. De quoi dimensionner des sacrifices.
export function countSpecies(userId, speciesId, cb) {
  db.get(
    `SELECT COUNT(*) AS total, COALESCE(SUM(locked = 0), 0) AS free FROM pokemon_owned
      WHERE user_id = ? AND species_id = ?`,
    [userId, speciesId],
    (err, row) => cb(err, { total: row?.total ?? 0, free: row?.free ?? 0 })
  );
}

// Les deux variantes d'une espèce en une requête : un shiny est une entrée de
// Pokédex distincte, donc « est-ce que je l'ai ? » a deux réponses possibles.
export function getOwnedVariants(userId, speciesId, cb) {
  getOwnedVariantsFor(userId, [speciesId], (err, counts) =>
    cb(err, counts.get(Number(speciesId)) ?? { normal: 0, shiny: 0 })
  );
}

// Les mêmes variantes, pour plusieurs espèces d'un coup. La fiche d'un Pokémon
// affiche toute sa lignée évolutive : une requête par maillon, ce serait quatre
// allers-retours pour une seule réponse. Renvoie une entrée par identifiant
// demandé, même à zéro, pour que l'appelant n'ait aucun cas absent à traiter.
export function getOwnedVariantsFor(userId, speciesIds, cb) {
  const ids = [...new Set(speciesIds.map(Number))].filter(Number.isInteger);
  const counts = new Map(ids.map((id) => [id, { normal: 0, shiny: 0 }]));
  if (!ids.length) return cb(null, counts);

  db.all(
    `SELECT species_id, is_shiny, COUNT(*) AS count FROM pokemon_owned
      WHERE user_id = ? AND species_id IN (${ids.map(() => "?").join(", ")})
      GROUP BY species_id, is_shiny`,
    [userId, ...ids],
    (err, rows) => {
      if (err) return cb(err, counts);
      for (const row of rows || []) {
        const entry = counts.get(row.species_id);
        if (!entry) continue;
        if (row.is_shiny) entry.shiny = row.count;
        else entry.normal = row.count;
      }
      cb(null, counts);
    }
  );
}

export function getLeaderboard(limit, cb) {
  db.all(
    `SELECT user_id,
            COUNT(DISTINCT species_id) AS dex,
            COUNT(DISTINCT CASE WHEN is_shiny = 1 THEN species_id END) AS shinies,
            COUNT(*) AS total
       FROM pokemon_owned
      GROUP BY user_id
      ORDER BY dex DESC, shinies DESC, total DESC
      LIMIT ?`,
    [limit],
    cb
  );
}

// ====================== ÉCRITURES ======================

// Chemin unique de crédit de la collection : capture sauvage, parc safari et
// éclosion passent tous par ici. Le sexe se tire selon l'espèce sauf s'il est
// imposé ; la ball est celle de la capture, NULL quand il n'y en a pas eu.
// Rend l'individu créé { id, sex }.
export function creditSpecies(userId, speciesId, isShiny, options, cb) {
  const { ball = null, origin, sex = null, obtainedAt = Date.now() } = options;
  const chosenSex = sex ?? rollSex(getSpecies(speciesId));
  db.run(
    `INSERT INTO pokemon_owned
       (user_id, species_id, is_shiny, sex, ball, origin, sterile, obtained_at, locked)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      userId,
      speciesId,
      isShiny ? 1 : 0,
      chosenSex,
      ball,
      origin,
      obtainedAt,
      lockedByDefault(speciesId, isShiny) ? 1 : 0,
    ],
    function (err) {
      if (err) return cb(err, null);
      // Une espèce de plus peut compléter un Pokédex : le Charme Chroma suit,
      // sans retarder celui qui vient d'obtenir son Pokémon.
      checkCharms(userId);
      cb(null, { id: this.lastID, sex: chosenSex });
    }
  );
}

// Verrouille ou déverrouille un Pokémon, de son propriétaire seulement : la
// garde est dans le WHERE, et `this.changes` dit s'il était bien à lui. Le
// verrou ne change rien d'autre : le Pokémon reste où il est, tel qu'il est.
export function setLock(userId, pokemonId, locked, cb) {
  db.run(
    "UPDATE pokemon_owned SET locked = ? WHERE id = ? AND user_id = ?",
    [locked ? 1 : 0, Number(pokemonId), userId],
    function (err) {
      cb(err, this ? this.changes === 1 : false);
    }
  );
}

// Bascule le verrou d'un Pokémon en une seule écriture gardée : deux bascules
// simultanées s'appliquent l'une après l'autre, et RETURNING dit l'état obtenu.
// Rend null si le Pokémon n'est pas (ou plus) à `userId`.
export function toggleLock(userId, pokemonId, cb) {
  db.get(
    "UPDATE pokemon_owned SET locked = 1 - locked WHERE id = ? AND user_id = ? RETURNING locked",
    [Number(pokemonId), userId],
    (err, row) => cb(err, row ? Boolean(row.locked) : null)
  );
}

// ====================== DOUBLONS ======================

// Retire des individus d'un groupe en garantissant qu'il reste TOUJOURS un
// individu de l'espèce, shiny ou non. C'est l'invariant du Pokédex : une
// évolution, une revente, un échange, rien ne doit pouvoir effacer une entrée
// durement gagnée. Contrairement aux jeux, avoir capturé un Pokémon ne suffit
// pas à le garder au Pokédex, il faut le posséder. Aucun individu n'est réservé
// pour autant : n'importe lequel peut partir, pourvu qu'il ne soit pas le
// dernier de son espèce — avec un Salamèche et un Salamèche shiny, l'un ou
// l'autre peut partir.
//
// Parmi les candidats, on prend d'abord ce qui vaut le moins — les normaux
// avant les shiny, puis les stériles, puis les plus récents : un individu
// encore capable de pondre ne part qu'en dernier. Une variante absente du
// groupe veut dire « shiny ou non ». Un verrouillé n'est jamais candidat, sauf
// avec `withLocked` : l'individu qui évolue ne quitte pas la boîte, il revient
// sous sa nouvelle forme — et même alors, un ouvert passe avant lui.
//
// Une seule instruction, qui compte et retire d'un même geste : deux retraits
// simultanés ne peuvent pas passer à deux sur le même individu, et c'est tout
// ou rien — soit `quantity` individus, soit aucun. RETURNING rend les lignes
// retirées, telles quelles : c'est ce qui permet de les rendre à l'identique si
// la suite de l'opération échoue.
export function reserveDuplicates(userId, group, quantity, cb) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return cb(new Error(`Quantité invalide : ${quantity}`), []);
  }
  const {
    speciesId,
    isShiny,
    sex = null,
    fertile = null,
    pokemonId = null,
    withLocked = false,
  } = group;
  const filter = `o.user_id = $user AND o.species_id = $species
    AND ($withLocked OR o.locked = 0)
    AND ($shiny IS NULL OR o.is_shiny = $shiny)
    AND ($id IS NULL OR o.id = $id)
    AND ($sex IS NULL OR o.sex = $sex)
    AND ($sterile IS NULL OR o.sterile = $sterile)`;
  db.all(
    `DELETE FROM pokemon_owned
      WHERE id IN (
        SELECT o.id FROM pokemon_owned o WHERE ${filter}
         ORDER BY o.locked ASC, o.is_shiny ASC, o.sterile DESC, o.obtained_at DESC, o.id DESC
         LIMIT $quantity)
        AND (SELECT COUNT(*) FROM pokemon_owned o WHERE ${filter}) >= $quantity
        AND (SELECT COUNT(*) FROM pokemon_owned WHERE user_id = $user AND species_id = $species)
            >= $quantity + 1
      RETURNING *`,
    {
      $user: userId,
      $species: Number(speciesId),
      $shiny: anyVariant(isShiny) ? null : isShiny ? 1 : 0,
      $id: pokemonId ? Number(pokemonId) : null,
      $sex: sex,
      $sterile: fertile === null || fertile === undefined ? null : fertile ? 0 : 1,
      $withLocked: withLocked ? 1 : 0,
      $quantity: quantity,
    },
    (err, rows) => cb(err, rows || [])
  );
}

// Rend des individus réservés, à l'identique — même identifiant, même sexe,
// même ball —, quand la suite de l'opération a échoué. Accepte aussi des lignes
// modifiées : c'est ainsi qu'un individu change d'espèce en évoluant, ou de
// dresseur en étant échangé, sans cesser d'être lui-même.
export function restoreDuplicates(rows, cb = () => {}) {
  const list = [...rows];
  const next = (err) => {
    if (err) return cb(err);
    const row = list.shift();
    if (!row) {
      // Un Pokémon qui évolue change d'espèce, un Pokémon échangé change de
      // boîte : l'un comme l'autre peut compléter un Pokédex.
      for (const userId of new Set(rows.map((entry) => entry.user_id))) checkCharms(userId);
      return cb(null);
    }
    // La place dans la boîte PC, le surnom et le verrou reviennent avec lui :
    // un Pokémon qui évolue, ou qu'une compensation remet en place, reste où
    // son dresseur l'avait rangé, sous le nom et la protection qu'il lui avait
    // donnés.
    db.run(
      `INSERT INTO pokemon_owned
         (id, user_id, species_id, is_shiny, sex, ball, origin, sterile, obtained_at, pc_pos,
          nickname, locked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.user_id,
        row.species_id,
        row.is_shiny,
        row.sex,
        row.ball,
        row.origin,
        row.sterile,
        row.obtained_at,
        row.pc_pos ?? null,
        row.nickname ?? null,
        row.locked ? 1 : 0,
      ],
      next
    );
  };
  next(null);
}

// ====================== ÉVOLUTION ======================

// L'aide qu'un objet apporte à une évolution, ou null. C'est le catalogue qui
// la décrit — combien d'exemplaires de l'objet, combien de sacrifices ils
// remplacent, et s'ils dispensent du coût en points — et cette fonction ne fait
// que la relire et la refuser quand elle ne s'applique pas.
//
// `from` enferme l'objet dans une lignée : une Pierre Feu ne sert que sur un
// Évoli, et rien n'empêcherait autrement de la jeter sur un Chenipan.
export function describeHelper(helperKey, speciesId) {
  if (!helperKey) return { helper: null };
  const item = getItem(helperKey);
  if (!item?.evolution) return { error: "Cet objet ne sert pas aux évolutions." };

  const { copies = 1, quantity = 1, freePoints = false, from = null, target = null } =
    item.evolution;
  if (from && Number(from) !== Number(speciesId)) {
    const source = getSpecies(from);
    return {
      error: `**${item.label}** ne s'utilise que sur ${source ? source.name : "une autre espèce"}.`,
    };
  }
  if (!Number.isInteger(quantity) || quantity <= 0 || !Number.isInteger(copies) || copies <= 0) {
    return { error: `**${item.label}** est mal configuré.` };
  }
  return { helper: { item, copies, quantity, freePoints, target: target ? Number(target) : null } };
}

// Métamorph, joker des évolutions. Ce n'est pas un objet mais un Pokémon, d'où
// une clé d'aide à part : il ne sert que si on le demande, puisqu'il sert aussi
// aux œufs. Comme les autres sacrifices, sa variante ne compte pas : les
// normaux partent avant les shiny, et il en reste toujours un.
export const DITTO_HELPER = "metamorph";

// Qui paie les sacrifices d'une évolution. `owned.total` compte les individus
// de l'espèce — shiny compris, celui qui évolue compris —, `owned.free` ceux
// qui peuvent être sacrifiés : ni verrouillés, ni celui qui évolue. Des
// exemplaires de l'espèce tant qu'il en reste un en plus de celui qui évolue,
// puis Métamorph pour ce qui manque, à `dittosPerCopy` par sacrifice. La même
// fonction sert à l'écran de /pk evolution et à evolve, qui tranche à la fin.
export function sacrificeFill(plan, owned) {
  const perCopy = Math.max(1, Math.round(Number(getPokemonConfig().evolution.dittosPerCopy) || 1));
  const real = Math.min(plan.sacrifices, owned.free, Math.max(0, owned.total - 2));
  const missing = plan.sacrifices - real;
  return { real, missing, dittos: missing * perCopy };
}

// Combien on en a, et combien sont verrouillés : un verrouillé garde l'entrée
// mais ne se sacrifie pas, le refus doit le dire quand c'est lui qui manque.
// `owned` : { total, free }, ou null quand la lecture a échoué — on omet alors
// plutôt que d'annoncer un faux zéro.
const ownedText = (owned) => {
  if (!owned) return "";
  const locked = owned.total - owned.free;
  const fr = (value) => value.toLocaleString("fr-FR");
  return (
    ` Tu en as **${fr(owned.total)}**` +
    (locked > 0 ? `, dont **${fr(locked)}** verrouillé${locked > 1 ? "s" : ""} 🛡️` : "") +
    "."
  );
};

// Ce qui manque à une évolution, avec les chiffres : le refus d'evolve et celui
// de /pk evolution disent la même chose.
export function evolutionShortage(plan, owned = null) {
  const sacrifices = plan.sacrifices;
  return (
    `Il te faut **${plan.required}** ${plan.species.name}, shiny ou non : celui qui évolue, ` +
    (sacrifices > 0
      ? `${sacrifices} sacrifice${sacrifices > 1 ? "s" : ""} non ` +
        `verrouillé${sacrifices > 1 ? "s" : ""} `
      : "") +
    `et un qui reste.` +
    ownedText(owned)
  );
}

// Décrit ce que coûte une évolution, sans rien modifier.
// `chosenTargetId` non nul sur une lignée à embranchement (Évoli) déclenche le
// tarif « choix », plus cher que le tirage au sort.
//
// `helperKey` désigne un objet qui prend une partie de la facture à sa charge :
// il remplace des sacrifices, parfois les points, et peut imposer la cible.
export function describeEvolution(speciesId, chosenTargetId = null, helperKey = null) {
  const config = getPokemonConfig().evolution;
  const species = getSpecies(speciesId);
  if (!species) return { error: "Espèce inconnue." };
  if (species.tradeEvolution) {
    // Sécurité : une évolution par échange est une CIBLE d'évolution, jamais une
    // source. Le cas ne devrait pas se produire, mais autant être explicite.
    return { error: `${species.name} ne peut pas évoluer davantage.` };
  }

  const targets = evolutionTargets(species);
  if (!targets.length) return { error: `${species.name} n'a pas d'évolution.` };

  const { helper, error } = describeHelper(helperKey, speciesId);
  if (error) return { error };

  const branching = targets.length > 1;
  // Une pierre désigne sa cible : c'est tout ce qui la distingue d'un bonbon, et
  // ce qui en fait le seul moyen de choisir son Évoli sans payer le supplément.
  const wanted = helper?.target ?? chosenTargetId;
  const target = wanted
    ? targets.find((t) => t.id === Number(wanted))
    : branching
    ? null
    : targets[0];

  if (wanted && !target) {
    return { error: `${species.name} ne peut pas évoluer en cette forme.` };
  }

  // Sur une lignée à embranchement, le coût en points dépend de la cible :
  // un tirage aléatoire coûte le tarif normal du stade, choisir coûte plus cher.
  // Un bébé et sa forme adulte sont tous deux de stade 1 : son évolution coûte
  // ce que coûte une première évolution d'adulte, celle du stade 2.
  const referenceStage = Math.max(2, (target ?? targets[0]).stage);
  const stageCost = config[referenceStage];
  if (!stageCost) return { error: "Aucun coût configuré pour ce stade." };

  // Le supplément « choix » ne se paie que sur un choix DU JOUEUR : une pierre
  // impose sa cible, ce n'est pas le dresseur qui trie.
  const basePoints =
    branching && chosenTargetId && !helper?.target
      ? config.branchChoicePoints
      : stageCost.points;

  // Le tarif du stade compte l'individu qui évolue parmi ses `duplicates` : il
  // ne se sacrifie pas, il change d'espèce en restant lui-même. L'aide retire
  // des sacrifices, jamais en dessous de zéro : un objet trop généreux ne doit
  // pas rendre une évolution négative.
  const sacrifices = Math.max(0, stageCost.duplicates - 1 - (helper?.copies ?? 0));

  return {
    species,
    targets,
    target,
    branching,
    helper,
    sacrifices,
    points: helper?.freePoints ? 0 : basePoints,
    // Celui qui évolue, ses sacrifices, et un de plus : l'entrée du Pokédex
    // n'est jamais perdue à cause d'une évolution.
    required: sacrifices + 2,
  };
}

// Fait évoluer un individu. Il change d'espèce en restant lui-même : même
// identifiant, même ball, même fertilité, shiny s'il l'était, et son sexe si la
// nouvelle espèce l'admet. Les autres Pokémon de l'évolution sont des
// sacrifices : des exemplaires de l'espèce, shiny ou non, ou des Métamorph.
//
// Enchaînement ordonné avec compensation : chaque étape rend ce que les
// précédentes ont réservé si elle échoue. L'ordre n'est pas indifférent — on
// prend d'abord ce qui est le plus probable de manquer, pour que le cas courant
// (« il te manque un exemplaire ») ne déplace rien du tout.
//
// Un individu verrouillé évolue quand même — il ne quitte pas la boîte —, mais
// seulement avec `group.confirmLocked` : sans elle, evolve le rend et répond
// `locked`, pour que l'appelant demande confirmation.
//
// `group.pokemonId` désigne l'individu qui évolue ; sans `speciesId`, son espèce
// se lit sur lui. Avec, c'est l'espèce attendue : la réservation ne le prend
// que s'il l'a encore, ce qui refuse un second clic sur un Pokémon qui vient
// d'évoluer. Sans identifiant ni variante ni sexe — /pk evolution sans
// individu —, le bot choisit celui qui évolue (voir plus bas). Un groupe avec
// variante — les boutons d'avant le choix de l'individu — en fait évoluer un
// du sexe et de la variante demandés.
export function evolve(userId, group, chosenTargetId, helperKey, cb) {
  if (group.pokemonId && !group.speciesId) {
    return resolveSelector(userId, encodeIndividual(group.pokemonId), (err, selector) => {
      if (err) return cb(err);
      if (selector.error) return cb(null, { ok: false, reason: selector.error });
      const resolved = { ...selector, confirmLocked: group.confirmLocked };
      evolve(userId, resolved, chosenTargetId, helperKey, cb);
    });
  }
  const { speciesId, isShiny, sex = null, pokemonId = null } = group;
  // Métamorph n'est pas un objet : il passe par sa propre réservation, plus bas.
  const ditto = helperKey === DITTO_HELPER;
  const plan = describeEvolution(speciesId, chosenTargetId, ditto ? null : helperKey);
  if (plan.error) return cb(null, { ok: false, reason: plan.error });

  const target =
    plan.target ?? plan.targets[Math.floor(Math.random() * plan.targets.length)];
  const helper = plan.helper;
  const name = plan.species.name;

  // Étape 3 : les points. Zéro se saute au lieu de se débiter — spendPoints
  // refuserait un dresseur sans ligne de solde, et une évolution gratuite n'a
  // pas à dépendre de ça.
  //
  // `reserved[0]` est l'individu qui évolue ; `spent` dit ce qui a été
  // sacrifié, pour le journal et le message.
  const payer = (reserved, spent, rendreExemplaires) => {
    // `rendreTout` est la compensation COMPLÈTE au point où on l'appelle : les
    // exemplaires, l'aide, et les points s'ils sont déjà partis. Sans elle, un
    // retour raté au tout dernier moment laissait le dresseur délesté de tout
    // et sans rien — exactement ce que cette cascade existe pour empêcher, et
    // la seule étape qui y échappait.
    const finir = (rendreTout) => {
      const [evolver] = reserved;
      const evolved = {
        ...evolver,
        species_id: target.id,
        sex: sexAfterEvolution(target, evolver.sex),
      };
      restoreDuplicates([evolved], (err) => {
        if (err) return rendreTout(() => cb(err));
        db.run(
          `INSERT INTO pokemon_fusions
             (user_id, from_species_id, to_species_id, is_shiny, duplicates_spent, points_spent, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [userId, speciesId, target.id, evolver.is_shiny, spent.sacrifices, plan.points, Date.now()],
          (err) => {
            if (err) handleException("Journal d'évolution :", err);
            recordFusion({ userId, duplicates: spent.sacrifices, points: plan.points });
            cb(null, {
              ok: true,
              target,
              plan,
              spent,
              evolved: { id: evolved.id, sex: evolved.sex },
              isShiny: Boolean(evolver.is_shiny),
            });
          }
        );
      });
    };

    if (plan.points <= 0) return finir(rendreExemplaires);
    spendPoints(userId, plan.points, (err, debited) => {
      if (err || !debited) {
        rendreExemplaires(() => {
          if (err) return cb(err);
          cb(null, {
            ok: false,
            reason: `Solde insuffisant : cette évolution coûte **${plan.points}** points.`,
          });
        });
        return;
      }
      // Les points sont partis : à partir d'ici, tout retour en arrière les rend.
      finir((suite) =>
        addPoints(userId, plan.points, (err) => {
          if (err) handleException("Remboursement d'une évolution échouée :", err);
          rendreExemplaires(suite);
        })
      );
    });
  };

  // Étape 2 : l'aide, s'il y en a une. Elle est consommée après les exemplaires
  // parce qu'elle est plus rare : mieux vaut rendre un sacrifice qu'une pierre.
  const prendreAide = (reserved, spent, rendreExemplaires) => {
    if (!helper) return payer(reserved, spent, rendreExemplaires);
    consumeItem(userId, helper.item.key, helper.quantity, { source: "fusion" }, (err, pris) => {
      if (err) return rendreExemplaires(() => cb(err));
      if (!pris) {
        return rendreExemplaires(() =>
          cb(null, {
            ok: false,
            reason:
              `Il te faut **${helper.quantity}** ${helper.item.emoji} ${helper.item.label} ` +
              `pour cette évolution.`,
          })
        );
      }
      payer(reserved, spent, (suite) =>
        // Compensation en cascade : l'aide revient, puis les exemplaires.
        grantItem(userId, helper.item.key, helper.quantity, { source: "fusion-annulee" }, (err) => {
          if (err) handleException("Restitution d'une aide d'évolution :", err);
          rendreExemplaires(suite);
        })
      );
    });
  };

  // Étape 1 : l'individu qui évolue, puis ses sacrifices.
  //
  // Le comptage de l'espèce ne fait que dimensionner les retraits et chiffrer
  // les refus : chaque retrait reste gardé, et si le stock a bougé entre-temps,
  // il échoue et tout ce qui a été pris revient.
  const compter = (suite) => countSpecies(userId, speciesId, suite);
  const manque = () =>
    compter((err, owned) =>
      cb(null, { ok: false, reason: evolutionShortage(plan, err ? null : owned) })
    );
  const aChange = () =>
    cb(null, {
      ok: false,
      reason: `Tes ${name} ont changé entre-temps : relance l'évolution.`,
    });
  // Le refus donne les chiffres ; une lecture ratée les omet plutôt que
  // d'annoncer un faux zéro.
  const manqueMetamorph = (metamorph, fill) =>
    countSpecies(userId, metamorph.id, (err, owned) =>
      cb(null, {
        ok: false,
        reason:
          `Il te faut **${fill.dittos + 1}** ${metamorph.name} pour compléter cette évolution : ` +
          `${fill.dittos} à sacrifier, non verrouillé${fill.dittos > 1 ? "s" : ""}, et un qui ` +
          `reste.` +
          ownedText(err ? null : owned),
      })
    );

  const rendre = (rows) => (suite) =>
    restoreDuplicates(rows, (err) => {
      if (err) handleException("Compensation d'évolution impossible :", err);
      suite();
    });

  // Retire `quantity` individus d'un groupe à la suite de ceux déjà pris. Un
  // retrait refusé rend tout ce qui précède avant de dire pourquoi.
  const prendre = (pris, groupe, quantity, refus, suite) => {
    if (quantity <= 0) return suite(pris);
    reserveDuplicates(userId, groupe, quantity, (err, rows) => {
      if (err || !rows.length) return rendre(pris)(() => (err ? cb(err) : refus()));
      suite([...pris, ...rows]);
    });
  };

  // Combien d'exemplaires de l'espèce sacrifier, et combien de Métamorph pour
  // le reste. `owned` compte l'espèce, celui qui évolue compris. Rend null
  // après avoir répondu quand l'évolution ne peut pas se payer.
  const dimensionner = (owned, rendreAvant) => {
    const fill = sacrificeFill(plan, owned);
    if (fill.missing > 0 && !ditto) {
      rendreAvant(manque);
      return null;
    }
    const metamorph = fill.dittos > 0 ? dittoSpecies() : null;
    if (fill.dittos > 0 && !metamorph) {
      rendreAvant(() =>
        cb(null, { ok: false, reason: "Métamorph n'est pas disponible dans cette génération." })
      );
      return null;
    }
    return { fill, metamorph };
  };

  // Métamorph pour ce qui manque — assez d'exemplaires, il reste dans la boîte,
  // même demandé —, puis l'aide. `pris` commence par l'individu qui évolue,
  // suivi des sacrifices de l'espèce.
  const completer = (pris, { fill, metamorph }) =>
    prendre(
      pris,
      { speciesId: metamorph?.id },
      fill.dittos,
      () => manqueMetamorph(metamorph, fill),
      (reserved) =>
        prendreAide(
          reserved,
          {
            sacrifices: fill.real,
            dittos: fill.dittos,
            // Les normaux partent d'abord ; un shiny sacrifié ne se
            // rattrape pas, le message le dit.
            shinies: reserved.slice(1).filter((row) => row.is_shiny).length,
          },
          rendre(reserved)
        )
    );

  // Sans individu désigné, le bot choisit : les sacrifices d'abord, les moins
  // précieux de l'espèce (les normaux, puis les stériles, puis les plus
  // récents), puis celui qui évolue, le suivant dans le même ordre. Dans
  // l'autre sens, le moins précieux évoluait et un shiny pouvait partir en
  // sacrifice à sa place. Jamais un verrouillé : il n'évolue que désigné.
  if (!pokemonId && anyVariant(isShiny) && !sex) {
    return compter((err, owned) => {
      if (err) return cb(err);
      if (!owned.free) {
        return cb(null, {
          ok: false,
          reason:
            `${evolutionShortage(plan, owned)} Le bot ne fait jamais évoluer un verrouillé de ` +
            `lui-même : choisis-le dans l'option « individu ».`,
        });
      }
      // Un libre est gardé pour évoluer : les sacrifices se prennent parmi les
      // autres.
      const dims = dimensionner({ total: owned.total, free: owned.free - 1 }, (suite) => suite());
      if (!dims) return;
      prendre([], { speciesId }, dims.fill.real, aChange, (sacrifices) =>
        reserveDuplicates(userId, { speciesId }, 1, (err, evolvers) => {
          if (err || !evolvers.length) {
            return rendre(sacrifices)(() => (err ? cb(err) : aChange()));
          }
          completer([...evolvers, ...sacrifices], dims);
        })
      );
    });
  }

  // Un verrouillé n'est pris qu'avec la confirmation : sans elle, il ne quitte
  // jamais la boîte, et une relecture dit pourquoi rien n'a bougé.
  const evolverGroup = {
    speciesId,
    isShiny,
    sex,
    pokemonId,
    withLocked: Boolean(group.confirmLocked),
  };
  reserveDuplicates(userId, evolverGroup, 1, (err, evolvers) => {
    if (err) return cb(err);
    if (!evolvers.length && pokemonId) {
      return getIndividual(pokemonId, (err, row) => {
        if (err) return cb(err);
        // Verrouillé : on ne le bloque pas, on demande.
        if (row?.user_id === userId && row.species_id === Number(speciesId) && row.locked) {
          return cb(null, {
            ok: false,
            locked: true,
            reason:
              `#${row.id} ${name}${row.is_shiny ? " ✨" : ""} est verrouillé 🛡️. Il ne ` +
              `quittera pas ta boîte, mais veux-tu vraiment le faire évoluer ?`,
          });
        }
        cb(null, {
          ok: false,
          reason:
            `Le Pokémon #${pokemonId} ne peut pas évoluer : ce n'est plus un de tes ${name}, ` +
            `ou c'est le dernier.`,
        });
      });
    }
    if (!evolvers.length) return manque();
    const sansSacrifice = { sacrifices: 0, dittos: 0, shinies: 0 };
    if (plan.sacrifices <= 0) return prendreAide(evolvers, sansSacrifice, rendre(evolvers));

    compter((err, owned) => {
      if (err) return rendre(evolvers)(() => cb(err));
      // Le compte ne voit plus l'individu qui évolue, déjà réservé : `free`
      // est exactement ce qui peut être sacrifié.
      const dims = dimensionner({ total: owned.total + 1, free: owned.free }, rendre(evolvers));
      if (!dims) return;
      // Les sacrifices de l'espèce, shiny ou non (les normaux d'abord).
      prendre(evolvers, { speciesId }, dims.fill.real, aChange, (pris) => completer(pris, dims));
    });
  });
}

// ====================== ÉCHANGES ======================

// Ce qu'un Pokémon devient en changeant de dresseur. Quatre espèces de la
// première génération évoluent à l'échange, et c'est le dresseur qui REÇOIT qui
// reçoit la forme évoluée — celui qui donne son Machopeur ne voit jamais le
// Mackogneur. L'échange devient donc la seconde porte vers ces quatre-là, à
// côté de l'évolution : la moins chère, mais celle qui coûte un partenaire.
//
// Le calcul vit ici et pas dans acceptTrade parce qu'il sert deux fois, une
// par Pokémon traversé, et qu'une règle de jeu écrite deux fois finit toujours
// par ne plus l'être qu'une.
const tradedForm = (speciesId) =>
  tradeEvolutionTarget(getSpecies(speciesId))?.id ?? Number(speciesId);

// Chaque côté désigne un individu précis, choisi sur /pk echange : qui reçoit
// sait exactement quel Pokémon il aura. Les offres d'avant ce choix désignent
// un groupe — espèce, variante, sexe, fertilité — dont l'individu se choisit à
// l'acceptation, selon la même règle que partout (jamais le dernier de
// l'espèce, les moins précieux d'abord).
const fertileFlag = (fertile) =>
  fertile === null || fertile === undefined ? null : fertile ? 1 : 0;

export function createTrade(trade, cb) {
  const now = Date.now();
  const expiresAt = now + getPokemonConfig().trade.expiryHours * 3600 * 1000;
  db.run(
    `INSERT INTO pokemon_trades
       (from_user_id, to_user_id, offer_species_id, offer_is_shiny, offer_sex, offer_fertile,
        request_species_id, request_is_shiny, request_sex, request_fertile,
        offer_pokemon_id, request_pokemon_id, created_at, expires_at, channel_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      trade.fromUserId,
      trade.toUserId,
      trade.offerSpeciesId,
      trade.offerIsShiny ? 1 : 0,
      trade.offerSex ?? null,
      fertileFlag(trade.offerFertile),
      trade.requestSpeciesId,
      trade.requestIsShiny ? 1 : 0,
      trade.requestSex ?? null,
      fertileFlag(trade.requestFertile),
      trade.offerPokemonId ?? null,
      trade.requestPokemonId ?? null,
      now,
      expiresAt,
      trade.channelId,
    ],
    function (err) {
      cb(err, this ? this.lastID : null);
    }
  );
}

export function getTrade(tradeId, cb) {
  db.get("SELECT * FROM pokemon_trades WHERE id = ?", [tradeId], cb);
}

export function setTradeMessage(tradeId, messageId) {
  db.run("UPDATE pokemon_trades SET message_id = ? WHERE id = ?", [messageId, tradeId], (err) => {
    if (err) handleException("Enregistrement du message d'échange :", err);
  });
}

function releaseTrade(tradeId, status, cb = () => {}) {
  db.run(
    "UPDATE pokemon_trades SET status = ?, resolved_at = ? WHERE id = ?",
    [status, Date.now(), tradeId],
    cb
  );
}

export function resolveTradeAs(tradeId, userId, status, cb) {
  db.run(
    "UPDATE pokemon_trades SET status = ?, resolved_at = ? WHERE id = ? AND status = 'PENDING'",
    [status, Date.now(), tradeId],
    function (err) {
      cb(err, this ? this.changes === 1 : false);
    }
  );
}

// Acceptation d'un échange. La revendication gardée sert à la fois de verrou
// anti-double-acceptation et de contrôle d'expiration : aucun cron n'est
// nécessaire pour que l'expiration soit correcte.
export function acceptTrade(tradeId, cb) {
  db.run(
    `UPDATE pokemon_trades SET status = 'ACCEPTED', resolved_at = ?
      WHERE id = ? AND status = 'PENDING' AND expires_at > ?`,
    [Date.now(), tradeId, Date.now()],
    function (err) {
      if (err) return cb(err);
      if (this.changes === 0) {
        return cb(null, { ok: false, reason: "Cette offre a expiré ou a déjà été traitée." });
      }

      getTrade(tradeId, (err, trade) => {
        if (err || !trade) return cb(err || new Error("Échange introuvable"));

        // Le groupe de chaque côté ; fertile NULL — offres d'avant les
        // individus — veut dire « n'importe lequel ».
        const side = (prefix) => ({
          pokemonId: trade[`${prefix}_pokemon_id`] ?? null,
          speciesId: trade[`${prefix}_species_id`],
          isShiny: Boolean(trade[`${prefix}_is_shiny`]),
          sex: trade[`${prefix}_sex`] || null,
          fertile:
            trade[`${prefix}_fertile`] === null || trade[`${prefix}_fertile`] === undefined
              ? null
              : Boolean(trade[`${prefix}_fertile`]),
        });

        // Retrait chez l'initiateur, puis chez la cible, avec compensation si
        // le second échoue (le Pokémon a pu évoluer entre-temps). Aucun ne
        // cède son dernier de l'espèce : reserveDuplicates le refuse, exactement
        // comme pour une évolution ou une revente.
        reserveDuplicates(trade.from_user_id, side("offer"), 1, (err, offered) => {
          if (err) return cb(err);
          if (!offered.length) {
            return releaseTrade(tradeId, "FAILED", () =>
              cb(null, {
                ok: false,
                reason:
                  "Le Pokémon proposé n'est plus disponible : il est parti, verrouillé, ou " +
                  "c'est le dernier de son espèce chez l'initiateur.",
              })
            );
          }

          reserveDuplicates(trade.to_user_id, side("request"), 1, (err, requested) => {
            if (err || !requested.length) {
              // Compensation : on rend son Pokémon à l'initiateur.
              return restoreDuplicates(offered, (restoreError) => {
                if (restoreError) handleException("Restitution d'un échange :", restoreError);
                if (err) return cb(err);
                releaseTrade(tradeId, "FAILED", () =>
                  cb(null, {
                    ok: false,
                    reason:
                      "Le Pokémon demandé n'est plus disponible : il est parti, verrouillé, " +
                      "ou c'est ton dernier de son espèce.",
                  })
                );
              });
            }

            // Chaque individu change de dresseur sans cesser d'être lui-même :
            // même identifiant, même sexe, même ball. Il passe par tradedForm,
            // qui le fait évoluer s'il est de ceux qui évoluent à l'échange — un
            // échange de Machopeur contre Machopeur fait deux Mackogneur, comme
            // dans le jeu d'origine.
            const now = Date.now();
            const [mine] = offered;
            const [theirs] = requested;
            const arrive = (row, userId) => {
              const species = getSpecies(tradedForm(row.species_id));
              return {
                ...row,
                user_id: userId,
                species_id: species.id,
                sex: sexAfterEvolution(species, row.sex),
                origin: "echange",
                obtained_at: now,
                // Il arrive comme une capture : verrouillé d'office s'il est
                // shiny ou légendaire, au nouveau dresseur de décider ensuite.
                locked: lockedByDefault(species.id, row.is_shiny) ? 1 : 0,
                // Sa place était celle du PC de l'autre : chez son nouveau
                // dresseur, il prend la première libre. Son surnom le suit,
                // comme dans les jeux.
                pc_pos: null,
              };
            };
            const arrivals = [arrive(mine, trade.to_user_id), arrive(theirs, trade.from_user_id)];

            restoreDuplicates(arrivals, (err) => {
              if (err) {
                // Au mieux : chacun récupère son Pokémon plutôt que de le perdre.
                handleException("Livraison d'un échange :", err);
                return db.run(
                  "DELETE FROM pokemon_owned WHERE id IN (?, ?)",
                  [mine.id, theirs.id],
                  () => restoreDuplicates([mine, theirs], () => cb(err))
                );
              }
              recordTrade({ fromUserId: trade.from_user_id, toUserId: trade.to_user_id });
              // La fonction qui a appliqué les évolutions est la seule à pouvoir
              // dire lesquelles ont eu lieu — et quels individus ont traversé.
              cb(null, {
                ok: true,
                trade,
                received: { byTarget: arrivals[0], byInitiator: arrivals[1] },
                evolutions: [
                  { userId: trade.to_user_id, from: mine, to: arrivals[0] },
                  { userId: trade.from_user_id, from: theirs, to: arrivals[1] },
                ]
                  .filter(({ from, to }) => from.species_id !== to.species_id)
                  .map(({ userId, from, to }) => ({
                    userId,
                    from: from.species_id,
                    to: to.species_id,
                    isShiny: from.is_shiny,
                  })),
              });
            });
          });
        });
      });
    }
  );
}
