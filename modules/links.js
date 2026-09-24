// La réécriture des liens X/Twitter et Instagram vers leurs miroirs, dont les
// aperçus s'affichent dans Discord.
//
// Chaque lien est analysé (new URL) et son hôte comparé exactement : une
// expression régulière sur le texte prenait aussi « https://x.com.pirate.net »,
// que le bot republiait en « https://vxtwitter.com.pirate.net » sous le nom du
// membre, ou un « x.com » glissé au milieu d'une autre adresse.
const LINK = /https:\/\/[^\s<>]+/gi;

// Réécrit vers `to` les liens de `text` dont l'hôte est dans `hosts` — et dont
// le chemin commence par `path`, s'il est donné. Le reste du lien est gardé tel
// quel. Rend le texte réécrit, ou null s'il n'y avait rien à réécrire.
export function rewriteLinks(text, { hosts, to, path = null }) {
  let changed = false;
  const rewritten = String(text).replace(LINK, (raw) => {
    let url;
    try {
      url = new URL(raw);
    } catch {
      return raw;
    }
    if (!hosts.includes(url.hostname) || (path && !url.pathname.startsWith(path))) return raw;
    changed = true;
    return raw.replace(/^https:\/\/[^/?#]+/i, `https://${to}`);
  });
  return changed ? rewritten : null;
}

export const rewriteTwitter = (text) =>
  rewriteLinks(text, {
    hosts: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
    to: "vxtwitter.com",
  });

// Les reels seulement : le miroir ne sait rien faire d'autre.
export const rewriteInstagram = (text) =>
  rewriteLinks(text, {
    hosts: ["instagram.com", "www.instagram.com"],
    to: "kkinstagram.com",
    path: "/reel/",
  });
