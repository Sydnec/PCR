// La réécriture des liens X/Twitter et Instagram vers leurs miroirs, dont les
// aperçus s'affichent dans Discord.
//
// Chaque lien est analysé (new URL) et son hôte comparé exactement : une
// expression régulière sur le texte prenait aussi « https://x.com.pirate.net »,
// que le bot republiait en « https://vxtwitter.com.pirate.net » sous le nom du
// membre, ou un « x.com » glissé au milieu d'une autre adresse.
const RULES = [
  { hosts: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"], to: "vxtwitter.com" },
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

// Le texte, liens X et Instagram réécrits vers leurs miroirs, ou null s'il n'y
// avait rien à réécrire. Seul l'hôte change : le reste du lien reste tel quel.
export function rewriteSocialLinks(text) {
  const source = String(text);
  if (MASKED.test(source)) return null;
  let changed = false;
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
    // L'autorité s'arrête aussi à « \ », comme pour l'analyseur d'URL.
    return raw.replace(/^https:\/\/[^/\\?#]+/i, `https://${rule.to}`);
  });
  return changed ? rewritten : null;
}
