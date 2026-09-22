// Construction des embeds et des boutons du système de capture.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { getPokemonConfig, getSafariConfig } from "./config.js";
import { getItem, sortByCatalogue } from "./items.js";
import {
  RARITIES,
  allSpecies,
  dexSize,
  difficultyLabel,
  embedColor,
  evolutionChain,
  getSpecies,
  isFusionOnly,
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

// Le journal des lancers. L'emoji de la ball plutôt que son nom : une colonne de
// « Super Ball » répétée n'apprend rien, là où les pastilles se lisent d'un coup
// d'œil et disent la même chose en un caractère.
function throwLogField(throws) {
  if (!throws.length) return "*Personne n'a encore tenté sa chance.*";
  const balls = getPokemonConfig().capture.balls;
  return throws
    .map(
      (row) =>
        `${ballResultIcon(row.result)} <@${row.user_id}> ${balls[row.ball]?.emoji ?? row.ball}`
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
// répondant à chacun en privé selon SA collection — et tant qu'on lui ouvre un
// éphémère, il y sert la fiche complète plutôt que la seule ligne de possession.
//
// Le customId reste `poke_owned` : il est gravé dans les messages déjà postés,
// et le renommer ferait taire les boutons des apparitions en cours.
export function buildInfoRow(spawnId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`poke_owned|${spawnId}`)
      .setLabel("Infos du Pokémon")
      .setEmoji("ℹ️")
      .setStyle(ButtonStyle.Secondary)
  );
}

// ====================== FICHE D'ESPÈCE ======================

const dexNumber = (species) => `#${String(species.id).padStart(3, "0")}`;

// Les stades tels que le dataset les numérote : 1 = forme de base.
const STAGE_LABELS = ["Forme de base", "Stade 1", "Stade 2"];

// La ball de référence : la moins puissante de celles qui ne garantissent rien,
// donc la Poké Ball avec les réglages par défaut. Une seule probabilité suffit à
// situer la difficulté, les autres s'en déduisent par leur multiplicateur — et
// la fiche tient sur un écran de téléphone.
function referenceBall(catchRate) {
  return (
    probabilitiesByBall(catchRate)
      .filter((ball) => !ball.guaranteed)
      .sort((a, b) => a.multiplier - b.multiplier)[0] ?? null
  );
}

// Un maillon de la lignée : possession, numéro, nom. La variante qui compte est
// celle qu'on a sous les yeux — sur une apparition shiny, « je l'ai » veut dire
// « je l'ai en shiny », un shiny étant une entrée de Pokédex distincte. Les deux
// compteurs restent affichés : « pas en shiny, mais j'en ai deux normaux » est
// précisément ce que le dresseur cherche à savoir avant de lancer une ball.
function chainLine(species, counts, { current = false, focusShiny = false } = {}) {
  const owned = counts ?? { normal: 0, shiny: 0 };
  const has = focusShiny ? owned.shiny > 0 : owned.normal > 0;
  const marks = [];
  if (owned.normal > 0) marks.push(`\u00D7${owned.normal}`);
  if (owned.shiny > 0) marks.push(`\u2728\u00D7${owned.shiny}`);

  // Deux repères pour le maillon consulté, parce qu'ils ne font pas le même
  // travail : le chevron le fait dépasser de sa colonne, donc il se repère sans
  // lire ; le gras souligné le distingue une fois l'œil posé dessus. Le titre et
  // la vignette nomment déjà l'espèce — ce qui manquait, c'était de la retrouver
  // AU MILIEU de sa lignée, surtout sur un embranchement où trois cibles
  // partagent le même champ.
  return (
    `${current ? "\u25B8 " : ""}${has ? "\u2705" : "\u2754"} \`${dexNumber(species)}\` ` +
    `${current ? `__**${species.name}**__` : species.name}` +
    `${isFusionOnly(species) ? " \u{1F512}" : ""}` +
    `${marks.length ? ` ${marks.join(" ")}` : ""}`
  );
}

// Fiche d'une espèce : ce qu'elle est, ce qu'elle coûte à attraper, et où en est
// le dresseur dans sa lignée. Elle sert /pokeinfo comme le bouton des
// apparitions : « je l'ai déjà ? » n'est qu'un cas particulier de « parle-moi de
// ce Pokémon », et deux réponses séparées auraient fini par diverger.
export function buildSpeciesInfoEmbed(
  species,
  // catchRate se passe explicitement : une apparition fige le sien à la
  // naissance du spawn, et la fiche doit annoncer le même chiffre que l'embed
  // d'où l'on vient, pas celui d'un dataset régénéré entre-temps.
  { owned = new Map(), isShiny = false, catchRate = species.catchRate } = {}
) {
  const rarity = RARITIES[rarityOf(species)];
  const ball = referenceBall(catchRate);
  const chain = evolutionChain(species);

  const embed = new EmbedBuilder()
    .setTitle(`${isShiny ? "\u2728 " : ""}${dexNumber(species)} ${species.name}`)
    .setColor(embedColor(species, isShiny))
    .setThumbnail(spriteUrl(species, isShiny))
    .addFields(
      { name: "Type", value: species.types.join(" / "), inline: true },
      { name: "Rareté", value: `${rarity.icon} ${rarity.label}`, inline: true },
      {
        name: "Difficulté",
        value:
          difficultyLabel(catchRate) +
          (ball ? `\n${ball.emoji} ${formatPercent(ball.probability)}` : ""),
        inline: true,
      }
    );

  // Un champ par stade : la rangée se lit de gauche à droite comme la lignée
  // elle-même, et un embranchement (Évoli) empile ses trois cibles dans le
  // champ de son stade, là où une liste à flèches aurait laissé croire à une
  // chaîne unique.
  const stages = new Map();
  for (const link of chain) {
    const lines = stages.get(link.stage) ?? [];
    lines.push(
      chainLine(link, owned.get(link.id), {
        current: link.id === species.id,
        focusShiny: isShiny,
      })
    );
    stages.set(link.stage, lines);
  }

  const solo = stages.size <= 1;
  for (const [stage, lines] of [...stages].sort((a, b) => a[0] - b[0])) {
    embed.addFields({
      // Sans lignée, « Forme de base » ne veut rien dire : le champ ne répond
      // plus qu'à une question, celle de la collection.
      name: solo ? "Ton Pokédex" : STAGE_LABELS[stage - 1] ?? `Stade ${stage - 1}`,
      value: lines.join("\n"),
      inline: true,
    });
  }

  if (chain.some(isFusionOnly)) {
    embed.setFooter({
      text: "\u{1F512} Introuvable à l'état sauvage : uniquement par fusion de doublons.",
    });
  }
  return embed;
}

const formatPoints = (value) => value.toLocaleString("fr-FR");

// Qui a lancé quoi. Le champ d'embed est plafonné à 1024 caractères, d'où la
// coupe au top 5 avec un reliquat agrégé.
const PARTICIPANTS_SHOWN = 5;

// Les balls d'un dresseur, groupées et comptées : « 1×🟡 2×🔵 ». Les pastilles
// racontent l'engagement bien mieux qu'un total en points — on voit du premier
// coup qui a sorti l'artillerie et qui a tenté sa chance à l'économie.
function ballsLine(balls) {
  const config = getPokemonConfig().capture.balls;
  return Object.entries(balls)
    .filter(([, count]) => count > 0)
    // L'ordre du catalogue, donc de la moins chère à la plus chère : la ligne se
    // lit toujours dans le même sens d'un dresseur à l'autre.
    .sort(([a], [b]) => Object.keys(config).indexOf(a) - Object.keys(config).indexOf(b))
    .map(([key, count]) => `${count}\u00D7${config[key]?.emoji ?? key}`)
    .join(" ");
}

function participantsField(spending) {
  const participants = spending?.participants ?? [];
  if (!participants.length) return "*Personne n'a tenté sa chance.*";

  const lines = participants.slice(0, PARTICIPANTS_SHOWN).map((row, index) => {
    const medal = ["\u{1F947}", "\u{1F948}", "\u{1F949}"][index] ?? "\u25AA\uFE0F";
    return `${medal} <@${row.user_id}> (${ballsLine(row.balls)})`;
  });

  const rest = participants.length - PARTICIPANTS_SHOWN;
  if (rest > 0) lines.push(`*et ${rest} autre${rest > 1 ? "s" : ""}*`);
  return lines.join("\n");
}

// Ce que tenait le Pokémon, une fois l'affaire close. Avant, personne ne doit le
// savoir : l'annonce ne le montre pas, sans quoi un objet rare ferait monter les
// enchères sur un Pokémon commun. Après, tout le monde le voit — y compris quand
// il s'enfuit avec, ce qui est la moitié du sel de l'affaire.
function heldItemField(spawn, { fled = false, dropped = false } = {}) {
  const item = getItem(spawn.held_item);
  if (!item) return [];
  return [
    {
      // Trois états, et le troisième n'est pas cosmétique : annoncer « et il
      // emporte » d'un objet qui gît dans le salon, bouton compris, ferait
      // renoncer à le ramasser.
      name: dropped ? "Et il lâche" : fled ? "Et il emporte" : "Il tenait",
      value: `${item.emoji} **${item.label}**`,
      inline: true,
    },
  ];
}

// La capture, annoncée par la ball qui l'a emportée.
//
// Tout tient dans la DESCRIPTION et non dans le titre, et ce n'est pas une
// question de goût : Discord ne rend ni les emoji personnalisés ni les mentions
// dans un titre d'embed, qui afficherait « <:superball:155…> » et l'identifiant
// brut du dresseur. La ligne dit donc à elle seule avec quoi et par qui — ce qui
// rendait la phrase d'avant, « Untel l'a attrapé avec une Super Ball »,
// entièrement redondante.
export function buildCaughtEmbed(spawn, species, winnerId, ballKey, spending) {
  const isShiny = Boolean(spawn.is_shiny);
  const ball = getPokemonConfig().capture.balls[ballKey];
  const total = spending?.total ?? 0;

  return new EmbedBuilder()
    .setDescription(
      `${ball?.emoji ?? ""} **${displayName(species, isShiny)}** a été capturé par <@${winnerId}> !`
    )
    .setColor(embedColor(species, isShiny))
    .setThumbnail(spriteUrl(species, isShiny))
    .addFields(
      { name: "Lancers", value: `${spawn.throw_count}`, inline: true },
      ...heldItemField(spawn),
      { name: "Participants", value: participantsField(spending), inline: false }
    )
    .setFooter({
      // Le total reste visible : c'est la mesure du puits, raison d'être du système.
      text: `Spawn #${spawn.id} · Pokédex n°${species.id} · ${formatPoints(total)} pts partis en fumée`,
    });
}

export function buildFledEmbed(spawn, species, spending, { dropped = false } = {}) {
  const isShiny = Boolean(spawn.is_shiny);
  const total = spending?.total ?? 0;

  return new EmbedBuilder()
    .setTitle(`\u{1F4A8} ${displayName(species, isShiny)} s'est enfui...`)
    .setDescription("Personne n'a réussi à le capturer à temps.")
    .setColor(0x4f545c)
    .setThumbnail(spriteUrl(species, isShiny))
    .addFields(
      { name: "Lancers", value: `${spawn.throw_count}`, inline: true },
      ...heldItemField(spawn, { fled: true, dropped }),
      { name: "Participants", value: participantsField(spending), inline: false }
    )
    .setFooter({
      text: `Spawn #${spawn.id} · Pokédex n°${species.id} · ${formatPoints(total)} pts partis en fumée`,
    });
}

// ====================== OBJET AU SOL ======================

// Un objet lâché par un Pokémon qui s'en va. Message public, bouton unique : la
// course est ouverte à tout le monde, y compris à qui n'a pas lancé une ball.
export function buildDropEmbed(item, { claimedBy = null } = {}) {
  const embed = new EmbedBuilder().setColor(claimedBy ? 0x4f545c : 0xc27c0e);
  if (claimedBy) {
    return embed.setDescription(
      `${item.emoji} <@${claimedBy}> ramasse **${item.label}** !`
    );
  }
  return embed.setDescription(
    `${item.emoji} Il a laissé tomber **${item.label}** !\n*Au plus rapide.*`
  );
}

export function buildDropRow(dropId, { disabled = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`poke_drop|${dropId}`)
      .setLabel("Ramasser")
      .setEmoji("\u{1F91A}")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled)
  );
}

// ====================== INVENTAIRE ======================

// L'inventaire d'un dresseur. Une ligne par objet : icône, nom, quantité, puis à
// quoi il sert — un objet dont on ne sait pas ce qu'il fait n'est qu'un chiffre.
//
// L'ordre vient du catalogue et non de la base, qui rendrait un tri
// alphabétique sur les clés : « ball_hyper » avant « ball_poke » n'a de sens
// pour personne.
//
// Une clé absente du catalogue s'affiche quand même, en brut. Elle ne devrait
// pas exister, mais si elle existe c'est qu'un renommage a laissé du monde avec
// quelque chose en poche : le faire disparaître en silence serait le pire des
// trois comportements possibles.
export function buildInventoryEmbed(rows, { user = null } = {}) {
  const embed = new EmbedBuilder()
    .setTitle(
      user
        ? `\u{1F392} Inventaire de ${user.displayName ?? user.username}`
        : "\u{1F392} Ton inventaire"
    )
    .setColor(0xc27c0e);

  if (!rows.length) {
    return embed.setDescription(
      user
        ? "*Son inventaire est vide.*"
        : "*Ton inventaire est vide.* Les objets se trouvent, ils ne s'achètent pas."
    );
  }

  const total = rows.reduce((sum, row) => sum + row.count, 0);
  embed.setDescription(`**${total}** objet${total > 1 ? "s" : ""} en poche.`);

  for (const row of sortByCatalogue(rows)) {
    const item = getItem(row.item_key);
    const value = item?.description ?? "*Objet retiré du catalogue.*";
    embed.addFields({
      name: item
        ? `${item.emoji} ${item.label} \u00D7${row.count}`
        : `\u2754 \`${row.item_key}\` \u00D7${row.count}`,
      // La valeur de revente n'est écrite qu'une fois, là où elle est décidée.
      value: item?.sellValue
        ? `${value}\n*Se revend **${item.sellValue.toLocaleString("fr-FR")}** points pièce.*`
        : value,
      inline: false,
    });
  }
  return embed;
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
  // Le cadenas des espèces qu'aucune apparition ne donnera jamais. Sans lui, un
  // dresseur peut chasser des mois un Mackogneur qui n'apparaîtra pas : la seule
  // façon de l'obtenir est de fusionner des Machopeur, et rien ne le disait.
  const locked = slice.some(isFusionOnly);
  const lines = slice.map((species) => {
    const cadenas = isFusionOnly(species) ? " \u{1F512}" : "";
    const entry = stats.owned.get(species.id);
    if (!entry || (entry.normal === 0 && entry.shiny === 0)) {
      // On affiche quand même le nom : les joueurs veulent savoir quoi chasser.
      return `\`#${String(species.id).padStart(3, "0")}\` ❔ ${species.name}${cadenas}`;
    }
    const quantity = entry.normal > 1 ? ` ×${entry.normal}` : "";
    const shiny = entry.shiny > 0 ? ` ✨${entry.shiny > 1 ? entry.shiny : ""}` : "";
    return (
      `\`#${String(species.id).padStart(3, "0")}\` ✅ **${species.name}**${cadenas}` +
      `${quantity}${shiny}`
    );
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
    // La légende ne s'affiche que sur les pages qui en portent un : elle n'a rien
    // à expliquer sur les quatre cinquièmes du Pokédex.
    .setFooter({
      text:
        `Page ${page + 1}/${dexPageCount()}` +
        (locked ? " · 🔒 ne s'obtient que par fusion" : ""),
    });

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

// Un éphémère se ferme d'un geste, et personne ne peut le rouvrir à la place de
// son destinataire : le bouton du parc et /safari le refont, avec la visite là
// où elle en était. Sans cette phrase, le dresseur croirait avoir perdu les
// actions déjà jouées en retrouvant un plateau entamé.
const SAFARI_RESUMED = "\u{1F3D5}\uFE0F Tu reprends ta visite là où tu l'avais laissée.";

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
//
// `content` fait partie de la vue, et vaut null par défaut : les actions
// réécrivent le même message, et une ligne « tu reprends ta visite » laissée par
// une reprise resterait affichée jusqu'à la fin de la partie si personne ne
// l'effaçait. Les appelants qui ont leur propre phrase l'écrivent APRÈS avoir
// étalé la vue.
export function buildSafariView(
  session,
  { result = null, catches = [], owned = null, resumed = false } = {}
) {
  const config = getSafariConfig();
  const intro = result ? safariOutcomeLine(result, config) : null;
  const finie = isSafariFinished(session);
  const species = finie ? null : getSpecies(session.encounter_species_id);
  const content = resumed ? SAFARI_RESUMED : null;

  if (!species) {
    // Le bouton n'apparaît que sur une visite réellement terminée et pas encore
    // partagée — la même garde que prepareShare, et le même prédicat, pas une
    // copie. On tombe aussi ici quand l'espèce en cours est introuvable :
    // proposer un partage que la base refuserait ensuite serait une promesse en
    // l'air.
    return {
      content,
      embeds: [buildSafariRecapEmbed(session, catches, { intro, config })],
      components: finie && !session.shared_at ? [buildSafariShareRow(session)] : [],
    };
  }
  return {
    content,
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
