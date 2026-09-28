// La réécriture des liens X/Twitter et Instagram vers leurs miroirs, dont les
// aperçus s'affichent dans Discord, et le bouton qui traduit les tweets
// étrangers.
//
// Chaque lien est analysé (new URL) et son hôte comparé exactement : une
// expression régulière sur le texte prenait aussi « https://x.com.pirate.net »,
// que le bot republiait en « https://vxtwitter.com.pirate.net » sous le nom du
// membre, ou un « x.com » glissé au milieu d'une autre adresse.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { getConfig } from "./config.js";
import { handleException } from "./utils.js";

const RULES = [
  {
    hosts: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
    to: "vxtwitter.com",
    // Le tweet que désigne le lien (…/status/123, /i/web/status/123), qui
    // aura peut-être son bouton de traduction. Un profil ou une recherche n'en
    // ont pas.
    tweet: /\/status(?:es)?\/(\d+)/i,
  },
  // Les reels seulement : le miroir ne sait rien faire d'autre.
  { hosts: ["instagram.com", "www.instagram.com"], to: "kkinstagram.com", path: "/reel/" },
];

// Un lien, jusqu'au premier blanc, chevron, parenthèse, crochet, virgule ou
// accent grave : ce qui l'entoure dans un message ne lui appartient pas, et
// deux liens collés par une virgule sont deux liens.
const LINK = /https:\/\/[^\s<>()[\],`]+/gi;

// Un lien masqué, [texte](adresse) : son texte peut dire x.com et mener
// ailleurs, et le bot le republierait sous son nom.
const MASKED = /\]\(\s*<?https?:\/\//i;

// Le texte, liens X et Instagram réécrits vers leurs miroirs, avec les tweets
// qu'ils désignent, ou null s'il n'y avait rien à réécrire. Seul l'hôte
// change : le reste du lien reste tel quel.
export function rewriteSocialLinks(text) {
  const source = String(text);
  if (MASKED.test(source)) return null;
  let changed = false;
  const tweetIds = [];
  const rewritten = source.replace(LINK, (raw, offset) => {
    // Entre chevrons, l'aperçu est coupé exprès : le réécrire ne servirait à rien.
    if (source[offset - 1] === "<") return raw;
    let url;
    try {
      url = new URL(raw);
    } catch {
      return raw;
    }
    // « x.com. » est le même hôte, écrit avec son point final.
    const host = url.hostname.replace(/\.$/, "");
    const path = url.pathname.toLowerCase();
    const rule = RULES.find(
      (entry) => entry.hosts.includes(host) && (!entry.path || path.startsWith(entry.path))
    );
    if (!rule) return raw;
    changed = true;
    // Le même tweet collé deux fois n'a qu'un bouton.
    const id = rule.tweet && url.pathname.match(rule.tweet)?.[1];
    if (id && !tweetIds.includes(id)) tweetIds.push(id);
    // L'autorité s'arrête aussi à « \ », comme pour l'analyseur d'URL.
    return raw.replace(/^https:\/\/[^/\\?#]+/i, `https://${rule.to}`);
  });
  return changed ? { text: rewritten, tweetIds } : null;
}

// ====================== TRADUCTION ======================
//
// Sous la copie d'un tweet qui n'est pas en français, un bouton « Traduire »
// répond en éphémère par sa traduction. Le salon reste tel qu'il était, et
// seul celui qui en a besoin la lit.

const TWEET_API = "https://api.fxtwitter.com";
export const TRANSLATE_BUTTON = "tweet_translate";

// Discord range au plus 5 boutons par rangée.
const BUTTONS_PER_ROW = 5;
// Ce que tient un embed : 4 096 caractères de description, 256 de nom d'auteur.
const EMBED_DESCRIPTION_MAX_LENGTH = 4096;
const EMBED_AUTHOR_MAX_LENGTH = 256;

// « en » devient « anglais ». Un code inconnu ne donne rien plutôt que
// lui-même : mieux vaut taire la langue qu'afficher « qme ».
const LANGUAGE_NAMES = new Intl.DisplayNames(["fr"], { type: "language", fallback: "none" });

function languageName(code) {
  try {
    return LANGUAGE_NAMES.of(code);
  } catch {
    // Un code mal formé lève au lieu de rendre undefined.
    return undefined;
  }
}

// Le pseudo X de l'auteur, s'il en a la forme : il finit dans une adresse et
// sur un bouton.
const handleOf = (tweet) => {
  const handle = tweet?.author?.screen_name;
  return typeof handle === "string" && /^\w+$/.test(handle) ? handle : undefined;
};

const isFrench = (lang) => typeof lang === "string" && lang.toLowerCase().split("-")[0] === "fr";

// La langue d'un tweet à traduire, nommée en français, ou undefined s'il n'y a
// rien à traduire. Twitter marque aussi « und » (indéterminée), « zxx » (sans
// texte) et des codes privés (qme : que des médias, qht : que des hashtags…) :
// Intl ne sait nommer que « zxx », qu'il faut donc écarter à la main.
function foreignLanguage(tweet) {
  if (!String(tweet?.text ?? "").trim() || isFrench(tweet.lang) || tweet.lang === "zxx") {
    return undefined;
  }
  return languageName(tweet.lang);
}

// Un tweet lu par l'API de FxTwitter, traduit en français sur demande, ou null
// s'il n'est plus lisible (supprimé, compte protégé). Une API en panne ou
// muette lève.
async function fetchTweet(id, { translate = false, timeoutSeconds }) {
  const response = await fetch(`${TWEET_API}/status/${id}${translate ? "/fr" : ""}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PCR-bot/1.0)" },
    // Le délai couvre aussi la lecture du corps.
    signal: AbortSignal.timeout(timeoutSeconds * 1000),
  });
  if (response.status === 401 || response.status === 404) return null;
  if (!response.ok) throw new Error(`API FxTwitter : ${response.status}`);
  const { tweet } = await response.json();
  return tweet ?? null;
}

// Les boutons « Traduire » des tweets étrangers d'une copie, ou null s'il n'y
// en a aucun. Ne lève jamais : une API muette laisse la copie sans bouton,
// comme un tweet français.
export async function translateButtons(tweetIds) {
  const { enabled, maxTweets, lookupTimeoutSeconds } = getConfig().links.translation;
  if (!enabled || tweetIds.length === 0) return null;
  const tweets = await Promise.all(
    tweetIds.slice(0, Math.min(maxTweets, BUTTONS_PER_ROW)).map((id, index) =>
      fetchTweet(id, { timeoutSeconds: lookupTimeoutSeconds })
        .then(
          (tweet) => foreignLanguage(tweet) && { id, handle: handleOf(tweet), position: index + 1 }
        )
        .catch((err) => {
          handleException(`Langue du tweet ${id} :`, err);
          return null;
        })
    )
  );
  const foreign = tweets.filter(Boolean);
  if (foreign.length === 0) return null;
  return new ActionRowBuilder().addComponents(
    foreign.map(({ id, handle, position }) =>
      new ButtonBuilder()
        .setCustomId(`${TRANSLATE_BUTTON}|${id}`)
        .setLabel(buttonLabel(tweetIds, foreign, handle, position))
        .setStyle(ButtonStyle.Secondary)
    )
  );
}

// Plusieurs tweets dans la copie, même un seul étranger : chaque bouton dit
// lequel il traduit, par son auteur, ou par sa place quand l'auteur ne suffit
// pas à le distinguer.
function buttonLabel(tweetIds, foreign, handle, position) {
  if (tweetIds.length === 1) return "Traduire";
  const twin = foreign.some((other) => other.position !== position && other.handle === handle);
  return handle && !twin ? `Traduire @${handle}` : `Traduire le tweet ${position}`;
}

// Un lien dans une traduction, sans la ponctuation qui le suit dans la phrase.
const URL_IN_TEXT = /(https?:\/\/[^\s<>]*[^\s<>.,:;"')\]!?])/gi;

// Tout ce que Discord mettrait en forme, échappé : le texte vient de l'auteur
// du tweet et part sous le nom du bot. Un lien masqué y mènerait ailleurs que
// là où il le dit, et « < » y formerait mentions, salons et emojis. Les liens,
// eux, restent tels quels : l'échappement les casserait.
function escapeText(text) {
  return text
    .split(URL_IN_TEXT)
    .map((part, index) =>
      index % 2
        ? part
        : part
            .replace(/[\\*_~`|[<]/g, "\\$&")
            // Titres, sous-texte, listes et citations ne se forment qu'en début de ligne.
            .replace(/^([ \t]*)([#>-])/gm, "$1\\$2")
            .replace(/^([ \t]*\d+)\./gm, "$1\\.")
    )
    .join("");
}

// Coupé à `max` caractères, « … » compris. Ni au milieu d'un lien, qui
// tronqué mènerait ailleurs, ni d'un emoji. Un « \ » laissé en fin échappe le
// « … », qui s'affiche pareil.
function truncate(text, max) {
  if (text.length <= max) return text;
  const start = text.slice(0, max - 1).replace(/https?:\/\/\S*$|[\uD800-\uDBFF]$/i, "");
  return `${start.trimEnd()}…`;
}

const UNAVAILABLE = "La traduction ne répond pas, réessaie dans un instant.";

// La réponse au clic : la traduction, ou pourquoi il n'y en a pas.
function translationReply(id, tweet) {
  if (!tweet) {
    return { content: "Ce tweet n'est plus lisible : supprimé, ou son compte est protégé." };
  }
  const translation = tweet.translation;
  if (isFrench(tweet.lang) || isFrench(translation?.source_lang)) {
    return { content: "Ce tweet est déjà en français." };
  }
  // Sans traduction, c'est l'API qui a échoué, pas le tweet qui s'y refuse.
  if (typeof translation?.text !== "string") return { content: UNAVAILABLE };
  const text = translation.text.trim();
  // Des emojis, un lien ou un nom propre ressortent tels quels.
  if (!text || text === String(tweet.text ?? "").trim()) {
    return { content: "Ce tweet n'a rien à traduire." };
  }
  const embed = new EmbedBuilder().setDescription(
    truncate(escapeText(text), EMBED_DESCRIPTION_MAX_LENGTH)
  );
  const handle = handleOf(tweet);
  if (handle) {
    const name =
      typeof tweet.author.name === "string" ? `${tweet.author.name} (@${handle})` : `@${handle}`;
    embed.setAuthor({
      name: truncate(name, EMBED_AUTHOR_MAX_LENGTH),
      url: `https://x.com/${handle}/status/${id}`,
    });
  }
  // « en anglais », « en japonais » : sans élision à gérer.
  const language = languageName(translation.source_lang || tweet.lang);
  embed.setFooter({
    text: language ? `Traduction automatique · original en ${language}` : "Traduction automatique",
  });
  return { embeds: [embed] };
}

// Le clic sur « Traduire » : la traduction, visible de celui qui clique seul.
export async function replyTweetTranslation(interaction) {
  const [, id] = interaction.customId.split("|");
  // Rien d'autre qu'un numéro de tweet ne part vers l'API.
  if (!/^\d+$/.test(id ?? "")) {
    await interaction
      .reply({ content: "Ce bouton n'est plus valable.", flags: MessageFlags.Ephemeral })
      .catch(() => {});
    return;
  }
  // L'API peut dépasser les 3 s que Discord laisse pour répondre.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  // Une fois différée, l'interaction attend sa réponse : aucune erreur ne doit
  // la laisser sur « réfléchit… ».
  let reply;
  try {
    const { translateTimeoutSeconds } = getConfig().links.translation;
    const tweet = await fetchTweet(id, {
      translate: true,
      timeoutSeconds: translateTimeoutSeconds,
    });
    reply = translationReply(id, tweet);
  } catch (err) {
    handleException(`Traduction du tweet ${id} :`, err);
    reply = { content: UNAVAILABLE };
  }
  await interaction.editReply(reply).catch(() => {});
}
