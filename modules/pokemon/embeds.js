// Construction des embeds et des boutons du système de capture.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { getPokemonConfig, getSafariConfig } from "./config.js";
import {
  RARITIES,
  allSpecies,
  dexSize,
  difficultyLabel,
  embedColor,
  getSpecies,
  isSafariFinished,
  probabilitiesByBall,
  rarityOf,
  safariBaitCapped,
  safariBaitFactor,
  safariCatchProbability,
  safariFleeChance,
  spriteUrl,
} from "./data.js";

const formatPercent = (probability) => {
  const percent = probability * 100;
  if (percent >= 10) return `${Math.round(percent)} %`;
  if (percent >= 1) return `${percent.toFixed(1)} %`;
  return `${percent.toFixed(2)} %`;
};

const ballResultIcon = (result) => (result === "CATCH" ? "✅" : "❌");

// Le nom affiché porte la marque shiny partout où il apparaît.
export const displayName = (species, isShiny) =>
  isShiny ? `✨ ${species.name}` : species.name;

// Ligne « difficulté » : les probabilités réelles par ball. Indispensable, car
// des Pokémon de stade 1 comme Ronflex (25) ou Leveinard (30) sont étiquetés
// « commun » à l'apparition tout en étant très durs à capturer.
function probabilityLine(catchRate) {
  return probabilitiesByBall(catchRate)
    .filter((ball) => !ball.guaranteed)
    .map((ball) => `${ball.emoji} ${formatPercent(ball.probability)}`)
    .join(" · ");
}

function throwLogField(throws) {
  if (!throws.length) return "*Personne n'a encore tenté sa chance.*";
  return throws
    .map(
      (row) =>
        `${ballResultIcon(row.result)} <@${row.user_id}> — ${
          getPokemonConfig().capture.balls[row.ball]?.label ?? row.ball
        }`
    )
    .join("\n");
}

export function buildSpawnEmbed(spawn, species, throws = [], announcement = null) {
  const isShiny = Boolean(spawn.is_shiny);
  const rarity = RARITIES[spawn.rarity] ?? RARITIES[rarityOf(species)];

  const embed = new EmbedBuilder()
    .setTitle(
      isShiny
        ? `✨ Un ${species.name} SHINY apparaît ! ✨`
        : `Un ${species.name} sauvage apparaît !`
    )
    .setColor(embedColor(species, isShiny))
    .setImage(spriteUrl(species, isShiny))
    .addFields(
      {
        name: "Rareté",
        value: `${rarity.icon} ${rarity.label}`,
        inline: true,
      },
      {
        name: "Type",
        value: species.types.join(" / "),
        inline: true,
      },
      {
        name: `Difficulté — ${difficultyLabel(spawn.catch_rate)}`,
        value: probabilityLine(spawn.catch_rate),
        inline: false,
      },
      {
        name: `Lancers (${spawn.throw_count})`,
        value: throwLogField(throws),
        inline: false,
      }
    )
    .setFooter({ text: `Spawn #${spawn.id} · Pokédex n°${species.id}` });

  if (announcement) embed.setDescription(announcement);
  return embed;
}

// La même rangée sert l'annonce publique et le panneau éphémère qui répond aux
// lancers. Seul le préfixe change : `poke_throw` ouvre un éphémère, `poke_rethrow`
// réécrit celui d'où vient le clic. Le nom de la route dit donc ce qu'elle fait,
// plutôt qu'un drapeau à déchiffrer côté routeur.
export function buildBallRow(spawnId, { disabled = false, panel = false } = {}) {
  const row = new ActionRowBuilder();
  for (const [key, ball] of Object.entries(getPokemonConfig().capture.balls)) {
    // La Master Ball passe par une confirmation : à 22 500 points, un mésclic
    // n'est pas rattrapable.
    const customId = ball.guaranteed
      ? `${panel ? "poke_remaster" : "poke_master"}|${spawnId}`
      : `${panel ? "poke_rethrow" : "poke_throw"}|${spawnId}|${key}`;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(`${ball.label} (${ball.price})`)
        .setEmoji(ball.emoji)
        .setStyle(ball.guaranteed ? ButtonStyle.Danger : ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  }
  return row;
}

// Un message Discord est identique pour tous ses lecteurs : impossible d'y
// afficher « tu l'as déjà » personnalisé. Ce bouton contourne la limite en
// répondant à chacun en privé selon SA collection.
export function buildOwnedRow(spawnId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`poke_owned|${spawnId}`)
      .setLabel("Je l'ai déjà ?")
      .setEmoji("❓")
      .setStyle(ButtonStyle.Secondary)
  );
}

const formatPoints = (value) => value.toLocaleString("fr-FR");

// Classement des points perdus sur un spawn. Le champ d'embed est plafonné à
// 1024 caractères, d'où la coupe au top 5 avec un reliquat agrégé.
const SPENDERS_SHOWN = 5;

function spendersField(spending) {
  const spenders = spending?.spenders ?? [];
  if (!spenders.length) return "*Personne n'a perdu un seul point.*";

  const lines = spenders
    .slice(0, SPENDERS_SHOWN)
    .map((row, index) => {
      const medal = ["🥇", "🥈", "🥉"][index] ?? "▪️";
      return `${medal} <@${row.user_id}> — ${formatPoints(row.burned)} pts`;
    });

  const rest = spenders.length - SPENDERS_SHOWN;
  if (rest > 0) {
    const restTotal = spenders
      .slice(SPENDERS_SHOWN)
      .reduce((sum, row) => sum + row.burned, 0);
    lines.push(`*et ${rest} autre${rest > 1 ? "s" : ""} — ${formatPoints(restTotal)} pts*`);
  }
  return lines.join("\n");
}

export function buildCaughtEmbed(spawn, species, winnerId, ballKey, spending) {
  const isShiny = Boolean(spawn.is_shiny);
  const ball = getPokemonConfig().capture.balls[ballKey];
  const total = spending?.total ?? 0;

  return new EmbedBuilder()
    .setTitle(`🎉 ${displayName(species, isShiny)} a été capturé !`)
    .setDescription(
      `<@${winnerId}> l'a attrapé avec une **${ball?.label ?? ballKey}** !`
    )
    .setColor(embedColor(species, isShiny))
    .setThumbnail(spriteUrl(species, isShiny))
    .addFields(
      { name: "Lancers", value: `${spawn.throw_count}`, inline: true },
      { name: "💸 Ils ont payé pour rien", value: spendersField(spending), inline: false }
    )
    .setFooter({
      // Le total reste visible : c'est la mesure du puits, raison d'être du système.
      text: `Spawn #${spawn.id} · Pokédex n°${species.id} · ${formatPoints(total)} pts partis en fumée`,
    });
}

export function buildFledEmbed(spawn, species, spending) {
  const isShiny = Boolean(spawn.is_shiny);
  const total = spending?.total ?? 0;

  return new EmbedBuilder()
    .setTitle(`💨 ${displayName(species, isShiny)} s'est enfui...`)
    .setDescription("Personne n'a réussi à le capturer à temps.")
    .setColor(0x4f545c)
    .setThumbnail(spriteUrl(species, isShiny))
    .addFields(
      { name: "Lancers", value: `${spawn.throw_count}`, inline: true },
      { name: "💸 Ils ont payé pour rien", value: spendersField(spending), inline: false }
    )
    .setFooter({
      text: `Spawn #${spawn.id} · Pokédex n°${species.id} · ${formatPoints(total)} pts partis en fumée`,
    });
}

// ====================== POKÉDEX ======================

// Regroupe les lignes de collection par espèce.
function indexCollection(rows) {
  const owned = new Map();
  for (const row of rows) {
    const entry = owned.get(row.species_id) || { normal: 0, shiny: 0 };
    if (row.is_shiny) entry.shiny += row.count;
    else entry.normal += row.count;
    owned.set(row.species_id, entry);
  }
  return owned;
}

export function collectionStats(rows) {
  const owned = indexCollection(rows);
  let species = 0;
  let shinies = 0;
  let total = 0;
  for (const entry of owned.values()) {
    if (entry.normal > 0 || entry.shiny > 0) species++;
    if (entry.shiny > 0) shinies++;
    total += entry.normal + entry.shiny;
  }
  return { species, shinies, total, owned };
}

export function dexPageCount() {
  return Math.ceil(dexSize() / getPokemonConfig().pokedex.pageSize);
}

export function buildDexEmbed(targetUser, rows, page) {
  const pageSize = getPokemonConfig().pokedex.pageSize;
  const stats = collectionStats(rows);
  const total = dexSize();
  const percent = total ? Math.round((stats.species / total) * 100) : 0;
  const filled = Math.round(percent / 10);

  const slice = allSpecies().slice(page * pageSize, (page + 1) * pageSize);
  const lines = slice.map((species) => {
    const entry = stats.owned.get(species.id);
    if (!entry || (entry.normal === 0 && entry.shiny === 0)) {
      // On affiche quand même le nom : les joueurs veulent savoir quoi chasser.
      return `\`#${String(species.id).padStart(3, "0")}\` ❔ ${species.name}`;
    }
    const quantity = entry.normal > 1 ? ` ×${entry.normal}` : "";
    const shiny = entry.shiny > 0 ? ` ✨${entry.shiny > 1 ? entry.shiny : ""}` : "";
    return `\`#${String(species.id).padStart(3, "0")}\` ✅ **${species.name}**${quantity}${shiny}`;
  });

  // Trois colonnes façon Pokédex, chacune bien en deçà des 1024 caractères.
  const perColumn = Math.ceil(lines.length / 3) || 1;
  const columns = [];
  for (let i = 0; i < lines.length; i += perColumn) {
    columns.push(lines.slice(i, i + perColumn).join("\n"));
  }

  const embed = new EmbedBuilder()
    .setTitle(`📕 Pokédex de ${targetUser.username}`)
    .setColor(0xcc0000)
    .setDescription(
      `${"🟩".repeat(filled)}${"⬛".repeat(10 - filled)}\n` +
        `**${stats.species}**/${total} espèces (${percent} %) · ✨ **${stats.shinies}** · ` +
        `**${stats.total}** captures au total`
    )
    .setFooter({ text: `Page ${page + 1}/${dexPageCount()}` });

  columns.forEach((value, index) => {
    embed.addFields({ name: index === 0 ? "​" : "​", value, inline: true });
  });

  return embed;
}

export function buildDexRow(targetUserId, page) {
  const pages = dexPageCount();
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`poke_dex|${targetUserId}|${(page - 1 + pages) % pages}`)
      .setLabel("◀")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pages <= 1),
    new ButtonBuilder()
      .setCustomId(`poke_dex_noop|${targetUserId}`)
      .setLabel(`${page + 1}/${pages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`poke_dex|${targetUserId}|${(page + 1) % pages}`)
      .setLabel("▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pages <= 1)
  );
}

// ====================== ÉCHANGES ======================

const TRADE_STATUS = {
  PENDING: { color: 0x5865f2, title: "🔄 Proposition d'échange", note: null },
  ACCEPTED: { color: 0x57f287, title: "✅ Échange effectué", note: null },
  DECLINED: { color: 0xed4245, title: "❌ Échange refusé", note: null },
  CANCELLED: { color: 0x4f545c, title: "🚫 Échange annulé", note: null },
  EXPIRED: { color: 0x4f545c, title: "⌛ Échange expiré", note: null },
  FAILED: {
    color: 0xed4245,
    title: "⚠️ Échange impossible",
    note: "L'un des deux Pokémon n'était plus disponible.",
  },
};

export function buildTradeEmbed(trade, status = "PENDING") {
  const style = TRADE_STATUS[status] ?? TRADE_STATUS.PENDING;
  const offered = getSpecies(trade.offer_species_id);
  const requested = getSpecies(trade.request_species_id);

  const embed = new EmbedBuilder()
    .setTitle(style.title)
    .setColor(style.color)
    .setDescription(
      `<@${trade.from_user_id}> propose **${displayName(offered, trade.offer_is_shiny)}**\n` +
        `contre **${displayName(requested, trade.request_is_shiny)}** de <@${trade.to_user_id}>.`
    )
    .setThumbnail(spriteUrl(offered, trade.offer_is_shiny));

  if (style.note) embed.addFields({ name: "Raison", value: style.note });
  if (status === "PENDING") {
    embed.setFooter({ text: "Seul le destinataire peut accepter ou refuser." });
  }
  return embed;
}

export function buildTradeRow(tradeId, { disabled = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`poke_trade_accept|${tradeId}`)
      .setLabel("Accepter")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`poke_trade_decline|${tradeId}`)
      .setLabel("Refuser")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`poke_trade_cancel|${tradeId}`)
      .setLabel("Annuler")
      .setEmoji("🚫")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

// ====================== PARC SAFARI ======================

const SAFARI_COLOR = 0x2ecc71;
const timestamp = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

export function buildParkEmbed(park, { closed = false } = {}) {
  const config = getSafariConfig();
  const reserved = Boolean(park.reserved_for);

  if (closed) {
    return new EmbedBuilder()
      .setTitle("\u{1F3D5}\uFE0F Le parc safari a fermé ses portes")
      .setColor(0x4f545c)
      .setDescription(
        park.entries > 0
          ? `**${park.entries}** dresseur${park.entries > 1 ? "s l'ont" : " l'a"} visité.`
          : "Personne n'est venu. Les Pokémon rares peuvent souffler."
      )
      .setFooter({ text: `Parc #${park.id}` });
  }

  const embed = new EmbedBuilder()
    .setTitle(
      reserved
        ? "\u{1F3D5}\uFE0F Un parc safari privé vient d'ouvrir"
        : "\u{1F3D5}\uFE0F Le Parc Safari ouvre ses portes !"
    )
    .setColor(SAFARI_COLOR)
    .setDescription(
      reserved
        ? `Ce parc est réservé à <@${park.reserved_for}>.`
        : "Les grilles sont ouvertes à **tout le monde**, et l'entrée est offerte."
    )
    .addFields(
      {
        name: "Ce qui t'attend",
        value:
          `**${config.actionsPerSession} actions**, et pas un point dépensé.\n` +
          "Les évolutions, les Pokémon rares et les légendaires y sont bien plus " +
          `fréquents qu'à l'état sauvage, et les shinies deux fois plus (1/${config.shinyOdds}).`,
        inline: false,
      },
      {
        name: "Trois façons de jouer",
        value:
          `${config.ball.emoji} **${config.ball.label}** — tenter la capture\n` +
          "\u{1F34E} **Appâter** — il baisse sa garde, tes chances montent\n" +
          "\u{1F3C3} **Essayer de fuir** — passer au Pokémon suivant",
        inline: false,
      },
      { name: "Fermeture", value: timestamp(park.expires_at), inline: true },
      {
        name: "Dresseurs entrés",
        value: `${park.entries}`,
        inline: true,
      }
    )
    .setFooter({
      text: reserved
        ? `Parc #${park.id} · une seule visite`
        : `Parc #${park.id} · une seule visite par dresseur`,
    });

  return embed;
}

export function buildParkRow(parkId, { disabled = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`poke_safari_enter|${parkId}`)
      .setLabel("Entrer dans le parc")
      .setEmoji("\u{1F3D5}\uFE0F")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled)
  );
}

// Le récit de la dernière action, en tête de l'embed de rencontre. C'est la
// seule trace qu'en garde le joueur : le message est unique et réécrit à chaque
// clic, il n'y a pas de fil de discussion où relire ce qui s'est passé.
function safariOutcomeLine(result, config) {
  const name = displayName(result.species, result.isShiny);
  switch (result.outcome) {
    case "CATCH":
      return `\u{1F389} **${name}** est capturé ! Il rejoint ton Pokédex.`;
    case "MISS":
      return `\u274C Raté ! **${name}** s'est dégagé de ta ${config.ball.label}.`;
    case "MISS_FLED":
      return `\u274C Raté — et **${name}** en a profité pour détaler !`;
    case "BAIT":
      return `\u{1F34E} Tu jettes de l'appât. **${name}** se régale et baisse sa garde.`;
    case "BAIT_FLED":
      return `\u{1F34E} **${name}** engloutit la baie... et détale aussitôt !`;
    case "FLED":
      return "\u{1F3C3} Tu t'éclipses sans demander ton reste.";
    case "FLEE_FAILED":
      return `\u{1F3C3} Tu tentes de filer... mais **${name}** te barre la route !`;
    default:
      return null;
  }
}

// Mêmes règles que le bouton « Je l'ai déjà ? » des spawns publics : un shiny
// est une entrée de Pokédex distincte, donc on compare la variante rencontrée.
// Formulations courtes : le champ est affiché en colonne, à un tiers de largeur.
function ownedLine(owned, isShiny) {
  if (!owned) return null;
  const mine = isShiny ? owned.shiny : owned.normal;
  const times = mine > 1 ? ` (\u00D7${mine})` : "";

  if (mine > 0) {
    return isShiny ? `\u2705 Déjà en shiny${times}` : `\u2705 Déjà capturé${times}`;
  }
  if (!isShiny) return "\u{1F195} Il te manque !";
  return owned.normal > 0
    ? "\u{1F195} Shiny inédit ! (tu as la normale)"
    : "\u{1F195} Shiny inédit, et pas la normale !";
}

function buildEncounterEmbed(session, species, config, { intro = null, owned = null } = {}) {
  const isShiny = Boolean(session.encounter_is_shiny);
  const rarity = RARITIES[rarityOf(species)];
  const probability = safariCatchProbability(
    session.encounter_catch_rate,
    session.encounter_bait,
    config
  );
  const baitFactor = safariBaitFactor(session.encounter_bait, config);
  const baitNote = session.encounter_bait
    ? ` \u{1F34E} \u00D7${baitFactor} (${session.encounter_bait} appât${session.encounter_bait > 1 ? "s" : ""})`
    : "";
  // Sans ce chiffre, la nervosité gagnée en appâtant serait invisible et le
  // joueur ne pourrait pas arbitrer entre lancer et appâter.
  const fleeRisk = safariFleeChance(session.encounter_bait, config);

  // Collection illisible : on préfère une rencontre sans pastille à un champ
  // vide, que l'API refuserait. Trois champs par rangée, d'où la grille
  // « Rareté | Type | Chances » puis « Ton Pokédex | Actions restantes ».
  const ownership = ownedLine(owned, isShiny);

  const embed = new EmbedBuilder()
    .setTitle(
      isShiny
        ? `\u2728 Un ${species.name} SHINY vous observe ! \u2728`
        : `Un ${species.name} sauvage vous observe...`
    )
    .setColor(embedColor(species, isShiny))
    .setImage(spriteUrl(species, isShiny))
    .addFields(
      { name: "Rareté", value: `${rarity.icon} ${rarity.label}`, inline: true },
      { name: "Type", value: species.types.join(" / "), inline: true },
      {
        name: "Chances de capture",
        value:
          `${formatPercent(probability)}${baitNote}\n` +
          // Arrondi à l'entier plutôt que via formatPercent : c'est un cran de
          // réglage grossier, pas une probabilité dérivée, et « 5.0 % » à côté
          // de « 11 % » se lit mal.
          `\u{1F4A8} ${Math.round(fleeRisk * 100)} % qu'il détale`,
        inline: true,
      },
      ...(ownership ? [{ name: "Ton Pokédex", value: ownership, inline: true }] : []),
      {
        name: "Actions restantes",
        value: `**${session.actions_left}** / ${config.actionsPerSession}`,
        inline: true,
      }
    )
    .setFooter({
      text: `Parc safari · Pokédex n°${species.id} · rencontre n°${session.encounter_no}`,
    });

  if (intro) embed.setDescription(intro);
  return embed;
}

function buildSafariRow(session, config) {
  // actions_left sert de jeton anti-double-clic : il décroît strictement, donc
  // il identifie l'action de façon unique et un second clic sur le même bouton
  // n'a plus de correspondance en base.
  const token = `${session.id}|${session.actions_left}`;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`poke_safari_ball|${token}`)
      .setLabel(config.ball.label)
      .setEmoji(config.ball.emoji)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`poke_safari_bait|${token}`)
      .setLabel("Appâter")
      .setEmoji("\u{1F34E}")
      .setStyle(ButtonStyle.Secondary)
      // Au plafond, un appât de plus ne change rien : mieux vaut fermer le
      // bouton que de laisser brûler une action pour rien.
      .setDisabled(safariBaitCapped(session.encounter_bait, config)),
    new ButtonBuilder()
      .setCustomId(`poke_safari_flee|${token}`)
      .setLabel("Essayer de fuir")
      .setEmoji("\u{1F3C3}")
      .setStyle(ButtonStyle.Secondary)
  );
}

// Partage du bilan, dans le salon où l'on se trouve. Un bouton et rien d'autre :
// le bilan est éphémère, donc invisible des autres tant qu'on ne le publie pas.
function buildSafariShareRow(session) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`poke_safari_share|${session.id}`)
      .setLabel("Partager mon bilan")
      .setEmoji("\u{1F4E4}")
      .setStyle(ButtonStyle.Secondary)
  );
}

// Une visite du parc ne s'affiche que de deux façons : la rencontre en cours, ou
// le bilan une fois les actions épuisées. Un seul point d'entrée, pour que la
// commande, le bouton d'entrée et les trois actions rendent rigoureusement la
// même chose — et qu'ajouter un champ ne demande qu'une seule retouche.
export function buildSafariView(session, { result = null, catches = [], owned = null } = {}) {
  const config = getSafariConfig();
  const intro = result ? safariOutcomeLine(result, config) : null;
  const finie = isSafariFinished(session);
  const species = finie ? null : getSpecies(session.encounter_species_id);

  if (!species) {
    // Le bouton n'apparaît que sur une visite réellement terminée et pas encore
    // partagée — la même garde que prepareShare, et le même prédicat, pas une
    // copie. On tombe aussi ici quand l'espèce en cours est introuvable :
    // proposer un partage que la base refuserait ensuite serait une promesse en
    // l'air.
    return {
      embeds: [buildSafariRecapEmbed(session, catches, { intro, config })],
      components: finie && !session.shared_at ? [buildSafariShareRow(session)] : [],
    };
  }
  return {
    embeds: [buildEncounterEmbed(session, species, config, { intro, owned })],
    components: [buildSafariRow(session, config)],
  };
}

// `author` bascule le bilan en version publique : même embed, signé. Une
// seconde fonction aurait divergé du privé au premier champ ajouté.
export function buildSafariRecapEmbed(
  session,
  catches,
  // La config se récupère toute seule : l'appelant public n'a pas à réimporter
  // getSafariConfig pour atteindre ce que le chemin privé obtient gratuitement,
  // ni à risquer d'en passer une périmée.
  { intro = null, author = null, config = getSafariConfig() } = {}
) {
  const lines = catches.map((row) => {
    const species = getSpecies(row.species_id);
    if (!species) return null;
    const rarity = RARITIES[rarityOf(species)];
    return `${rarity.icon} ${displayName(species, row.is_shiny)}`;
  });
  const caught = lines.filter(Boolean);

  const qui = author ? `**${author.displayName}**` : "Tu";
  const verbe = author ? "ressort" : "ressors";
  const embed = new EmbedBuilder()
    .setTitle("\u{1F3D5}\uFE0F Fin de la visite")
    .setColor(caught.length ? SAFARI_COLOR : 0x4f545c)
    .setDescription(
      (intro ? `${intro}\n\n` : "") +
        (caught.length
          ? `${qui} ${verbe} du parc avec **${caught.length}** Pokémon.`
          : `${qui} ${verbe} du parc les mains vides. Ça arrive.`)
    )
    .addFields(
      {
        name: author ? "Ses prises" : "Tes prises",
        value: caught.length ? caught.join("\n") : "*Rien du tout.*",
        inline: false,
      },
      {
        name: `${config.actionsPerSession} actions`,
        value:
          `${config.ball.emoji} ${session.balls_thrown} lancer${session.balls_thrown > 1 ? "s" : ""} · ` +
          `\u{1F34E} ${session.baits_used} appât${session.baits_used > 1 ? "s" : ""} · ` +
          `\u{1F3C3} ${session.flees} fuite${session.flees > 1 ? "s" : ""}`,
        inline: false,
      }
    )
    .setFooter({ text: `Session #${session.id}` });

  if (author) embed.setThumbnail(author.avatarURL);
  return embed;
}
