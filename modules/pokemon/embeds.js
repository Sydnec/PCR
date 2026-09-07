// Construction des embeds et des boutons du système de capture.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { getPokemonConfig } from "./config.js";
import {
  RARITIES,
  allSpecies,
  dexSize,
  difficultyLabel,
  embedColor,
  getSpecies,
  probabilitiesByBall,
  rarityOf,
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

export function buildBallRow(spawnId, { disabled = false } = {}) {
  const row = new ActionRowBuilder();
  for (const [key, ball] of Object.entries(getPokemonConfig().capture.balls)) {
    // La Master Ball passe par une confirmation : à 50 000 points, un mésclic
    // n'est pas rattrapable.
    const customId = ball.guaranteed
      ? `poke_master|${spawnId}`
      : `poke_throw|${spawnId}|${key}`;
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
