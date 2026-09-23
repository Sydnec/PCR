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
  getOwnedVariantsFor,
  resolveSelector,
  evolve,
  describeEvolution,
  setLock,
  DITTO_HELPER,
} from "../pokemon/collection.js";
import { isFinalThrow, resolveThrow, startThrow, throwMessage } from "../pokemon/capture.js";
import {
  RARITIES,
  activeGeneration,
  allSpecies,
  dexSize,
  difficultyOf,
  evolutionChain,
  evolutionTargets,
  getAvailableSpecies,
  getSpecies,
  iconUrl,
  isEggOnly,
  isSafariFinished,
  itemImageUrl,
  isEvolutionOnly,
  isGenderless,
  isLegendary,
  probabilitiesByBall,
  rarityOf,
  safariBaitCapped,
  safariBaitFactor,
  safariCatchProbability,
  safariFleeChance,
  spriteUrl,
  typeColors,
} from "../pokemon/data.js";
import { getBalls, getPokemonConfig, getSafariConfig } from "../pokemon/config.js";
import { announceDropClaim, claimDrop, getOpenDrops } from "../pokemon/drops.js";
import { safariOutcomeLine } from "../pokemon/embeds.js";
import { getPc, movePokemon, renameBox, renamePokemon } from "../pokemon/pc.js";
import {
  enterPark,
  getEntryOffer,
  getSessionCatches,
  playAction,
  refreshParkMessage,
  startPaidSession,
} from "../pokemon/safari.js";
import {
  babyFamilies,
  canBreed,
  eggShinyFactor,
  getIncubatingEgg,
  layEgg,
} from "../pokemon/eggs.js";
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
import { configOverrideStatus, configTree, getConfig, writeConfigValue } from "../config.js";
import { log } from "../utils.js";

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
    locked: Boolean(row.locked),
    obtainedAt: row.obtained_at,
    nickname: row.nickname ?? null,
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
    // Combien de parents étaient shiny, et par combien cela multiplie les
    // chances de shiny du bébé : le calcul du tirage, pas une copie.
    shinyParents: egg.shiny_parents ?? 0,
    shinyFactor: eggShinyFactor(egg.shiny_parents),
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

// La lignée d'une espèce et ce que le dresseur possède de chaque maillon : la
// fiche du bouton « Infos du Pokémon », lue par les mêmes fonctions.
async function lineageJson(userId, species) {
  const chain = species ? evolutionChain(species) : [];
  const owned = await promise((cb) =>
    getOwnedVariantsFor(userId, chain.map((link) => link.id), cb)
  );
  return chain.map((link) => ({
    speciesId: link.id,
    stage: link.stage,
    owned: owned.get(link.id) ?? { normal: 0, shiny: 0 },
  }));
}

// Une ball ou un objet tel que le site l'affiche : son emoji Discord, et son
// image quand la configuration lui en donne une.
const withImage = (entry) => ({ ...entry, image: itemImageUrl(entry.sprite) });

// Le solde et les balls en poche, tels que l'en-tête du site les affiche. Lu
// par /api/me et relu avec chaque apparition : des points gagnés sur Discord
// doivent se voir sans recharger la page, comme les balls offertes.
async function walletJson(userId) {
  const [balance, balls] = await Promise.all([
    promise((cb) => getBalance(userId, cb)),
    promise((cb) => getBallStock(userId, cb)),
  ]);
  return { balance, balls: balls.map(withImage) };
}

// Une apparition, avec ce qu'en voit chaque dresseur : les chances de chaque
// ball, calculées comme sur l'annonce Discord, et la fiche du bouton « Infos du
// Pokémon ». L'objet tenu reste secret jusqu'à la fin, comme sur Discord.
async function spawnJson(ctx, spawn, balance) {
  const config = getPokemonConfig();
  const species = getSpecies(spawn.species_id);
  const [throws, inventory, lineage] = await Promise.all([
    promise((cb) => recentThrows(spawn.id, config.spawn.throwLogSize, cb)),
    promise((cb) => getInventory(ctx.user.id, cb)),
    lineageJson(ctx.user.id, species),
  ]);
  const stock = new Map(inventory.map((row) => [row.item_key, row.count]));
  return {
    id: spawn.id,
    speciesId: spawn.species_id,
    shiny: Boolean(spawn.is_shiny),
    sex: spawn.sex ?? null,
    rarity: spawn.rarity,
    rarityLabel: RARITIES[spawn.rarity]?.label ?? null,
    // Figée à l'apparition, comme le taux de capture qui la fonde.
    difficulty: difficultyOf(spawn.catch_rate),
    throwCount: spawn.throw_count,
    spawnedAt: spawn.spawned_at,
    owned: lineage.find((link) => link.speciesId === spawn.species_id)?.owned ?? {
      normal: 0,
      shiny: 0,
    },
    lineage,
    balls: probabilitiesByBall(spawn.catch_rate).map((ball) => {
      // Les balls offertes partent avant les points, comme sur Discord : une
      // ball en poche se lance quel que soit le solde.
      const free = stock.get(getBallItem(ball.key)?.key) ?? 0;
      return {
        key: ball.key,
        label: ball.label,
        emoji: ball.emoji,
        image: itemImageUrl(ball.sprite),
        price: ball.price,
        probability: ball.probability,
        guaranteed: Boolean(ball.guaranteed),
        free,
        usable: free > 0 || balance >= ball.price,
      };
    }),
    throws: await Promise.all(
      throws.map(async (row) => ({
        trainer: await trainerOf(ctx.bot, row.user_id),
        ball: row.ball,
        result: row.result,
      }))
    ),
  };
}

// ---------------------- Parc safari ----------------------

// Une visite du parc telle que le site l'affiche : la rencontre (chances, appât,
// risque de fuite, calculés par les mêmes fonctions que l'embed Discord) et ce
// qui a déjà été capturé. `token` est le jeton anti-double-clic de playAction.
async function visitJson(session, owned) {
  const config = getSafariConfig();
  const finished = isSafariFinished(session);
  const species = finished ? null : getSpecies(session.encounter_species_id);
  const catches = await promise((cb) => getSessionCatches(session.id, cb));
  const bait = session.encounter_bait;
  return {
    id: session.id,
    token: session.actions_left,
    actionsLeft: session.actions_left,
    actionsTotal: config.actionsPerSession,
    expiresAt: session.expires_at,
    finished,
    catches: catches.map((row) => ({ speciesId: row.species_id, shiny: Boolean(row.is_shiny) })),
    ball: withImage(config.ball),
    encounter: species
      ? {
          speciesId: species.id,
          shiny: Boolean(session.encounter_is_shiny),
          sex: session.encounter_sex ?? null,
          rarity: rarityOf(species),
          rarityLabel: RARITIES[rarityOf(species)].label,
          probability: safariCatchProbability(session.encounter_catch_rate, bait, config),
          bait,
          baitFactor: safariBaitFactor(bait, config),
          baitCapped: safariBaitCapped(bait, config),
          fleeRisk: safariFleeChance(bait, config),
          owned: owned ?? null,
        }
      : null,
  };
}

// Ce que le dresseur peut faire du parc, pour le bouton de l'onglet Capture :
// reprendre sa visite, entrer dans un parc ouvert, ou acheter une entrée — le
// bouton d'achat grisé quand getEntryOffer annonce un refus.
async function safariState(ctx) {
  const offer = await promise((cb) => getEntryOffer(ctx.user.id, cb));
  const json = {
    enabled: offer.enabled,
    session: offer.ongoing
      ? { id: offer.ongoing.session.id, actionsLeft: offer.ongoing.session.actions_left }
      : null,
    freePark: offer.freePark
      ? {
          id: offer.freePark.id,
          expiresAt: offer.freePark.expires_at,
          reserved: Boolean(offer.freePark.reserved_for),
        }
      : null,
    price: offer.price,
    actions: offer.actions,
    tickets: offer.tickets,
    retryAt: offer.retryAt,
    canBuy: !offer.blocked,
    blocked: offer.blocked,
  };
  return { json, ongoing: offer.ongoing };
}

const SAFARI_ACTIONS = new Set(["BALL", "BAIT", "FLEE"]);

// La boîte PC telle que le site la dessine : ses boîtes, et la place de chacun
// des Pokémon du dresseur.
async function pcJson(userId) {
  const pc = await promise((cb) => getPc(userId, cb));
  return {
    slotsPerBox: pc.config.slotsPerBox,
    columns: pc.config.columns,
    maxBoxes: pc.config.maxBoxes,
    boxNameLength: pc.config.boxNameLength,
    nicknameLength: pc.config.nicknameLength,
    boxes: pc.boxes,
    pokemon: pc.layout.map(({ row, pos }) => ({ ...individualJson(row), pos })),
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
      const [wallet, egg] = await Promise.all([
        walletJson(ctx.user.id),
        promise((cb) => getIncubatingEgg(ctx.user.id, cb)),
      ]);
      return { user: ctx.user, ...wallet, egg: eggJson(egg) };
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
      balls: [...getBalls(), getSafariConfig().ball].map(({ key, label, emoji, sprite }) => ({
        key,
        label,
        emoji,
        image: itemImageUrl(sprite),
      })),
      types: typeColors(),
      items: getItems().map((item) => ({
        key: item.key,
        label: item.label,
        emoji: item.emoji,
        image: itemImageUrl(item.sprite),
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

  // La lignée d'une espèce avec ce qu'en possède le dresseur connecté : la
  // fiche d'un Pokémon de la boîte ou du Pokédex, comme sur l'onglet Capture.
  {
    method: "GET",
    path: "/api/me/lineage/:speciesId",
    auth: true,
    handler: async (ctx) => {
      const species = getAvailableSpecies(ctx.params.speciesId);
      if (!species) throw new HttpError(404, "Espèce inconnue.");
      return { lineage: await lineageJson(ctx.user.id, species) };
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
            image: itemImageUrl(item?.sprite),
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

  // Ce qu'une évolution coûterait, sans rien faire : l'écran d'évolution.
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
        sacrifices: plan.sacrifices,
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
      const [active, last, pausedUntil, drops, wallet] = await Promise.all([
        promise((cb) => getActiveSpawn((err, row) => cb(err, row ?? null))),
        promise((cb) => getLastEndedSpawn(cb)),
        promise((cb) => getSpawnPause(cb)),
        promise((cb) => getOpenDrops(cb)),
        walletJson(ctx.user.id),
      ]);
      return {
        refreshSeconds: Math.max(1, Number(getConfig().web?.spawnRefreshSeconds) || 5),
        cooldownSeconds: getPokemonConfig().capture.throwCooldownSeconds,
        pausedUntil: pausedUntil > Date.now() ? pausedUntil : null,
        wallet,
        safari: (await safariState(ctx)).json,
        spawn: active ? await spawnJson(ctx, active, wallet.balance) : null,
        last: last
          ? {
              id: last.id,
              speciesId: last.species_id,
              shiny: Boolean(last.is_shiny),
              sex: last.sex ?? null,
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
            image: itemImageUrl(item?.sprite),
            droppedAt: drop.dropped_at,
          };
        }),
      };
    },
  },

  // La visite en cours du dresseur, s'il en a une, et ce qu'il peut faire du
  // parc sinon.
  {
    method: "GET",
    path: "/api/safari",
    auth: true,
    handler: async (ctx) => {
      const { json, ongoing } = await safariState(ctx);
      return {
        offer: json,
        visit: ongoing ? await visitJson(ongoing.session, ongoing.owned) : null,
      };
    },
  },

  // La boîte PC : les boîtes du dresseur et la place de chacun de ses Pokémon.
  {
    method: "GET",
    path: "/api/me/pc",
    auth: true,
    handler: (ctx) => pcJson(ctx.user.id),
  },

  // ---------------------- Actions ----------------------

  // Entrer dans un parc ouvert, gratuitement : le bouton du message de parc.
  {
    method: "POST",
    path: "/api/safari/enter",
    auth: true,
    write: true,
    handler: async (ctx) => {
      const parkId = Number(ctx.body.parkId);
      if (!Number.isInteger(parkId) || parkId <= 0) throw new HttpError(400, "parkId invalide.");
      const result = await promise((cb) => enterPark(ctx.user.id, parkId, cb));
      if (!result.ok) throw new HttpError(409, result.reason);
      // Une reprise n'est pas une entrée : le compteur du parc n'a pas bougé.
      if (!result.resumed) refreshParkMessage(ctx.bot, parkId);
      return {
        resumed: Boolean(result.resumed),
        visit: await visitJson(result.session, result.owned),
      };
    },
  },

  // Acheter une entrée : /pk safari. Un Ticket Safari passe avant les points.
  {
    method: "POST",
    path: "/api/safari/buy",
    auth: true,
    write: true,
    handler: async (ctx) => {
      const result = await promise((cb) => startPaidSession(ctx.user.id, cb));
      if (!result.ok) {
        const rendu = result.refunded
          ? ` Tes **${result.refunded}** points t'ont été rendus.`
          : result.ticketRendu
            ? " Ton **Ticket Safari** t'a été rendu."
            : "";
        throw new HttpError(409, `${result.reason}${rendu}`);
      }
      return {
        resumed: Boolean(result.resumed),
        ticket: result.ticket?.label ?? null,
        visit: await visitJson(result.session, result.owned),
      };
    },
  },

  // Une action de la visite : lancer, appâter, fuir. Le jeton est le nombre
  // d'actions restantes, comme dans les boutons Discord.
  {
    method: "POST",
    path: "/api/safari/action",
    auth: true,
    write: true,
    handler: async (ctx) => {
      const sessionId = Number(ctx.body.sessionId);
      const token = Number(ctx.body.token);
      const action = String(ctx.body.action ?? "");
      if (!Number.isInteger(sessionId) || !Number.isInteger(token) || !SAFARI_ACTIONS.has(action)) {
        throw new HttpError(400, "Action invalide.");
      }
      const result = await promise((cb) =>
        playAction(ctx.user.id, sessionId, String(token), action, cb)
      );
      if (!result.ok) throw new HttpError(409, result.reason);
      return {
        outcome: result.outcome,
        message: safariOutcomeLine(result, getSafariConfig()),
        visit: await visitJson(result.session, result.owned),
      };
    },
  },

  // Ranger un Pokémon à une case de la boîte PC ; l'occupant prend sa place. La
  // réponse est la boîte PC relue : une boîte vide a pu s'ajouter au bout.
  {
    method: "POST",
    path: "/api/me/pc/move",
    auth: true,
    write: true,
    handler: async (ctx) => {
      const pokemonId = Number(ctx.body.pokemonId);
      const pos = Number(ctx.body.pos);
      if (!Number.isInteger(pokemonId) || !Number.isInteger(pos)) {
        throw new HttpError(400, "Déplacement invalide.");
      }
      const result = await promise((cb) => movePokemon(ctx.user.id, pokemonId, pos, cb));
      if (!result.ok) throw new HttpError(409, result.reason);
      return pcJson(ctx.user.id);
    },
  },

  // Nommer une boîte ; un nom vide lui rend son nom par défaut.
  {
    method: "POST",
    path: "/api/me/pc/boxes/:box/name",
    auth: true,
    write: true,
    handler: async (ctx) => {
      const result = await promise((cb) =>
        renameBox(ctx.user.id, Number(ctx.params.box), ctx.body.name, cb)
      );
      if (!result.ok) throw new HttpError(409, result.reason);
      return { name: result.name, custom: result.custom };
    },
  },

  // Verrouiller ou déverrouiller un Pokémon, comme /pk verrou : par le même
  // chemin, gardé par le propriétaire. Verrouillé, il ne part jamais.
  {
    method: "POST",
    path: "/api/me/pokemon/:pokemonId/lock",
    auth: true,
    write: true,
    handler: async (ctx) => {
      if (typeof ctx.body.locked !== "boolean") {
        throw new HttpError(400, "locked : true ou false.");
      }
      const pokemonId = Number(ctx.params.pokemonId);
      if (!Number.isInteger(pokemonId) || pokemonId <= 0) {
        throw new HttpError(400, "pokemonId invalide.");
      }
      const changed = await promise((cb) => setLock(ctx.user.id, pokemonId, ctx.body.locked, cb));
      if (!changed) throw new HttpError(404, `Le Pokémon #${pokemonId} n'est pas dans ta boîte.`);
      return { id: pokemonId, locked: ctx.body.locked };
    },
  },

  // Donner un surnom à un Pokémon ; vide, il le perd.
  {
    method: "POST",
    path: "/api/me/pokemon/:pokemonId/nickname",
    auth: true,
    write: true,
    handler: async (ctx) => {
      const result = await promise((cb) =>
        renamePokemon(ctx.user.id, Number(ctx.params.pokemonId), ctx.body.nickname, cb)
      );
      if (!result.ok) throw new HttpError(409, result.reason);
      return { nickname: result.nickname };
    },
  },

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
      const { key, label, emoji, sprite } = claimed.item;
      return { item: { key, label, emoji, image: itemImageUrl(sprite) } };
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
      // Avec un individu, `speciesId` est l'espèce attendue, comme dans les
      // boutons Discord : un second envoi sur un Pokémon qui vient d'évoluer
      // est refusé au lieu de le faire évoluer une seconde fois.
      const expected = Number(ctx.body.speciesId);
      // Un Pokémon verrouillé évolue quand même, mais seulement si le site a
      // demandé confirmation : sans `confirmLocked`, evolve refuse (409).
      const confirmLocked = ctx.body.confirmLocked === true;
      const group =
        selector.pokemonId && getSpecies(expected)
          ? { pokemonId: selector.pokemonId, speciesId: expected, confirmLocked }
          : { ...selector, confirmLocked };
      const result = await promise((cb) => evolve(ctx.user.id, group, targetId, helper, cb));
      return outcome(result, ({ target, plan, spent, evolved, isShiny }) => ({
        pokemon: { id: evolved.id, speciesId: target.id, sex: evolved.sex, shiny: isShiny },
        // Les Métamorph qui ont comblé les sacrifices sont comptés à part : ce
        // ne sont pas des exemplaires de l'espèce.
        sacrificesSpent: spent.sacrifices,
        dittosSpent: spent.dittos,
        shiniesSacrificed: spent.shinies,
        pointsSpent: plan.points,
        helper: plan.helper ? plan.helper.item.key : spent.dittos ? DITTO_HELPER : null,
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

  // ---------------------- Administration ----------------------

  // La configuration du bot en arbre, pour SYDNEC_USER_ID seulement (garde
  // `admin` de server.js). `status` signale une surcharge illisible, comme
  // /admin config-voir.
  {
    method: "GET",
    path: "/api/admin/config",
    auth: true,
    admin: true,
    handler: async () => ({ status: configOverrideStatus(), tree: configTree() }),
  },

  // Modifier un réglage : writeConfigValue, comme /admin config, avec les mêmes
  // refus. `value` est la saisie brute (une liste : séparée par des virgules).
  {
    method: "POST",
    path: "/api/admin/config",
    auth: true,
    write: true,
    admin: true,
    handler: async (ctx) => {
      const { path, value } = ctx.body;
      if (typeof path !== "string" || !["string", "number", "boolean"].includes(typeof value)) {
        throw new HttpError(400, "Réglage invalide.");
      }
      // /admin config exige une valeur ; vide, un nombre deviendrait 0.
      if (String(value).trim() === "") throw new HttpError(400, "Valeur vide.");
      const result = writeConfigValue(path, value);
      if (!result.ok) {
        // Une écriture qui bute sur une surcharge illisible en nomme la cause.
        const statut = configOverrideStatus();
        throw new HttpError(409, statut.ok ? result.reason : `${result.reason}\n${statut.reason}`);
      }
      log(
        `Web : config par ${ctx.user.username} : ${result.path} ` +
          `${JSON.stringify(result.before)} → ${JSON.stringify(result.after)}`
      );
      return { path: result.path, before: result.before, after: result.after };
    },
  },
];
