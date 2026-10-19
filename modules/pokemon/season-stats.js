// Les statistiques d'une saison, lues dans la base et nulle part ailleurs.
//
// Une saison court d'une ouverture de génération à la suivante : la saison N couvre
// [début, fin[, où la fin est l'instant d'ouverture de la génération N+1. La borne de fin est
// EXCLUE : l'instant d'ouverture appartient à la saison qui commence, et aucun événement n'est
// compté deux fois d'une saison à l'autre. La saison 1 commence à 0, le début des données.
//
// Le bilan se calcule quand la génération N+1 est déjà ouverte, mais il parle de la génération N :
// le Pokédex, les apparitions possibles et les tables d'objets sont ceux de N (d'où les
// paramètres de génération de allSpecies, fishingRarity et itemDropWeightIn). Sans cela, une
// espèce de la génération suivante gonflerait le Pokédex des champions et la liste des timides.
//
// Règle de ce module : une lecture qui échoue ne fait jamais un « 0 » qui ment. Chaque section se
// calcule à part, et l'échec de l'une est journalisé et la laisse vide (null) sans emporter les
// autres ; le message, lui, omet ce qui est vide.
import db from "../points-db.js";
import { handleException } from "../utils.js";
import { getPokemonConfig, getSeasonRecapConfig } from "./config.js";
import {
  allSpecies,
  allSpeciesData,
  fishingRarity,
  getSpecies,
  isLegendary,
  itemOnlySpecies,
  spawnWeight,
} from "./data.js";
import { getItems, itemDropWeightIn, itemLotteryWeightIn } from "./items.js";

// Version du format du payload enregistré : le jour où il change, un bilan relu saura quoi lire.
export const PAYLOAD_VERSION = 1;

// ====================== BASE ======================

export const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows ?? [])))
  );
export const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row ?? null)))
  );
// Rend `this.changes` : c'est lui qui dit si une écriture gardée a eu lieu.
export const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this.changes);
    })
  );

// La condition « dans la saison », à placer dans un WHERE avec `window` pour paramètres.
const inWindow = (column) => `${column} >= ? AND ${column} < ?`;

// ====================== FENÊTRE ======================

// L'instant où la génération s'est ouverte, ou null si on ne le sait pas encore. C'est la date
// programmée (`generationOpenings`), à défaut l'instant de l'annonce (pokemon_generations) : un
// administrateur peut ouvrir la génération avant l'heure avec `generation`, et la date, encore à
// venir, n'a alors rien ouvert. On retient donc la plus ancienne des deux qui soit déjà passée —
// la date quand l'ouverture s'est faite à l'heure dite, même annoncée tard par un bot éteint ; et
// l'annonce quand la date est à venir, retirée ou illisible.
export async function openingOf(generation, now = Date.now()) {
  if (generation <= 1) return 0;
  const candidates = [];
  const date = Date.parse(getPokemonConfig().generationOpenings?.[generation]);
  if (Number.isFinite(date) && date <= now) candidates.push(date);
  const announced = await dbGet("SELECT announced_at FROM pokemon_generations WHERE generation = ?", [
    generation,
  ]);
  if (announced) candidates.push(announced.announced_at);
  return candidates.length ? Math.min(...candidates) : null;
}

// Les bornes de la saison `season` une fois close, ou null tant que l'ouverture de la suivante
// (ou son propre début) n'est pas connue.
export async function seasonWindow(season, now = Date.now()) {
  const [start, end] = await Promise.all([openingOf(season, now), openingOf(season + 1, now)]);
  return start === null || end === null ? null : { start, end };
}

// ====================== OUTILS DE CLASSEMENT ======================

// Une égalité ne dépend jamais de l'ordre dans lequel SQLite rend les lignes : à score égal,
// l'identifiant tranche, donc deux calculs du même bilan donnent le même message.
const byUser = (a, b) => String(a.user).localeCompare(String(b.user));

// ====================== SECTIONS : LES POKÉMON ======================

// Une touche de pêche dont l'échéance est passée s'est enfuie, même si sa ligne dit encore FISHING :
// elle ne se ferme qu'au lancer suivant du pêcheur (closeExpired), et un pêcheur qui ne rejoue
// jamais la laisse ouverte. À la fin de la saison, une touche échue est donc une fuite — une touche
// encore dans ses délais, non. Prend `end` en premier paramètre du SQL qui l'emploie.
const FLED_SQL = "(status = 'FLED' OR (status = 'FISHING' AND flees_at <= ?))";

// Les apparitions de la fenêtre, par espèce, avec leurs fuites. Une seule lecture alimente
// le nombre d'apparitions, les plus apparus, les plus timides et les plus boudés.
// Une touche de pêche est une apparition comme les autres.
const spawnsBySpecies = ({ window, end }) =>
  dbAll(
    `SELECT species_id, COUNT(*) AS seen,
            SUM(CASE WHEN ${FLED_SQL} THEN 1 ELSE 0 END) AS fled
       FROM pokemon_spawns WHERE ${inWindow("spawned_at")}
      GROUP BY species_id`,
    [end, ...window]
  );

// Les captures de la fenêtre : celles du salon (date de capture) et celles du parc safari.
const capturesBySpecies = ({ window }) =>
  dbAll(
    `SELECT species_id, is_shiny, COUNT(*) AS n FROM (
       SELECT species_id, is_shiny FROM pokemon_spawns
        WHERE status = 'CAUGHT' AND ${inWindow("caught_at")}
       UNION ALL
       SELECT species_id, is_shiny FROM pokemon_safari_catches WHERE ${inWindow("caught_at")}
     ) GROUP BY species_id, is_shiny`,
    [...window, ...window]
  );

// Qui a attrapé quel légendaire. Le parc n'a pas de colonne dresseur : c'est sa visite qui le sait.
function legendaryCatches({ window }) {
  const ids = allSpeciesData().filter(isLegendary).map((species) => species.id);
  if (!ids.length) return [];
  return dbAll(
    `SELECT species_id, is_shiny, user_id FROM (
       SELECT species_id, is_shiny, caught_by AS user_id, caught_at FROM pokemon_spawns
        WHERE status = 'CAUGHT' AND ${inWindow("caught_at")}
       UNION ALL
       SELECT c.species_id, c.is_shiny, s.user_id, c.caught_at
         FROM pokemon_safari_catches c
         LEFT JOIN pokemon_safari_sessions s ON s.id = c.session_id
        WHERE ${inWindow("c.caught_at")}
     ) WHERE species_id IN (${ids.map(() => "?").join(", ")})
      ORDER BY caught_at, species_id`,
    [...window, ...window, ...ids]
  );
}

// Lancers payants et ce qu'ils ont coûté : un lancer remboursé (VOID) n'a pas eu lieu.
const throwTotals = ({ window }) =>
  dbGet(
    `SELECT COUNT(*) AS n, COALESCE(SUM(cost), 0) AS cost FROM pokemon_throws
      WHERE result != 'VOID' AND ${inWindow("thrown_at")}`,
    window
  );

// Le parc safari : ses balls n'ont pas de date à elles, elles comptent dans la saison où la
// visite a commencé. L'entrée est la seule chose qu'on y paie.
const safariTotals = ({ window }) =>
  dbGet(
    `SELECT COALESCE(SUM(balls_thrown), 0) AS balls, COALESCE(SUM(entry_cost), 0) AS cost
       FROM pokemon_safari_sessions WHERE ${inWindow("started_at")}`,
    window
  );

// La capture la moins probable : le lancer gagnant dont la probabilité était la plus basse.
async function luckiestCatch({ window }) {
  const row = await dbGet(
    `SELECT t.user_id, t.probability, s.species_id
       FROM pokemon_throws t JOIN pokemon_spawns s ON s.id = t.spawn_id
      WHERE t.result = 'CATCH' AND t.probability IS NOT NULL AND ${inWindow("t.thrown_at")}
      ORDER BY t.probability ASC, t.thrown_at ASC, t.id ASC LIMIT 1`,
    window
  );
  return row
    ? { user: row.user_id, species: row.species_id, probability: row.probability }
    : null;
}

// La série de ratés la plus improbable : pour chaque (dresseur, apparition), la probabilité d'avoir raté
// tous ses lancers est le produit des (1 − p). Le plus petit produit gagne ; il se lit « 1
// chance sur X ». Un lancer sans probabilité (NULL) ne dit rien et est ignoré. Le calcul se fait
// ici plutôt qu'en SQL : un produit n'est pas un agrégat que SQLite sait faire sans extension.
async function unluckiestStreak({ window }) {
  const rows = await dbAll(
    `SELECT user_id, spawn_id, probability FROM pokemon_throws
      WHERE result = 'MISS' AND probability IS NOT NULL AND ${inWindow("thrown_at")}`,
    window
  );
  const streaks = new Map();
  for (const row of rows) {
    const key = `${row.user_id}|${row.spawn_id}`;
    const streak = streaks.get(key) ?? { user: row.user_id, spawn: row.spawn_id, misses: 0, chance: 1 };
    streak.misses += 1;
    streak.chance *= 1 - row.probability;
    streaks.set(key, streak);
  }
  let worst = null;
  for (const streak of streaks.values()) {
    // Une chance nulle (un raté à 100 %) n'a pas de « 1 sur X » : on ne la présente pas.
    if (!(streak.chance > 0)) continue;
    if (
      !worst ||
      streak.chance < worst.chance ||
      (streak.chance === worst.chance && streak.misses > worst.misses)
    ) {
      worst = streak;
    }
  }
  if (!worst) return null;
  const spawn = await dbGet("SELECT species_id FROM pokemon_spawns WHERE id = ?", [worst.spawn]);
  if (!spawn) return null;
  return { user: worst.user, species: spawn.species_id, misses: worst.misses, chance: worst.chance };
}

// L'apparition qui a encaissé le plus de lancers, et comment elle a fini.
async function longestFight({ window, end }) {
  const top = await dbGet(
    `SELECT spawn_id, COUNT(*) AS throws FROM pokemon_throws
      WHERE result != 'VOID' AND ${inWindow("thrown_at")}
      GROUP BY spawn_id ORDER BY throws DESC, spawn_id ASC LIMIT 1`,
    window
  );
  if (!top) return null;
  const spawn = await dbGet(
    `SELECT species_id, CASE WHEN ${FLED_SQL} THEN 'FLED' ELSE status END AS status
       FROM pokemon_spawns WHERE id = ?`,
    [end, top.spawn_id]
  );
  return spawn ? { species: spawn.species_id, throws: top.throws, status: spawn.status } : null;
}

const mostSold = async ({ window, config }) => {
  const rows = await dbAll(
    `SELECT species_id, SUM(quantity) AS n FROM pokemon_sales WHERE ${inWindow("sold_at")}
      GROUP BY species_id ORDER BY n DESC, species_id ASC LIMIT ?`,
    [...window, config.topSize]
  );
  return rows.map((row) => ({ species: row.species_id, count: row.n }));
};

const evolutionCount = async ({ window }) =>
  (await dbGet(`SELECT COUNT(*) AS n FROM pokemon_fusions WHERE ${inWindow("created_at")}`, window)).n;

// Les points dépensés, source par source. Les lancers et le parc viennent de lectures que le
// bilan partage avec d'autres sections ; si l'une a échoué, le total serait faux, et la
// section entière est omise.
async function spending({ window }, throws, safari) {
  if (!throws || !safari) return null;
  const [fusions, fishing, shop] = await Promise.all([
    dbGet(
      `SELECT COALESCE(SUM(points_spent), 0) AS n FROM pokemon_fusions WHERE ${inWindow("created_at")}`,
      window
    ),
    // `cast_cost` : le prix de la canne, gardé sur la touche (NULL avant ce suivi).
    dbGet(
      `SELECT COALESCE(SUM(cast_cost), 0) AS n FROM pokemon_spawns
        WHERE fished = 1 AND ${inWindow("spawned_at")}`,
      window
    ),
    dbGet(
      `SELECT COALESCE(SUM(cost), 0) AS n FROM pokemon_shop_purchases WHERE ${inWindow("bought_at")}`,
      window
    ),
  ]);
  const parts = {
    throws: throws.cost,
    fusions: fusions.n,
    safari: safari.cost,
    fishing: fishing.n,
    shop: shop.n,
  };
  return { total: Object.values(parts).reduce((sum, value) => sum + value, 0), parts };
}

const favoriteBall = ({ window }) =>
  dbGet(
    `SELECT ball, COUNT(*) AS n FROM pokemon_throws
      WHERE result != 'VOID' AND ${inWindow("thrown_at")}
      GROUP BY ball ORDER BY n DESC, ball ASC LIMIT 1`,
    window
  );

// ====================== SECTIONS : LES DRESSEURS ======================

// La date à laquelle chaque dresseur a obtenu chaque espèce, par le plus ancien de ses
// ÉVÈNEMENTS d'acquisition : capture, capture au parc, éclosion, starter, échange reçu, évolution
// vers cette espèce. La date de la ligne de pokemon_owned ne dit pas cela : une évolution réinsère
// la ligne avec son ancien `obtained_at` (restoreDuplicates), si bien que Florizarre daterait de la
// capture de Bulbizarre — et qu'une évolution faite après la fin de la saison compterait comme
// acquise avant elle.
const acquisitionDates = () =>
  dbAll(
    `SELECT user_id, species_id, MIN(at) AS first_at FROM (
       SELECT caught_by AS user_id, species_id, caught_at AS at FROM pokemon_spawns
        WHERE status = 'CAUGHT' AND caught_by IS NOT NULL
       UNION ALL
       SELECT s.user_id, c.species_id, c.caught_at FROM pokemon_safari_catches c
         JOIN pokemon_safari_sessions s ON s.id = c.session_id
       UNION ALL
       SELECT user_id, species_id, hatched_at FROM pokemon_eggs WHERE status = 'HATCHED'
       UNION ALL
       SELECT user_id, species_id, chosen_at FROM pokemon_starters
       UNION ALL
       SELECT to_user_id, offer_species_id, resolved_at FROM pokemon_trades
        WHERE status = 'ACCEPTED' AND offer_species_id > 0
       UNION ALL
       SELECT from_user_id, request_species_id, resolved_at FROM pokemon_trades
        WHERE status = 'ACCEPTED' AND request_species_id > 0
       UNION ALL
       SELECT user_id, to_species_id, created_at FROM pokemon_fusions
     ) WHERE at IS NOT NULL GROUP BY user_id, species_id`
  );

// Les champions : qui possède le plus d'espèces du Pokédex de la saison à la fin, légendaires
// exclus (on ne les chasse pas, comme pour le Charme Chroma). Ce qui se possède se lit dans
// pokemon_owned, daté par acquisitionDates ; sans évènement (un don d'administrateur, un palier
// de starter), c'est la date de la ligne qui fait foi. À nombre égal, le plus rapide gagne :
// l'instant où il a atteint ce nombre est celui de sa dernière espèce acquise, c'est-à-dire le
// plus grand des « premier exemplaire » de ses espèces.
async function champions({ season, end, config }) {
  const dex = new Set(
    allSpecies(season)
      .filter((species) => !isLegendary(species))
      .map((species) => species.id)
  );
  const [held, events] = await Promise.all([
    dbAll(
      `SELECT user_id, species_id, MIN(obtained_at) AS first_at FROM pokemon_owned
        GROUP BY user_id, species_id`
    ),
    acquisitionDates(),
  ]);
  const dated = new Map(events.map((row) => [`${row.user_id}|${row.species_id}`, row.first_at]));
  const players = new Map();
  for (const row of held) {
    if (!dex.has(row.species_id)) continue;
    // Une espèce acquise à la fin de la saison, ou après, est celle de la suivante.
    const acquiredAt = dated.get(`${row.user_id}|${row.species_id}`) ?? row.first_at;
    if (!(acquiredAt < end)) continue;
    const player = players.get(row.user_id) ?? { user: row.user_id, owned: 0, reachedAt: 0 };
    player.owned += 1;
    player.reachedAt = Math.max(player.reachedAt, acquiredAt);
    players.set(row.user_id, player);
  }
  const entries = [...players.values()]
    .sort((a, b) => b.owned - a.owned || a.reachedAt - b.reachedAt || byUser(a, b))
    .slice(0, config.podiumSize);
  return entries.length ? { total: dex.size, entries } : null;
}

// La chance à la capture : les captures réelles face à celles qu'annonçaient les probabilités
// (leur somme). Au-delà de 1, on a eu de la chance ; en deçà, de la malchance. Il faut assez de
// lancers pour que le rapport veuille dire quelque chose, et une somme non nulle pour le calculer.
//
// Les plus chanceux sont ceux qui sont au-dessus de 1, les moins chanceux ceux qui sont en dessous :
// un « plus chanceux » à ×0,80 ou un « moins chanceux » à ×1,20 n'aurait aucun sens, et c'est ce
// qui garantit que les deux podiums n'ont jamais un dresseur en commun. Pas de partage en deux
// moitiés quand ils sont peu nombreux : un podium qui n'a personne à montrer est omis.
async function captureLuck({ window, config }) {
  const rows = await dbAll(
    `SELECT user_id, COUNT(*) AS throws,
            SUM(CASE WHEN result = 'CATCH' THEN 1 ELSE 0 END) AS catches,
            SUM(probability) AS expected
       FROM pokemon_throws
      WHERE result != 'VOID' AND probability IS NOT NULL AND ${inWindow("thrown_at")}
      GROUP BY user_id HAVING COUNT(*) >= ? AND SUM(probability) > 0`,
    [...window, config.minThrowsForLuck]
  );
  const players = rows.map((row) => ({
    user: row.user_id,
    throws: row.throws,
    catches: row.catches,
    expected: row.expected,
    ratio: row.catches / row.expected,
  }));
  // À rapport égal, celui qui a le plus lancé : son rapport pèse plus.
  const ranked = (kept, order) =>
    players
      .filter(kept)
      .sort((a, b) => order * (a.ratio - b.ratio) || b.throws - a.throws || byUser(a, b))
      .slice(0, config.podiumSize);
  return {
    lucky: ranked((player) => player.ratio > 1, -1),
    unlucky: ranked((player) => player.ratio < 1, 1),
  };
}

// La chance aux objets. Un objet obtenu vaut sa rareté N = (poids total de sa table) / (son
// poids) : un objet qui sort une fois sur N. Le score d'un dresseur est la somme des N de ce
// qu'il a obtenu. Compte tout ce qui est entré dans le sac par un Pokémon (capture), par terre
// (sol) ou par la loterie — y compris l'exemplaire vendu d'office au-delà du plafond
// (`vente-auto:`), qui a bien été obtenu. Ce que les échanges, la boutique ou un administrateur
// donnent ne dit rien de la chance : ces sources n'y sont pas.
//
// Les poids sont ceux du catalogue actuel, mais lus pour la génération de la saison : un objet
// que la génération suivante vient d'ouvrir n'a pas pu tomber, et n'entre pas dans le total.
async function itemLuck({ season, window, config }) {
  const items = getItems();
  const weights = {
    drop: new Map(items.map((item) => [item.key, itemDropWeightIn(item, season)])),
    lottery: new Map(items.map((item) => [item.key, itemLotteryWeightIn(item, season)])),
  };
  const totals = Object.fromEntries(
    Object.entries(weights).map(([pool, byKey]) => [pool, [...byKey.values()].reduce((a, b) => a + b, 0)])
  );
  // Une ligne de journal à delta nul est la trace d'un exemplaire vendu d'office : un objet.
  const rows = await dbAll(
    `SELECT user_id, item_key,
            CASE WHEN source IN ('loterie', 'vente-auto:loterie') THEN 'lottery' ELSE 'drop' END AS pool,
            SUM(CASE WHEN delta > 0 THEN delta ELSE 1 END) AS quantity
       FROM pokemon_item_log
      WHERE ${inWindow("created_at")}
        AND ((delta > 0 AND (source LIKE 'capture:%' OR source LIKE 'sol:%' OR source = 'loterie'))
          OR (delta = 0 AND (source LIKE 'vente-auto:capture:%' OR source LIKE 'vente-auto:sol:%'
                          OR source = 'vente-auto:loterie')))
      GROUP BY user_id, item_key, pool`,
    window
  );
  const players = new Map();
  for (const row of rows) {
    const weight = weights[row.pool].get(row.item_key) ?? 0;
    // Hors de la table de la saison (retiré du catalogue, ou d'une génération fermée) : pas de rareté.
    if (!(weight > 0)) continue;
    const rarity = totals[row.pool] / weight;
    const player = players.get(row.user_id) ?? { user: row.user_id, items: 0, score: 0, rarest: null };
    player.items += row.quantity;
    player.score += row.quantity * rarity;
    if (!player.rarest || rarity > player.rarest.rarity) {
      player.rarest = { item: row.item_key, rarity };
    }
    players.set(row.user_id, player);
  }
  const entries = [...players.values()]
    .sort((a, b) => b.score - a.score || b.items - a.items || byUser(a, b))
    .slice(0, config.podiumSize);
  return entries.length ? entries : null;
}

// Les moins chanceux à la loterie : ceux dont le taux de victoires est le plus bas, et sous celui de
// la saison entière — « moins chanceux que les autres » —, avec au moins `minLotteryDraws` tirages.
// Celui qui n'a jamais perdu n'y est donc jamais : son taux, 100 %, ne peut pas être sous la
// moyenne. Si personne ne remplit ces conditions, la section n'existe pas.
//
// La saison 1 lit les compteurs cumulés de pokemon_lottery — tout l'historique d'avant le journal
// est la saison 1 ; les suivantes lisent le journal daté des tirages (pokemon_lottery_draws). Les
// compteurs courent encore après la fin de la saison 1 : un bilan publié en retard, ou l'aperçu,
// y retire les tirages du journal datés de la fin ou d'après (qui, eux, n'existent que depuis le
// journal, donc après l'historique), avec leurs victoires.
async function lotteryLosers({ season, end, window, config }) {
  const rows =
    season === 1
      ? await dbAll(
          `SELECT l.user_id,
                  MAX(0, l.draws - COALESCE(late.draws, 0)) AS draws,
                  MAX(0, l.wins - COALESCE(late.wins, 0)) AS wins
             FROM pokemon_lottery l
             LEFT JOIN (SELECT user_id, COUNT(*) AS draws, SUM(won) AS wins
                          FROM pokemon_lottery_draws WHERE drawn_at >= ? GROUP BY user_id) late
               ON late.user_id = l.user_id`,
          [end]
        )
      : await dbAll(
          `SELECT user_id, SUM(won) AS wins, COUNT(*) AS draws FROM pokemon_lottery_draws
            WHERE ${inWindow("drawn_at")} GROUP BY user_id`,
          window
        );
  const totalDraws = rows.reduce((sum, row) => sum + row.draws, 0);
  if (!totalDraws) return null;
  const seasonRate = rows.reduce((sum, row) => sum + row.wins, 0) / totalDraws;
  const entries = rows
    .filter(
      (row) =>
        row.draws >= config.minLotteryDraws && row.wins < row.draws && row.wins / row.draws < seasonRate
    )
    .map((row) => ({ user: row.user_id, wins: row.wins, draws: row.draws }))
    .sort((a, b) => a.wins / a.draws - b.wins / b.draws || b.draws - a.draws || byUser(a, b))
    .slice(0, config.podiumSize);
  return entries.length ? entries : null;
}

// Un podium par nombre de lignes : `sql` rend (user_id, n[, extra]) du plus grand au plus petit.
const podium = async (sql, params, config, extra = []) => {
  const rows = await dbAll(sql, [...params, config.podiumSize]);
  return rows.length
    ? rows.map((row) => ({ user: row.user_id, count: row.n, ...Object.fromEntries(extra.map((key) => [key, row[key]])) }))
    : null;
};

const cleaners = ({ window, config }) =>
  podium(
    `SELECT claimed_by AS user_id, COUNT(*) AS n FROM pokemon_drops
      WHERE status = 'CLAIMED' AND claimed_by IS NOT NULL AND ${inWindow("claimed_at")}
      GROUP BY claimed_by ORDER BY n DESC, claimed_by ASC LIMIT ?`,
    window,
    config
  );

const safariVisitors = ({ window, config }) =>
  podium(
    `SELECT user_id, COUNT(*) AS n, COALESCE(SUM(catches), 0) AS catches FROM pokemon_safari_sessions
      WHERE ${inWindow("started_at")}
      GROUP BY user_id ORDER BY n DESC, catches DESC, user_id ASC LIMIT ?`,
    window,
    config,
    ["catches"]
  );

const fishers = ({ window, config }) =>
  podium(
    `SELECT caught_by AS user_id, COUNT(*) AS n FROM pokemon_spawns
      WHERE fished = 1 AND status = 'CAUGHT' AND caught_by IS NOT NULL AND ${inWindow("caught_at")}
      GROUP BY caught_by ORDER BY n DESC, caught_by ASC LIMIT ?`,
    window,
    config
  );

// Un échange conclu compte pour chacun de ses deux dresseurs.
const traders = ({ window, config }) =>
  podium(
    `SELECT user_id, COUNT(*) AS n FROM (
       SELECT from_user_id AS user_id FROM pokemon_trades
        WHERE status = 'ACCEPTED' AND ${inWindow("resolved_at")}
       UNION ALL
       SELECT to_user_id AS user_id FROM pokemon_trades
        WHERE status = 'ACCEPTED' AND ${inWindow("resolved_at")}
     ) GROUP BY user_id ORDER BY n DESC, user_id ASC LIMIT ?`,
    [...window, ...window],
    config
  );

// ====================== LE BILAN ======================

// Calcule le bilan de la saison `season` sur [start, end[. Rien n'est écrit : le résultat est
// un objet JSON (identifiants, nombres), que la publication enregistre et que season.js met en
// forme. Une section sans donnée vaut null (ou une liste vide), jamais un zéro.
//
// Une section qui échoue se journalise et reste vide : mieux vaut l'omettre qu'afficher un 0 qui
// ment. Mais elle est aussi consignée dans `failures` : la publication ne doit ni poster un bilan
// amputé, ni classer « rien à raconter » une saison dont on n'a simplement pas pu lire les chiffres.
export async function computeSeasonStats(season, { start, end }) {
  const config = getSeasonRecapConfig();
  const ctx = { season, start, end, window: [start, end], config };
  const failures = [];
  const attempt = async (label, work) => {
    try {
      return await work();
    } catch (error) {
      failures.push(label);
      handleException(`Bilan de saison, ${label} :`, error);
      return null;
    }
  };

  // Lectures partagées entre plusieurs sections.
  const [spawns, captures, throws, safari] = await Promise.all([
    attempt("apparitions", () => spawnsBySpecies(ctx)),
    attempt("captures", () => capturesBySpecies(ctx)),
    attempt("lancers", () => throwTotals(ctx)),
    attempt("parc safari", () => safariTotals(ctx)),
  ]);

  // Une liste d'espèces : les `topSize` premières selon `compare`, l'identifiant tranchant les égalités.
  const topSpecies = (entries, compare) =>
    entries
      .sort((a, b) => compare(a, b) || a.species - b.species)
      .slice(0, config.topSize);

  const mostSeen = spawns
    ? topSpecies(
        spawns.map((row) => ({ species: row.species_id, count: row.seen })),
        (a, b) => b.count - a.count
      )
    : null;

  // Les apparitions possibles cette saison-là : le poids d'apparition est celui de la génération
  // de la saison (pêche comprise), et un légendaire n'est jamais « timide ». Un compte de 0 est
  // permis : c'est justement une espèce qui n'est pas venue.
  const spawnConfig = getPokemonConfig().spawn;
  const itemOnly = itemOnlySpecies();
  const rarity = fishingRarity(season);
  // Sans une seule apparition dans la saison, « les moins apparus » ne désignerait personne : une
  // liste de zéros pour toutes les espèces, qui n'apprend rien.
  const seen = new Map((spawns ?? []).map((row) => [row.species_id, row.seen]));
  const shyest = spawns?.length
    ? topSpecies(
        allSpecies(season)
          .filter(
            (species) =>
              !isLegendary(species) && spawnWeight(species, spawnConfig, itemOnly, rarity) > 0
          )
          .map((species) => ({ species: species.id, count: seen.get(species.id) ?? 0 })),
        (a, b) => a.count - b.count
      )
    : null;

  // Le taux de fuite = fuites / apparitions de la fenêtre. Une espèce vue trop peu de fois ne dit
  // rien, et un taux nul n'est pas un « boudé » : seules les espèces qui ont fui y figurent.
  const mostFled = spawns
    ? topSpecies(
        spawns
          .filter((row) => row.seen >= config.minSpawnsForFleeRate && row.fled > 0)
          .map((row) => ({ species: row.species_id, fled: row.fled, seen: row.seen })),
        (a, b) => b.fled / b.seen - a.fled / a.seen || b.seen - a.seen
      )
    : null;

  const caughtBySpecies = new Map();
  let shiny = 0;
  let legendary = 0;
  for (const row of captures ?? []) {
    caughtBySpecies.set(row.species_id, (caughtBySpecies.get(row.species_id) ?? 0) + row.n);
    if (row.is_shiny) shiny += row.n;
    const species = getSpecies(row.species_id);
    if (species && isLegendary(species)) legendary += row.n;
  }
  const mostCaught = captures
    ? topSpecies(
        [...caughtBySpecies].map(([species, count]) => ({ species, count })),
        (a, b) => b.count - a.count
      )
    : null;

  const [
    legendaries,
    sold,
    evolutions,
    spent,
    luckiest,
    unluckiest,
    longest,
    ball,
    championList,
    luck,
    itemList,
    lotteryList,
    cleanerList,
    safariList,
    fisherList,
    traderList,
  ] = await Promise.all([
    attempt("légendaires", () => legendaryCatches(ctx)),
    attempt("plus vendus", () => mostSold(ctx)),
    attempt("évolutions", () => evolutionCount(ctx)),
    attempt("points dépensés", () => spending(ctx, throws, safari)),
    attempt("capture la plus chanceuse", () => luckiestCatch(ctx)),
    attempt("malchance", () => unluckiestStreak(ctx)),
    attempt("plus longue résistance", () => longestFight(ctx)),
    attempt("ball préférée", () => favoriteBall(ctx)),
    attempt("champions", () => champions(ctx)),
    attempt("chance à la capture", () => captureLuck(ctx)),
    attempt("chance aux objets", () => itemLuck(ctx)),
    attempt("loterie", () => lotteryLosers(ctx)),
    attempt("nettoyeurs", () => cleaners(ctx)),
    attempt("visiteurs du safari", () => safariVisitors(ctx)),
    attempt("pêcheurs", () => fishers(ctx)),
    attempt("échangeurs", () => traders(ctx)),
  ]);

  return {
    version: PAYLOAD_VERSION,
    season,
    start,
    end,
    failures,
    pokemon: {
      spawns: spawns ? spawns.reduce((sum, row) => sum + row.seen, 0) : null,
      throws: throws && safari ? { total: throws.n + safari.balls, safari: safari.balls } : null,
      spending: spent,
      evolutions,
      mostSeen,
      shyest,
      mostCaught,
      mostFled,
      mostSold: sold,
      rare:
        captures && legendaries
          ? {
              shiny,
              legendary,
              legendaries: legendaries.map((row) => ({
                species: row.species_id,
                shiny: Boolean(row.is_shiny),
                user: row.user_id,
              })),
            }
          : null,
      luckiestCatch: luckiest,
      unluckiestStreak: unluckiest,
      longestFight: longest,
      favoriteBall: ball ? { ball: ball.ball, count: ball.n } : null,
    },
    trainers: {
      champions: championList,
      lucky: luck?.lucky.length ? luck.lucky : null,
      unlucky: luck?.unlucky.length ? luck.unlucky : null,
      itemLuck: itemList,
      lottery: lotteryList,
      cleaners: cleanerList,
      safari: safariList,
      fishers: fisherList,
      traders: traderList,
    },
  };
}
