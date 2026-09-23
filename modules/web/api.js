// Les routes de l'API : ce que la future interface web lit et fait.
//
// Règle absolue : aucune règle de jeu ici. Chaque route appelle les mêmes
// fonctions que les commandes Discord — getIndividuals, sellPokemon, evolve,
// layEgg… —, si bien que le site et Discord ne peuvent pas se contredire, et
// que tout ce que fait l'un reste faisable par l'autre.
//
// Les réponses sont en JSON, en camelCase, et ne portent que des données : le
// texte à afficher reste l'affaire de l'interface.
import { getBalance } from "../economy.js";
import {
  getCollection,
  getIndividuals,
  resolveSelector,
  evolve,
  describeEvolution,
} from "../pokemon/collection.js";
import { isFinalThrow, resolveThrow, startThrow, throwMessage } from "../pokemon/capture.js";
import {
  RARITIES,
  activeGeneration,
  allSpecies,
  dexSize,
  difficultyLabel,
  evolutionChain,
  evolutionTargets,
  getAvailableSpecies,
  getSpecies,
  iconUrl,
  isEggOnly,
  isEvolutionOnly,
  isGenderless,
  isLegendary,
  probabilitiesByBall,
  rarityOf,
  spriteUrl,
} from "../pokemon/data.js";
import { getBalls, getPokemonConfig, getSafariConfig } from "../pokemon/config.js";
import { announceDropClaim, claimDrop, getOpenDrops } from "../pokemon/drops.js";
import { babyFamilies, canBreed, getIncubatingEgg, layEgg } from "../pokemon/eggs.js";
import {
  getBallItem,
  getBallStock,
  getInventory,
  getItem,
  getItems,
  sortByCatalogue,
} from "../pokemon/items.js";
import { pokemonSellValue, sellPokemon } from "../pokemon/sell.js";
import {
  getActiveSpawn,
  getLastEndedSpawn,
  getSpawnPause,
  recentThrows,
} from "../pokemon/spawn.js";
import { getConfig } from "../config.js";

// Les fonctions du jeu sont à callbacks ; les routes, en promesses.
const promise = (fn) =>
  new Promise((resolve, reject) => fn((err, value) => (err ? reject(err) : resolve(value))));

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------------------- Mises en forme ----------------------

// Comment on obtient une espèce, ou pourquoi on ne la croisera pas.
const obtention = (species) =>
  isEggOnly(species) ? "egg" : isEvolutionOnly(species) ? "evolution" : "wild";

// `families` se calcule une fois par requête, pas une fois par espèce (voir
// babyOf).
function speciesJson(species, families = babyFamilies()) {
  return {
    id: species.id,
    name: species.name,
    generation: species.generation,
    types: species.types,
    stage: species.stage,
    rarity: rarityOf(species),
    rarityLabel: RARITIES[rarityOf(species)].label,
    legendary: isLegendary(species),
    baby: Boolean(species.isBaby),
    genderless: isGenderless(species),
    femaleShare: isGenderless(species) ? null : species.genderRate / 8,
    catchRate: species.catchRate,
    obtention: obtention(species),
    // Parent possible d'un œuf : de quoi proposer les bons candidats, la ponte
    // tranchant de toute façon.
    breeder: canBreed(species, families),
    sellValue: pokemonSellValue(species, false),
    sellValueShiny: pokemonSellValue(species, true),
    evolvesFrom: getAvailableSpecies(species.evolvesFrom)?.id ?? null,
    evolvesInto: evolutionTargets(species).map((target) => target.id),
    sprite: spriteUrl(species, false),
    spriteShiny: spriteUrl(species, true),
    icon: iconUrl(species, false),
    iconShiny: iconUrl(species, true),
  };
}

function individualJson(row) {
  return {
    id: row.id,
    speciesId: row.species_id,
    shiny: Boolean(row.is_shiny),
    sex: row.sex,
    ball: row.ball,
    origin: row.origin,
    fertile: !row.sterile,
    last: Boolean(row.last),
    obtainedAt: row.obtained_at,
  };
}

function eggJson(egg) {
  if (!egg) return null;
  return {
    id: egg.id,
    speciesId: egg.species_id,
    fatherSpeciesId: egg.father_species_id,
    motherSpeciesId: egg.mother_species_id,
    messages: egg.messages,
    hatchMessages: egg.hatch_messages,
    laidAt: egg.laid_at,
    hatchAt: egg.hatch_at,
  };
}

// ---------------------- Paramètres ----------------------

// `me`, ou un identifiant Discord : rien d'autre ne passe. Lire la boîte d'un
// autre dresseur est permis, comme /pk boite membre — mais seulement une fois
// connecté, donc membre du serveur : ce qui s'y passe ne regarde pas Internet.
function targetOf(ctx) {
  const raw = ctx.params.userId;
  if (raw === "me") {
    if (!ctx.user) throw new HttpError(401, "Connexion requise.");
    return ctx.user.id;
  }
  if (!/^\d{5,25}$/.test(raw)) throw new HttpError(400, "Identifiant de dresseur invalide.");
  return raw;
}

const intParam = (value, fallback, { min = 0, max = Infinity } = {}) => {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

// Un Pokémon désigné dans un corps de requête : { pokemonId } pour un individu,
// ou { speciesId, isShiny, sex } pour un groupe — les deux formes qu'acceptent
// les commandes. Converti en valeur d'option, pour passer par resolveSelector
// comme elles.
function selectorValue(body, label) {
  if (!body || typeof body !== "object") throw new HttpError(400, `${label} manquant.`);
  if (body.pokemonId !== undefined) {
    const id = Number(body.pokemonId);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, `${label} : pokemonId invalide.`);
    return `#${id}`;
  }
  const speciesId = Number(body.speciesId);
  if (!getSpecies(speciesId)) throw new HttpError(400, `${label} : espèce inconnue.`);
  const sex = body.sex === "M" || body.sex === "F" ? body.sex : "";
  return [speciesId, body.isShiny ? 1 : 0, ...(sex ? [sex] : [])].join(":");
}

async function resolveOwn(userId, body, label) {
  const selector = await promise((cb) => resolveSelector(userId, selectorValue(body, label), cb));
  if (selector.error) throw new HttpError(404, selector.error);
  return selector;
}

// Le résultat d'une action du jeu : { ok, reason } devient un 409 quand le jeu
// refuse — ce n'est pas une panne, c'est une réponse.
function outcome(result, data) {
  if (!result?.ok) throw new HttpError(409, result?.reason ?? "Action refusée.");
  return data(result);
}

// Un dresseur tel que le serveur le montre : son pseudo sur le serveur et son
// avatar, comme une mention sur Discord. Le bot les a en cache, donc relire le
// journal toutes les quelques secondes ne coûte aucun appel à Discord. Un
// dresseur parti du serveur garde son identifiant, sans nom.
async function trainerOf(bot, userId) {
  try {
    const guild = await bot.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch(userId);
    return { id: userId, name: member.displayName, avatar: member.displayAvatarURL({ size: 64 }) };
  } catch {
    return { id: userId, name: null, avatar: null };
  }
}

// Une apparition, avec ce qu'en voit chaque dresseur : les chances de chaque
// ball, calculées comme sur l'annonce Discord, et ce qu'il en a déjà. L'objet
// tenu reste secret jusqu'à la fin, comme sur Discord.
async function spawnJson(ctx, spawn) {
  const config = getPokemonConfig();
  const [throws, inventory, collection] = await Promise.all([
    promise((cb) => recentThrows(spawn.id, config.spawn.throwLogSize, cb)),
    promise((cb) => getInventory(ctx.user.id, cb)),
    promise((cb) => getCollection(ctx.user.id, cb)),
  ]);
  const stock = new Map(inventory.map((row) => [row.item_key, row.count]));
  const owned = (shiny) =>
    collection.find((row) => row.species_id === spawn.species_id && Boolean(row.is_shiny) === shiny)
      ?.count ?? 0;
  return {
    id: spawn.id,
    speciesId: spawn.species_id,
    shiny: Boolean(spawn.is_shiny),
    rarity: spawn.rarity,
    rarityLabel: RARITIES[spawn.rarity]?.label ?? null,
    difficulty: difficultyLabel(spawn.catch_rate),
    throwCount: spawn.throw_count,
    spawnedAt: spawn.spawned_at,
    owned: { normal: owned(false), shiny: owned(true) },
    balls: probabilitiesByBall(spawn.catch_rate).map((ball) => ({
      key: ball.key,
      label: ball.label,
      emoji: ball.emoji,
      price: ball.price,
      probability: ball.probability,
      guaranteed: Boolean(ball.guaranteed),
      // Les balls offertes partent avant les points, comme sur Discord.
      free: stock.get(getBallItem(ball.key)?.key) ?? 0,
    })),
    throws: await Promise.all(
      throws.map(async (row) => ({
        trainer: await trainerOf(ctx.bot, row.user_id),
        ball: row.ball,
        result: row.result,
      }))
    ),
  };
}

// ---------------------- Routes ----------------------

export const routes = [
  {
    method: "GET",
    path: "/api/health",
    handler: async () => ({ ok: true, generation: activeGeneration() }),
  },

  {
    method: "GET",
    path: "/api/me",
    auth: true,
    handler: async (ctx) => {
      const [balance, balls, egg] = await Promise.all([
        promise((cb) => getBalance(ctx.user.id, cb)),
        promise((cb) => getBallStock(ctx.user.id, cb)),
        promise((cb) => getIncubatingEgg(ctx.user.id, cb)),
      ]);
      return { user: ctx.user, balance, balls, egg: eggJson(egg) };
    },
  },

  {
    method: "GET",
    path: "/api/species",
    handler: async () => {
      const families = babyFamilies();
      return {
        generation: activeGeneration(),
        species: allSpecies().map((species) => speciesJson(species, families)),
      };
    },
  },

  // Les noms et icônes des balls et des objets : de quoi afficher la ball d'un
  // individu ou un objet sans rien recopier de la configuration. Les emoji sont
  // ceux du serveur Discord, au format `<:nom:id>`.
  {
    method: "GET",
    path: "/api/catalogue",
    handler: async () => ({
      balls: [...getBalls(), getSafariConfig().ball].map(({ key, label, emoji }) => ({
        key,
        label,
        emoji,
      })),
      items: getItems().map((item) => ({
        key: item.key,
        label: item.label,
        emoji: item.emoji,
        description: item.description ?? null,
      })),
    }),
  },

  {
    method: "GET",
    path: "/api/species/:speciesId",
    handler: async (ctx) => {
      const species = getAvailableSpecies(ctx.params.speciesId);
      if (!species) throw new HttpError(404, "Espèce inconnue.");
      return {
        ...speciesJson(species),
        chain: evolutionChain(species).map((link) => link.id),
      };
    },
  },

  {
    method: "GET",
    path: "/api/users/:userId/pokedex",
    auth: true,
    handler: async (ctx) => {
      const rows = await promise((cb) => getCollection(targetOf(ctx), cb));
      return {
        dexSize: dexSize(),
        entries: rows.map((row) => ({
          speciesId: row.species_id,
          shiny: Boolean(row.is_shiny),
          count: row.count,
          firstCaughtAt: row.first_caught_at,
        })),
      };
    },
  },

  // La boîte, filtrable et paginée comme /pk boite. Les plus récents d'abord.
  {
    method: "GET",
    path: "/api/users/:userId/box",
    auth: true,
    handler: async (ctx) => {
      const rows = await promise((cb) => getIndividuals(targetOf(ctx), cb));
      const { species, sex, fertile, shiny } = ctx.query;
      const filtered = rows
        .filter((row) => !species || row.species_id === Number(species))
        .filter((row) => !sex || (sex === "none" ? row.sex === null : row.sex === sex))
        .filter((row) => fertile === undefined || Boolean(row.sterile) !== (fertile === "true"))
        .filter((row) => shiny === undefined || Boolean(row.is_shiny) === (shiny === "true"))
        .sort((a, b) => b.obtained_at - a.obtained_at || b.id - a.id);
      const pageSize = intParam(ctx.query.pageSize, 50, { min: 1, max: 200 });
      const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
      const page = intParam(ctx.query.page, 0, { min: 0, max: pages - 1 });
      return {
        total: filtered.length,
        page,
        pages,
        pageSize,
        items: filtered.slice(page * pageSize, (page + 1) * pageSize).map(individualJson),
      };
    },
  },

  {
    method: "GET",
    path: "/api/users/:userId/inventory",
    auth: true,
    handler: async (ctx) => {
      const rows = await promise((cb) => getInventory(targetOf(ctx), cb));
      return {
        items: sortByCatalogue(rows).map((row) => {
          const item = getItem(row.item_key);
          return {
            key: row.item_key,
            label: item?.label ?? row.item_key,
            emoji: item?.emoji ?? null,
            description: item?.description ?? null,
            count: row.count,
          };
        }),
      };
    },
  },

  {
    method: "GET",
    path: "/api/me/egg",
    auth: true,
    handler: async (ctx) => ({
      egg: eggJson(await promise((cb) => getIncubatingEgg(ctx.user.id, cb))),
    }),
  },

  // Ce qu'une évolution coûterait, sans rien faire : l'écran de fusion.
  {
    method: "GET",
    path: "/api/species/:speciesId/evolution",
    handler: async (ctx) => {
      const plan = describeEvolution(
        Number(ctx.params.speciesId),
        ctx.query.targetId ? Number(ctx.query.targetId) : null,
        ctx.query.helper || null
      );
      if (plan.error) throw new HttpError(409, plan.error);
      return {
        targets: plan.targets.map((target) => target.id),
        target: plan.target?.id ?? null,
        duplicates: plan.duplicates,
        required: plan.required,
        points: plan.points,
        helper: plan.helper ? { key: plan.helper.item.key, quantity: plan.helper.quantity } : null,
      };
    },
  },

  // L'apparition en cours — la même que dans le salon Discord —, ou à défaut la
  // dernière partie, et les objets qui attendent au sol. L'onglet Capture la
  // relit toutes les `refreshSeconds`.
  {
    method: "GET",
    path: "/api/spawn",
    auth: true,
    handler: async (ctx) => {
      const [active, last, pausedUntil, drops] = await Promise.all([
        promise((cb) => getActiveSpawn((err, row) => cb(err, row ?? null))),
        promise((cb) => getLastEndedSpawn(cb)),
        promise((cb) => getSpawnPause(cb)),
        promise((cb) => getOpenDrops(cb)),
      ]);
      return {
        refreshSeconds: Math.max(1, Number(getConfig().web?.spawnRefreshSeconds) || 5),
        cooldownSeconds: getPokemonConfig().capture.throwCooldownSeconds,
        pausedUntil: pausedUntil > Date.now() ? pausedUntil : null,
        spawn: active ? await spawnJson(ctx, active) : null,
        last: last
          ? {
              id: last.id,
              speciesId: last.species_id,
              shiny: Boolean(last.is_shiny),
              status: last.status,
              caughtBy: last.caught_by ? await trainerOf(ctx.bot, last.caught_by) : null,
              ball: last.caught_ball,
              endedAt: last.ended_at,
            }
          : null,
        drops: drops.map((drop) => {
          const item = getItem(drop.item_key);
          return {
            id: drop.id,
            itemKey: drop.item_key,
            label: item?.label ?? drop.item_key,
            emoji: item?.emoji ?? null,
            droppedAt: drop.dropped_at,
          };
        }),
      };
    },
  },

  // ---------------------- Actions ----------------------

  // Un lancer, par le même chemin que les boutons Discord : même cooldown, même
  // paiement, même course. Toujours 200 : un raté ou un « trop tard » sont des
  // issues du jeu, pas des erreurs, et `status` dit laquelle. La Master Ball se
  // confirme côté site, comme sur Discord ; `requireItem` porte la même
  // promesse : une ball annoncée offerte ne se paie jamais en points.
  {
    method: "POST",
    path: "/api/spawn/throw",
    auth: true,
    write: true,
    handler: async (ctx) => {
      const spawnId = Number(ctx.body.spawnId);
      if (!Number.isInteger(spawnId) || spawnId <= 0) throw new HttpError(400, "spawnId invalide.");
      if (typeof ctx.body.ball !== "string") throw new HttpError(400, "ball manquante.");
      const requireItem = ctx.body.requireItem === true;

      const outcome =
        startThrow(ctx.user.id, ctx.body.ball) ??
        (await promise((cb) =>
          resolveThrow(ctx.bot, ctx.user.id, spawnId, ctx.body.ball, { requireItem }, cb)
        ));
      return {
        status: outcome.status,
        message: throwMessage(outcome),
        final: isFinalThrow(outcome),
        remaining: outcome.remaining ?? null,
        pokemon: outcome.caught ? { id: outcome.caught.id, sex: outcome.caught.sex } : null,
      };
    },
  },

  // Ramasser un objet au sol : la même course que le bouton du salon, dont le
  // message est mis à jour pour que personne n'y clique dans le vide.
  {
    method: "POST",
    path: "/api/drops/:dropId/claim",
    auth: true,
    write: true,
    handler: async (ctx) => {
      const dropId = Number(ctx.params.dropId);
      if (!Number.isInteger(dropId) || dropId <= 0) throw new HttpError(400, "Objet invalide.");
      const claimed = await promise((cb) => claimDrop(ctx.user.id, dropId, cb));
      if (!claimed) throw new HttpError(409, "💨 Trop tard, quelqu'un a été plus rapide !");
      announceDropClaim(ctx.bot, claimed.drop, claimed.item, ctx.user.id);
      return { item: { key: claimed.item.key, label: claimed.item.label, emoji: claimed.item.emoji } };
    },
  },

  {
    method: "POST",
    path: "/api/me/sell",
    auth: true,
    write: true,
    handler: async (ctx) => {
      const selector = await resolveOwn(ctx.user.id, ctx.body, "Pokémon");
      const quantity = selector.pokemonId ? 1 : intParam(ctx.body.quantity, 1, { min: 1 });
      const result = await promise((cb) => sellPokemon(ctx.user.id, selector, quantity, cb));
      return outcome(result, ({ quantity: sold, unit, points }) => ({ sold, unit, points }));
    },
  },

  {
    method: "POST",
    path: "/api/me/evolve",
    auth: true,
    write: true,
    handler: async (ctx) => {
      const selector = await resolveOwn(ctx.user.id, ctx.body, "Pokémon");
      const targetId = ctx.body.targetId ? Number(ctx.body.targetId) : null;
      const helper = typeof ctx.body.helper === "string" ? ctx.body.helper : null;
      const result = await promise((cb) => evolve(ctx.user.id, selector, targetId, helper, cb));
      return outcome(result, ({ target, plan, evolved, isShiny }) => ({
        pokemon: {
          id: evolved?.id ?? null,
          speciesId: target.id,
          sex: evolved?.sex ?? null,
          shiny: isShiny,
        },
        duplicatesSpent: plan.duplicates,
        pointsSpent: plan.points,
        helper: plan.helper ? plan.helper.item.key : null,
      }));
    },
  },

  {
    method: "POST",
    path: "/api/me/eggs",
    auth: true,
    write: true,
    handler: async (ctx) => {
      const [first, second] = await Promise.all([
        resolveOwn(ctx.user.id, ctx.body.parent1, "parent1"),
        resolveOwn(ctx.user.id, ctx.body.parent2, "parent2"),
      ]);
      const result = await promise((cb) => layEgg(ctx.user.id, first, second, cb));
      return outcome(result, ({ egg }) => ({ egg: eggJson(egg) }));
    },
  },
];
