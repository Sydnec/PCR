// Collection des dresseurs : lecture, fusion (évolution) et échanges.
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
  evolutionTargets,
  getSpecies,
  rollSex,
  sexAfterEvolution,
  tradeEvolutionTarget,
} from "./data.js";
import { consumeItem, getItem, grantItem } from "./items.js";
import { recordFusion, recordTrade } from "./stats.js";

// Un groupe d'individus : une espèce, une variante (un shiny est une entrée de
// Pokédex distincte), et au besoin un sexe et une fertilité. Les commandes
// encodent le tout dans la valeur d'une option ; une partie absente veut dire
// « peu importe ».
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

// Une ligne par entrée de Pokédex, dans la forme qu'avait l'ancienne table :
// { species_id, is_shiny, count, first_caught_at }. Pokédex, classement et
// listes de commandes n'ont pas eu à changer.
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

// Combien le dresseur possède d'individus de la même entrée (espèce +
// variante) qu'un individu `o` de pokemon_owned. La règle du Pokédex — il en
// reste toujours au moins un — se lit sur ce seul fragment.
const ENTRY_COUNT = `(SELECT COUNT(*) FROM pokemon_owned k
    WHERE k.user_id = o.user_id AND k.species_id = o.species_id AND k.is_shiny = o.is_shiny)`;

// Tous les individus d'un dresseur, `last` marquant celui qui est le dernier de
// son entrée : lui seul ne peut pas partir. Triés par entrée puis par ancienneté.
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

// Regroupe des individus par espèce et variante, et au besoin par sexe et
// fertilité. `spare` compte ceux qu'on peut céder : tous ceux du groupe, dans
// la limite de ce que l'entrée peut perdre en gardant un exemplaire. Deux
// groupes d'une même entrée partagent cette marge : c'est un plafond, que la
// réservation revérifie de toute façon.
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
        fertileCount: 0,
      });
    }
    const group = groups.get(key);
    group.count++;
    if (!row.sterile) group.fertileCount++;
  }
  const entrySize = new Map();
  for (const row of rows) {
    const entry = encodeEntry(row.species_id, row.is_shiny);
    entrySize.set(entry, (entrySize.get(entry) ?? 0) + 1);
  }
  for (const group of groups.values()) {
    const margin = entrySize.get(encodeEntry(group.speciesId, group.isShiny)) - 1;
    group.spare = Math.min(group.count, margin);
  }
  return [...groups.values()];
}

// Combien un dresseur possède d'individus d'un groupe, et combien il peut en
// céder. Sert aux refus, pour les dire avec les bons chiffres.
export function countGroup(userId, group, cb) {
  getIndividuals(userId, (err, rows) => {
    if (err) return cb(err, { owned: 0, spare: 0 });
    const matching = rows.filter((row) => matchesGroup(row, group));
    const entry = rows.filter((row) =>
      matchesGroup(row, { speciesId: group.speciesId, isShiny: group.isShiny })
    );
    cb(null, {
      owned: matching.length,
      spare: Math.min(matching.length, Math.max(0, entry.length - 1)),
    });
  });
}

const matchesGroup = (row, { speciesId, isShiny, sex = null, fertile = null, pokemonId = null }) =>
  (!pokemonId || row.id === Number(pokemonId)) &&
  row.species_id === Number(speciesId) &&
  Boolean(row.is_shiny) === Boolean(isShiny) &&
  (!sex || row.sex === sex) &&
  (fertile === null || fertile === undefined || Boolean(row.sterile) === !fertile);

export function getOwned(userId, speciesId, isShiny, cb) {
  db.get(
    "SELECT COUNT(*) AS count FROM pokemon_owned WHERE user_id = ? AND species_id = ? AND is_shiny = ?",
    [userId, speciesId, isShiny ? 1 : 0],
    (err, row) => cb(err, row ? row.count : 0)
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
            COUNT(DISTINCT CASE WHEN is_shiny = 0 THEN species_id END) AS dex,
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

// Chemin unique de crédit de la collection : capture sauvage, parc safari,
// éclosion et évolution sans individu à transformer passent tous par ici. Le
// sexe se tire selon l'espèce sauf s'il est imposé ; la ball est celle de la
// capture, NULL quand il n'y en a pas eu. Rend l'individu créé { id, sex }.
export function creditSpecies(userId, speciesId, isShiny, options, cb) {
  const { ball = null, origin, sex = null, obtainedAt = Date.now() } = options;
  const chosenSex = sex ?? rollSex(getSpecies(speciesId));
  db.run(
    `INSERT INTO pokemon_owned (user_id, species_id, is_shiny, sex, ball, origin, sterile, obtained_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    [userId, speciesId, isShiny ? 1 : 0, chosenSex, ball, origin, obtainedAt],
    function (err) {
      if (err) return cb(err, null);
      cb(null, { id: this.lastID, sex: chosenSex });
    }
  );
}

// ====================== DOUBLONS ======================

// Retire des individus d'un groupe en garantissant qu'il en reste TOUJOURS un de
// l'entrée. C'est l'invariant du Pokédex : une fusion, une revente, un échange,
// rien ne doit pouvoir effacer une entrée durement gagnée. Contrairement aux
// jeux, avoir capturé un Pokémon ne suffit pas à le garder au Pokédex, il faut
// le posséder. Aucun individu n'est réservé pour autant : n'importe lequel peut
// partir, pourvu qu'il ne soit pas le dernier de son entrée.
//
// Parmi les candidats, on prend d'abord ce qui vaut le moins — les stériles,
// puis les plus récents : un individu encore capable de pondre ne part qu'en
// dernier.
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
  const { speciesId, isShiny, sex = null, fertile = null, pokemonId = null } = group;
  const filter = `o.user_id = $user AND o.species_id = $species AND o.is_shiny = $shiny
    AND ($id IS NULL OR o.id = $id)
    AND ($sex IS NULL OR o.sex = $sex)
    AND ($sterile IS NULL OR o.sterile = $sterile)`;
  db.all(
    `DELETE FROM pokemon_owned
      WHERE id IN (
        SELECT o.id FROM pokemon_owned o WHERE ${filter}
         ORDER BY o.sterile DESC, o.obtained_at DESC, o.id DESC
         LIMIT $quantity)
        AND (SELECT COUNT(*) FROM pokemon_owned o WHERE ${filter}) >= $quantity
        AND (SELECT COUNT(*) FROM pokemon_owned
              WHERE user_id = $user AND species_id = $species AND is_shiny = $shiny)
            >= $quantity + 1
      RETURNING *`,
    {
      $user: userId,
      $species: Number(speciesId),
      $shiny: isShiny ? 1 : 0,
      $id: pokemonId ? Number(pokemonId) : null,
      $sex: sex,
      $sterile: fertile === null || fertile === undefined ? null : fertile ? 0 : 1,
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
    if (!row) return cb(null);
    // La place dans la boîte PC et le surnom reviennent avec lui : un Pokémon
    // qui évolue, ou qu'une compensation remet en place, reste où son
    // dresseur l'avait rangé, sous le nom qu'il lui avait donné.
    db.run(
      `INSERT INTO pokemon_owned
         (id, user_id, species_id, is_shiny, sex, ball, origin, sterile, obtained_at, pc_pos, nickname)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ],
      next
    );
  };
  next(null);
}

// ====================== FUSION / ÉVOLUTION ======================

// L'aide qu'un objet apporte à une fusion, ou null. C'est le catalogue qui la
// décrit — combien d'exemplaires de l'objet, combien d'exemplaires du Pokémon
// qu'ils remplacent, et s'ils dispensent du coût en points — et cette fonction
// ne fait que la relire et la refuser quand elle ne s'applique pas.
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

// Décrit ce que coûte une évolution, sans rien modifier.
// `chosenTargetId` non nul sur une lignée à embranchement (Évoli) déclenche le
// tarif « choix », plus cher que le tirage au sort.
//
// `helperKey` désigne un objet qui prend une partie de la facture à sa charge :
// il remplace des exemplaires, parfois les points, et peut imposer la cible.
export function describeEvolution(speciesId, chosenTargetId = null, helperKey = null) {
  const config = getPokemonConfig().evolution;
  const species = getSpecies(speciesId);
  if (!species) return { error: "Espèce inconnue." };
  if (species.tradeEvolution) {
    // Sécurité : une évolution par échange est une CIBLE de fusion, jamais une
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
  const referenceStage = (target ?? targets[0]).stage;
  const stageCost = config[referenceStage];
  if (!stageCost) return { error: "Aucun coût configuré pour ce stade." };

  // Le supplément « choix » ne se paie que sur un choix DU JOUEUR : une pierre
  // impose sa cible, ce n'est pas le dresseur qui trie.
  const basePoints =
    branching && chosenTargetId && !helper?.target
      ? config.branchChoicePoints
      : stageCost.points;

  // L'aide retire des exemplaires à fournir, jamais en dessous de zéro : un
  // objet trop généreux ne doit pas rendre une fusion négative.
  const duplicates = Math.max(0, stageCost.duplicates - (helper?.copies ?? 0));

  return {
    species,
    targets,
    target,
    branching,
    helper,
    duplicates,
    points: helper?.freePoints ? 0 : basePoints,
    // On exige un exemplaire de plus que les doublons consommés : l'entrée du
    // Pokédex n'est jamais perdue à cause d'une fusion.
    required: duplicates + 1,
  };
}

// Exécute la fusion. Enchaînement ordonné avec compensation : chaque étape rend
// ce que les précédentes ont réservé si elle échoue. L'ordre n'est pas
// indifférent — on prend d'abord ce qui est le plus probable de manquer, pour
// que le cas courant (« il te manque un exemplaire ») ne déplace rien du tout.
//
// `group` désigne l'entrée qui évolue et, au besoin, le sexe de l'individu qui
// évolue : les doublons consommés sont des individus, et l'un d'eux — du sexe
// demandé — devient la forme évoluée en gardant son sexe, sa ball et sa
// fertilité. Les autres disparaissent : c'est le prix de la fusion.
//
// `group.pokemonId` désigne l'individu qui évolue ; espèce, variante et sexe se
// lisent alors sur lui.
export function evolve(userId, group, chosenTargetId, helperKey, cb) {
  if (group.pokemonId && !group.speciesId) {
    return resolveSelector(userId, encodeIndividual(group.pokemonId), (err, selector) => {
      if (err) return cb(err);
      if (selector.error) return cb(null, { ok: false, reason: selector.error });
      evolve(userId, selector, chosenTargetId, helperKey, cb);
    });
  }
  const { speciesId, isShiny, sex = null, pokemonId = null } = group;
  const plan = describeEvolution(speciesId, chosenTargetId, helperKey);
  if (plan.error) return cb(null, { ok: false, reason: plan.error });

  const target =
    plan.target ?? plan.targets[Math.floor(Math.random() * plan.targets.length)];
  const helper = plan.helper;

  // Étape 3 : les points. Zéro se saute au lieu de se débiter — spendPoints
  // refuserait un dresseur sans ligne de solde, et une fusion gratuite n'a pas à
  // dépendre de ça.
  const payer = (reserved, rendreExemplaires) => {
    // `rendreTout` est la compensation COMPLÈTE au point où on l'appelle : les
    // exemplaires, l'aide, et les points s'ils sont déjà partis. Sans elle, un
    // crédit de collection raté au tout dernier moment laissait le dresseur
    // délesté de tout et sans rien — exactement ce que cette cascade existe pour
    // empêcher, et la seule étape qui y échappait.
    const finir = (rendreTout) => {
      const journal = (evolved) =>
        db.run(
          `INSERT INTO pokemon_fusions
             (user_id, from_species_id, to_species_id, is_shiny, duplicates_spent, points_spent, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [userId, speciesId, target.id, isShiny ? 1 : 0, plan.duplicates, plan.points, Date.now()],
          (err) => {
            if (err) handleException("Journal de fusion :", err);
            recordFusion({ userId, duplicates: plan.duplicates, points: plan.points });
            cb(null, { ok: true, target, plan, evolved, isShiny: Boolean(isShiny) });
          }
        );

      // L'individu qui évolue est le premier réservé, celui du sexe demandé. Il
      // revient sous sa nouvelle forme, même identifiant ; un shiny évolue en
      // shiny puisque rien d'autre ne change.
      const [evolver] = reserved;
      if (evolver) {
        const evolved = {
          ...evolver,
          species_id: target.id,
          sex: sexAfterEvolution(target, evolver.sex),
        };
        return restoreDuplicates([evolved], (err) => {
          if (err) return rendreTout(() => cb(err));
          journal({ id: evolved.id, sex: evolved.sex });
        });
      }
      // Rien de réservé : une aide couvre tous les exemplaires. La forme évoluée
      // est un nouvel individu, du sexe demandé.
      const options = { origin: "evolution", sex: sexAfterEvolution(target, sex) };
      creditSpecies(userId, target.id, isShiny, options, (err, created) => {
        if (err) return rendreTout(() => cb(err));
        journal(created);
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
          if (err) handleException("Remboursement d'une fusion échouée :", err);
          rendreExemplaires(suite);
        })
      );
    });
  };

  // Étape 2 : l'aide, s'il y en a une. Elle est consommée après les exemplaires
  // parce qu'elle est plus rare : mieux vaut rendre un doublon qu'une pierre.
  const prendreAide = (reserved, rendreExemplaires) => {
    if (!helper) return payer(reserved, rendreExemplaires);
    consumeItem(userId, helper.item.key, helper.quantity, { source: "fusion" }, (err, pris) => {
      if (err) return rendreExemplaires(() => cb(err));
      if (!pris) {
        return rendreExemplaires(() =>
          cb(null, {
            ok: false,
            reason:
              `Il te faut **${helper.quantity}** ${helper.item.emoji} ${helper.item.label} ` +
              `pour cette fusion.`,
          })
        );
      }
      payer(reserved, (suite) =>
        // Compensation en cascade : l'aide revient, puis les exemplaires.
        grantItem(userId, helper.item.key, helper.quantity, { source: "fusion-annulee" }, (err) => {
          if (err) handleException("Restitution d'une aide de fusion :", err);
          rendreExemplaires(suite);
        })
      );
    });
  };

  // Étape 1 : les exemplaires. `plan.duplicates` peut valoir zéro si une aide
  // couvre tout : il n'y a alors rien à réserver, seulement à vérifier qu'il
  // reste bien un Pokémon du sexe demandé à faire évoluer.
  //
  // Un individu désigné (#id) évolue lui-même : son sexe n'est pas une
  // condition, seulement celui qu'il se trouve avoir, et le rappeler ferait
  // croire qu'il faut en trouver un autre. On dit alors ce qu'il faut autour
  // de lui.
  const name = `${plan.species.name}${isShiny ? " shiny" : ""}`;
  const others = plan.duplicates - 1;
  const manque = () =>
    cb(null, {
      ok: false,
      reason: pokemonId
        ? `Il te faut **${plan.required}** ${name} pour faire évoluer #${pokemonId} : lui, ` +
          (others > 0 ? `${others} autre${others > 1 ? "s" : ""} consommé${others > 1 ? "s" : ""} ` : "") +
          `et 1 conservé.`
        : `Il te faut **${plan.required}** exemplaires de ${name} ` +
          `(${plan.duplicates} consommés + 1 conservé)` +
          (sex && plan.duplicates > 0
            ? `, dont un ${sex === "F" ? "femelle" : "mâle"} pour évoluer.`
            : "."),
    });

  if (plan.duplicates <= 0) {
    return countGroup(userId, { speciesId, isShiny, sex, pokemonId }, (err, { owned }) => {
      if (err) return cb(err);
      if (owned < 1) return manque();
      prendreAide([], (suite) => suite());
    });
  }

  const rendre = (rows) => (suite) =>
    restoreDuplicates(rows, (err) => {
      if (err) handleException("Compensation de fusion impossible :", err);
      suite();
    });

  // L'individu qui évolue d'abord, du sexe demandé ; puis le reste de la
  // facture, sans condition de sexe. Deux réservations, donc deux gardes : si
  // la seconde échoue, la première est rendue avant de dire ce qui manque.
  reserveDuplicates(userId, { speciesId, isShiny, sex, pokemonId }, 1, (err, evolvers) => {
    if (err) return cb(err);
    if (!evolvers.length && pokemonId) {
      return cb(null, {
        ok: false,
        reason:
          `Le Pokémon #${pokemonId} ne peut pas évoluer : c'est ton dernier de son espèce, ` +
          `ou il n'est plus à toi.`,
      });
    }
    if (!evolvers.length) return manque();
    if (others <= 0) return prendreAide(evolvers, rendre(evolvers));
    reserveDuplicates(userId, { speciesId, isShiny }, others, (err, rest) => {
      if (err || !rest.length) {
        return rendre(evolvers)(() => (err ? cb(err) : manque()));
      }
      const reserved = [...evolvers, ...rest];
      prendreAide(reserved, rendre(reserved));
    });
  });
}

// ====================== ÉCHANGES ======================

// Ce qu'un Pokémon devient en changeant de dresseur. Quatre espèces de la
// première génération évoluent à l'échange, et c'est le dresseur qui REÇOIT qui
// reçoit la forme évoluée — celui qui donne son Machopeur ne voit jamais le
// Mackogneur. L'échange devient donc la seconde porte vers ces quatre-là, à
// côté de la fusion : la moins chère, mais celle qui coûte un partenaire.
//
// Le calcul vit ici et pas dans acceptTrade parce qu'il sert deux fois, une
// par Pokémon traversé, et qu'une règle de jeu écrite deux fois finit toujours
// par ne plus l'être qu'une.
const tradedForm = (speciesId) =>
  tradeEvolutionTarget(getSpecies(speciesId))?.id ?? Number(speciesId);

// Chaque côté désigne un groupe — espèce, variante, sexe, fertilité — plutôt
// qu'un individu précis : l'individu est choisi à l'acceptation, selon la même
// règle que partout (jamais celui qu'on garde, les moins précieux d'abord).
// La fertilité fait partie du groupe parce qu'elle change la valeur d'un
// Pokémon : qui reçoit une femelle fertile doit pouvoir compter dessus.
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
        // le second échoue (le Pokémon a pu être fusionné entre-temps). Chacun
        // ne cède qu'un doublon : reserveDuplicates refuse de toucher à
        // l'individu qu'on garde, exactement comme pour une fusion ou une revente.
        reserveDuplicates(trade.from_user_id, side("offer"), 1, (err, offered) => {
          if (err) return cb(err);
          if (!offered.length) {
            return releaseTrade(tradeId, "FAILED", () =>
              cb(null, {
                ok: false,
                reason:
                  "L'initiateur n'a plus de doublon du Pokémon proposé : il lui en " +
                  "reste toujours au moins un.",
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
                      "Tu n'as plus de doublon du Pokémon demandé : il t'en reste " +
                      "toujours au moins un.",
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
