// Le bilan de saison : la mise en forme des statistiques (season-stats.js) en deux embeds, et leur
// publication dans le salon des apparitions quand la génération suivante s'ouvre.
//
// Publier « exactement une fois » tient en trois choses, toutes en base (rien en mémoire, le
// bilan survit à un redémarrage) :
// - la revendication : un UPDATE gardé sur pokemon_season_recaps dont on inspecte this.changes,
//   donc deux passages du minuteur ne partent jamais ensemble ;
// - le bail : la revendication n'est pas définitive, elle expire. Un envoi interrompu par un arrêt
//   — ou raté, la ligne gardant alors l'heure de son essai — est retenté plus tard, après une
//   attente qui grandit à chaque échec, pour ne pas remplir le journal chaque minute ;
// - la clôture : `posted_at`, ou `skipped_at` pour une saison qu'on ne publie pas (trop ancienne,
//   ou sans rien à dire).
import { EmbedBuilder } from "discord.js";
import { handleException, log } from "../utils.js";
import { getBall, getPokemonConfig, getSeasonRecapConfig } from "./config.js";
import { activeGeneration, generationOrdinal, getSpecies } from "./data.js";
import { displayName } from "./embeds.js";
import { getItem } from "./items.js";
import { resolveChannel } from "./spawn.js";
import { computeSeasonStats, dbGet, dbRun, openingOf, seasonWindow } from "./season-stats.js";

// Les limites d'un message de Discord. Ce ne sont pas des réglages du jeu : la plateforme les
// impose, et un embed qui les dépasse est refusé en entier — le bilan ne partirait pas.
const LIMITS = { fields: 25, fieldName: 256, fieldValue: 1024, total: 6000 };

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

const fr = (value) => value.toLocaleString("fr-FR");
const plural = (n, one, many = `${one}s`) => `${fr(n)} ${n > 1 ? many : one}`;
const mention = (id) => (id ? `<@${id}>` : "un dresseur inconnu");
const medal = (index) => ["🥇", "🥈", "🥉"][index] ?? `${index + 1}.`;
const percent = (probability, digits) =>
  `${(probability * 100).toLocaleString("fr-FR", { maximumFractionDigits: digits })} %`;
// « 1 sur 2,2 » mais « 1 sur 346 » : une décimale tant que le nombre est petit, sinon l'entier.
const oneIn = (n) =>
  n < 10 ? n.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : fr(Math.round(n));

const speciesName = (id, isShiny = false) => {
  const species = getSpecies(id);
  return species ? displayName(species, isShiny) : `#${id}`;
};
const itemName = (key) => {
  const item = getItem(key);
  return item ? `${item.emoji} ${item.label}` : key;
};
const ballName = (key) => {
  const ball = getBall(key);
  return ball ? `${ball.emoji ?? ""} ${ball.label}`.trim() : key;
};

// ====================== MISE EN FORME ======================

// Une section : un titre et ses lignes, ou rien. Une liste vide, un nombre à zéro ou une
// lecture ratée n'ont rien à montrer, et un champ vide n'est pas un champ.
const section = (name, lines) => (lines?.length ? { name, lines } : null);

// Un classement d'espèces : « 1. **Roucool** — 45 apparitions ».
const speciesList = (entries, describe) =>
  entries?.map((entry, index) => `${index + 1}. **${speciesName(entry.species)}** — ${describe(entry)}`);

// Un podium de dresseurs : « 🥇 @x — … ».
const podium = (entries, describe) =>
  entries?.map((entry, index) => `${medal(index)} ${mention(entry.user)} — ${describe(entry)}`);

const OUTCOMES = {
  CAUGHT: "il a fini capturé",
  FLED: "il s'est enfui",
};

function pokemonSections(pokemon) {
  const spending = pokemon.spending;
  return [
    section(
      "Apparitions",
      pokemon.spawns > 0 && [
        `**${fr(pokemon.spawns)}** ${pokemon.spawns > 1 ? "Pokémon sont apparus" : "Pokémon est apparu"}, ` +
          "touches de pêche comprises.",
      ]
    ),
    section(
      "Lancers",
      pokemon.throws?.total > 0 && [
        `**${fr(pokemon.throws.total)}** ${pokemon.throws.total > 1 ? "lancers" : "lancer"}` +
          (pokemon.throws.safari > 0 ? ` (dont ${fr(pokemon.throws.safari)} au safari)` : ""),
      ]
    ),
    section(
      "Points dépensés",
      spending?.total > 0 && [
        `**${fr(spending.total)}** points`,
        ...[
          ["lancers", spending.parts.throws],
          ["évolutions", spending.parts.fusions],
          ["safari", spending.parts.safari],
          ["pêche", spending.parts.fishing],
          ["boutique", spending.parts.shop],
        ]
          // Seules les sources qui ont coûté quelque chose : « boutique : 0 » ne dit rien.
          .filter(([, amount]) => amount > 0)
          .map(([label, amount]) => `▫️ ${label} : ${fr(amount)}`),
      ]
    ),
    section(
      "Évolutions",
      pokemon.evolutions > 0 && [
        `**${fr(pokemon.evolutions)}** ${pokemon.evolutions > 1 ? "évolutions" : "évolution"}`,
      ]
    ),
    section(
      "Les plus apparus",
      speciesList(pokemon.mostSeen, (e) => plural(e.count, "apparition"))
    ),
    section(
      "Les plus timides",
      speciesList(pokemon.shyest, (e) => plural(e.count, "apparition"))
    ),
    section(
      "Les plus capturés",
      speciesList(pokemon.mostCaught, (e) => plural(e.count, "capture"))
    ),
    section(
      "Les plus boudés",
      speciesList(pokemon.mostFled, (e) => `${percent(e.fled / e.seen, 1)} (${e.fled}/${e.seen})`)
    ),
    section(
      "Les plus vendus",
      speciesList(pokemon.mostSold, (e) => plural(e.count, "vendu"))
    ),
    section(
      "Shiny et légendaires de la saison",
      pokemon.rare && [
        ...(pokemon.rare.shiny > 0
          ? [`✨ **${fr(pokemon.rare.shiny)}** ${pokemon.rare.shiny > 1 ? "shiny capturés" : "shiny capturé"}`]
          : []),
        ...(pokemon.rare.legendary > 0
          ? [
              `🟠 **${fr(pokemon.rare.legendary)}** ${pokemon.rare.legendary > 1 ? "légendaires capturés" : "légendaire capturé"}`,
            ]
          : []),
        ...pokemon.rare.legendaries.map(
          (entry) => `▫️ ${speciesName(entry.species, entry.shiny)} — ${mention(entry.user)}`
        ),
      ]
    ),
    section(
      "La capture la plus chanceuse",
      pokemon.luckiestCatch && [
        `${mention(pokemon.luckiestCatch.user)} a attrapé **${speciesName(pokemon.luckiestCatch.species)}** ` +
          `avec seulement ${percent(pokemon.luckiestCatch.probability, 2)} de chances.`,
      ]
    ),
    section(
      "La malchance de la saison",
      pokemon.unluckiestStreak && [
        `${mention(pokemon.unluckiestStreak.user)} a raté **${speciesName(pokemon.unluckiestStreak.species)}** ` +
          `${fr(pokemon.unluckiestStreak.misses)} fois : ` +
          `1 chance sur ${oneIn(1 / pokemon.unluckiestStreak.chance)}.`,
      ]
    ),
    section(
      "La plus longue résistance",
      pokemon.longestFight && [
        `**${speciesName(pokemon.longestFight.species)}** a encaissé ` +
          `${plural(pokemon.longestFight.throws, "lancer")} : ` +
          `${OUTCOMES[pokemon.longestFight.status] ?? "il est toujours là"}.`,
      ]
    ),
    section(
      "La ball préférée du serveur",
      pokemon.favoriteBall && [
        `${ballName(pokemon.favoriteBall.ball)} — ${plural(pokemon.favoriteBall.count, "lancer")}`,
      ]
    ),
  ].filter(Boolean);
}

const luckLine = (entry) =>
  `×${entry.ratio.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ` +
  `(${plural(entry.catches, "capture")} pour ` +
  `${entry.expected.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} ` +
  `${entry.expected >= 2 ? "attendues" : "attendue"})`;

function trainerSections(trainers) {
  return [
    section(
      "Les champions de la saison",
      podium(trainers.champions?.entries, (e) => `${e.owned}/${trainers.champions.total} espèces`)
    ),
    section("Les plus chanceux", podium(trainers.lucky, luckLine)),
    section("Les moins chanceux", podium(trainers.unlucky, luckLine)),
    section(
      "Les plus chanceux en objets",
      podium(
        trainers.itemLuck,
        (e) =>
          `${plural(e.items, "objet")}, score ${fr(Math.round(e.score))}` +
          (e.rarest ? ` · le plus rare : ${itemName(e.rarest.item)} (1 sur ${oneIn(e.rarest.rarity)})` : "")
      )
    ),
    section(
      "Les moins chanceux à la loterie",
      podium(trainers.lottery, (e) => `${e.wins}/${e.draws} tirages gagnés`)
    ),
    section(
      "Les meilleurs nettoyeurs",
      podium(trainers.cleaners, (e) => plural(e.count, "objet ramassé", "objets ramassés"))
    ),
    section(
      "Les plus gros visiteurs du safari",
      podium(trainers.safari, (e) => `${plural(e.count, "visite")}, ${plural(e.catches, "capture")}`)
    ),
    section(
      "Le meilleur pêcheur",
      podium(trainers.fishers, (e) => plural(e.count, "capture", "captures") + " à la pêche")
    ),
    section(
      "Le plus gros échangeur",
      podium(trainers.traders, (e) => plural(e.count, "échange"))
    ),
  ].filter(Boolean);
}

// Fait tenir les embeds dans ce que Discord accepte : 25 champs, 1 024 caractères par valeur et
// 6 000 pour l'ensemble des embeds du message. Un classement s'écourte par le bas, une ligne à la
// fois, en commençant par le champ le plus long — le haut d'un podium est ce qui compte —, et un
// champ garde toujours sa première ligne. Rien n'est coupé au milieu d'une ligne, sauf une ligne
// seule plus longue qu'un champ, ce que la mise en forme ne produit pas mais qu'un jour de
// données étranges pourrait.
function fitEmbeds(embeds) {
  const valueOf = (field) => field.lines.join("\n");
  const size = (embed) =>
    embed.title.length +
    (embed.description?.length ?? 0) +
    embed.fields.reduce((sum, field) => sum + field.name.length + valueOf(field).length, 0);
  const total = () => embeds.reduce((sum, embed) => sum + size(embed), 0);

  for (const embed of embeds) {
    embed.fields = embed.fields.slice(0, LIMITS.fields);
    for (const field of embed.fields) {
      field.name = field.name.slice(0, LIMITS.fieldName);
      while (field.lines.length > 1 && valueOf(field).length > LIMITS.fieldValue) field.lines.pop();
      if (valueOf(field).length > LIMITS.fieldValue) {
        field.lines = [`${valueOf(field).slice(0, LIMITS.fieldValue - 1)}…`];
      }
    }
  }

  while (total() > LIMITS.total) {
    const fields = embeds.flatMap((embed) => embed.fields);
    const longest = fields
      .filter((field) => field.lines.length > 1)
      .sort((a, b) => valueOf(b).length - valueOf(a).length)[0];
    if (longest) {
      longest.lines.pop();
      continue;
    }
    // Chaque champ est réduit à une ligne et c'est encore trop : le dernier champ de l'embed le
    // plus lourd s'en va. Ne se produit qu'avec un nombre de champs que ce bilan n'atteint pas.
    const heaviest = [...embeds].sort((a, b) => size(b) - size(a))[0];
    if (!heaviest.fields.length) break;
    heaviest.fields.pop();
  }
  return embeds;
}

const EMBEDS = [
  { key: "pokemon", title: "Les Pokémon", color: 0xf1c40f },
  { key: "trainers", title: "Les dresseurs", color: 0x3498db },
];

// Le message d'un bilan : { content, embeds }. Une section sans donnée n'y figure pas, et un embed
// sans section non plus ; sans aucun embed, il n'y a rien à publier. `preview` : l'aperçu de la
// saison en cours, dont la fin est « maintenant ».
export function buildSeasonMessage(stats, { preview = false } = {}) {
  const sections = {
    pokemon: pokemonSections(stats.pokemon),
    trainers: trainerSections(stats.trainers),
  };
  const drafts = EMBEDS.map(({ key, title, color }) => ({
    title,
    color,
    fields: sections[key].map(({ name, lines }) => ({ name, lines: [...lines] })),
  })).filter((draft) => draft.fields.length);
  fitEmbeds(drafts);

  const embeds = drafts.map((draft) =>
    new EmbedBuilder()
      .setTitle(draft.title)
      .setColor(draft.color)
      .addFields(draft.fields.map((field) => ({ name: field.name, value: field.lines.join("\n") })))
  );

  const stamp = (ms) => `<t:${Math.floor(ms / 1000)}:D>`;
  const period = stats.start
    ? `Du ${stamp(stats.start)} ${preview ? "à maintenant" : `au ${stamp(stats.end)}`}.`
    : preview
      ? "Depuis le début, jusqu'à maintenant."
      : `Depuis le début, jusqu'au ${stamp(stats.end)}.`;
  // L'aperçu montre ce qu'il a pu lire, et dit ce qui manque : l'administrateur qui règle ses seuils
  // ne doit pas prendre une rubrique illisible pour une rubrique vide. Le bilan publié, lui, n'est
  // jamais construit avec des lectures en échec (publishSeason).
  const missing = stats.failures?.length
    ? `\n⚠️ Lecture impossible, rubriques absentes : ${stats.failures.join(", ")}.`
    : "";
  const content = preview
    ? `🔎 **Aperçu de la saison ${stats.season}** — rien n'est publié ni enregistré.\n${period}` +
      missing +
      (embeds.length || missing ? "" : "\nRien à raconter pour l'instant.")
    : `📊 **Bilan de la saison ${stats.season}**\n${period}`;
  return { content, embeds };
}

// ====================== APERÇU ======================

// La saison en cours, de son ouverture à maintenant. Ne publie rien et n'enregistre rien : c'est la
// même mise en forme que le bilan, sur une fin qui n'est pas encore arrivée.
export async function previewSeason({ now = Date.now() } = {}) {
  const season = activeGeneration(now);
  const start = await openingOf(season, now);
  if (start === null) {
    return {
      ok: false,
      reason:
        `L'ouverture de la ${generationOrdinal(season)} génération n'est pas encore enregistrée : ` +
        "réessaie dans une minute.",
    };
  }
  const stats = await computeSeasonStats(season, { start, end: now });
  return { ok: true, season, ...buildSeasonMessage(stats, { preview: true }) };
}

// ====================== PUBLICATION ======================

async function skip(season, now, reason) {
  const changes = await dbRun(
    `UPDATE pokemon_season_recaps SET skipped_at = ?
      WHERE season = ? AND posted_at IS NULL AND skipped_at IS NULL`,
    [now, season]
  );
  if (changes === 1) log(`Bilan de la saison ${season} : non publié (${reason})`);
}

// La ligne d'une saison, créée à la première tentative avec les bornes lues à ce moment-là : une
// date d'ouverture retouchée ensuite ne déplace pas un bilan déjà commencé. null tant que
// l'ouverture de la génération suivante (ou le début de la saison) n'est pas connue.
async function recapRow(season, now) {
  const row = await dbGet("SELECT * FROM pokemon_season_recaps WHERE season = ?", [season]);
  if (row) return row;
  const window = await seasonWindow(season, now);
  if (!window) return null;
  await dbRun(
    "INSERT OR IGNORE INTO pokemon_season_recaps (season, started_at, ended_at) VALUES (?, ?, ?)",
    [season, window.start, window.end]
  );
  return dbGet("SELECT * FROM pokemon_season_recaps WHERE season = ?", [season]);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Note que le bilan est parti. C'est l'écriture qui l'empêche de repartir : si elle échoue après
// l'envoi, le bail expirerait et le bilan serait renvoyé en double. On la retente donc, avec une
// attente doublée à chaque essai (réglages `recordRetries` et `recordRetryDelayMs`). Au bout des
// essais on le dit sans détour : le message est dans le salon, la base ne le sait pas. L'historique
// du salon n'est pas relu pour le retrouver — ce serait une lecture de Discord à chaque minute, pour
// un cas qu'une base qui répond n'atteint pas.
async function recordPosted(season, values, config) {
  let wait = config.recordRetryDelayMs;
  for (let attempt = 0; ; attempt++) {
    try {
      await dbRun(
        `UPDATE pokemon_season_recaps
            SET posted_at = ?, channel_id = ?, message_id = ?, payload = ?
          WHERE season = ? AND posted_at IS NULL`,
        [...values, season]
      );
      return true;
    } catch (error) {
      if (attempt >= config.recordRetries) {
        handleException(
          `Bilan de la saison ${season} : publié mais non enregistré (${attempt + 1} essai(s)), ` +
            "il sera renvoyé à l'expiration du bail :",
          error
        );
        return false;
      }
      await sleep(wait);
      wait *= 2;
    }
  }
}

async function publishSeason(client, season, now) {
  const row = await recapRow(season, now);
  if (!row || row.posted_at !== null || row.skipped_at !== null) return;

  const config = getSeasonRecapConfig();
  if (now - row.ended_at > config.publishWithinHours * HOUR_MS) {
    return skip(season, now, `la saison a fini il y a plus de ${config.publishWithinHours} h`);
  }

  // La revendication. Le bail est pris par un essai, et se libère de lui-même : l'attente
  // grandit avec le nombre d'essais, ce qui espace les retentatives d'un salon qui refuse.
  const claimed = await dbRun(
    `UPDATE pokemon_season_recaps SET claimed_at = ?, attempts = attempts + 1
      WHERE season = ? AND posted_at IS NULL AND skipped_at IS NULL
        AND (claimed_at IS NULL OR claimed_at + attempts * ? <= ?)`,
    [now, season, config.retryMinutes * MINUTE_MS, now]
  );
  if (claimed !== 1) return;

  try {
    const stats = await computeSeasonStats(season, { start: row.started_at, end: row.ended_at });
    // Une lecture en échec ne fait ni un bilan amputé, ni un « rien à raconter » qui clorait la
    // saison pour de bon : c'est une panne, retentée avec l'attente habituelle.
    if (stats.failures.length) {
      throw new Error(`lecture impossible (${stats.failures.join(", ")})`);
    }
    const message = buildSeasonMessage(stats);
    if (!message.embeds.length) return await skip(season, now, "rien à raconter");
    const channel = await resolveChannel(client);
    if (!channel) throw new Error("salon des apparitions introuvable");
    const sent = await channel.send({
      content: message.content,
      embeds: message.embeds,
      // Les podiums mentionnent des dresseurs pour qu'on les reconnaisse, pas pour les réveiller.
      allowedMentions: { parse: [] },
    });
    const recorded = await recordPosted(
      season,
      [now, channel.id ?? process.env.POKEMON_CHANNEL_ID, sent?.id ?? null, JSON.stringify(stats)],
      config
    );
    if (recorded) log(`Bilan de la saison ${season} publié`);
  } catch (error) {
    // Le bail reste pris : le prochain essai attend `retryMinutes` fois le nombre d'essais.
    handleException(`Bilan de la saison ${season} :`, error);
  }
}

// À chaque passage du minuteur d'ouverture des générations, APRÈS l'annonce de l'ouverture : le
// bilan de la saison N part quand la génération N+1 est ouverte. `now` se passe pour rejouer un
// passage plus tard sans attendre.
export async function publishSeasonRecaps(client, { now = Date.now() } = {}) {
  if (!getPokemonConfig().enabled || !getSeasonRecapConfig().enabled) return;
  // Sans salon, il n'y a nulle part où publier : on n'entame rien (le jeu est alors inerte).
  if (!process.env.POKEMON_CHANNEL_ID) return;
  const active = activeGeneration(now);
  for (let season = 1; season < active; season++) {
    try {
      await publishSeason(client, season, now);
    } catch (error) {
      handleException(`Bilan de la saison ${season} :`, error);
    }
  }
}
