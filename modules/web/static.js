// Les fichiers du site (web/), servis par le même serveur que l'API.
//
// Une seule adresse pour le site et l'API : le reverse proxy n'a qu'une règle,
// le domaine vers ce port, et le cookie de session reste celui du site, sans
// CORS. Le site est fait de fichiers statiques sans étape de compilation :
// `git pull` le met à jour en même temps que le bot, sans rien construire.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web");

// Seules ces extensions se servent : un fichier d'un autre type posé par
// mégarde dans web/ reste invisible plutôt que téléchargeable.
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// Scripts et styles du site seulement ; images du dépôt de sprites et du CDN de
// Discord (avatars, emoji du serveur). Une injection de HTML, si elle passait un
// jour, ne pourrait exécuter aucun script ni envoyer la page ailleurs.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https://raw.githubusercontent.com https://cdn.discordapp.com",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const HEADERS = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  // Revalidé à chaque visite : une release se voit aussitôt, et l'ETag évite de
  // retélécharger ce qui n'a pas changé. Cloudflare ne garde pas en cache une
  // réponse `no-cache`, donc il ne peut pas servir une version périmée.
  "Cache-Control": "no-cache",
};

// Le fichier visé, ou la page d'accueil pour une adresse sans extension : les
// pages du site (/boite, /pokedex…) sont dessinées par app.js, qui lit
// l'adresse. Un chemin qui sortirait de web/ ou viserait un fichier caché ne
// mène à rien.
function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const file = path.resolve(ROOT, `.${path.posix.normalize(decoded)}`);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return null;
  const hidden = path
    .relative(ROOT, file)
    .split(path.sep)
    .some((part) => part.startsWith("."));
  if (hidden) return null;
  if (!path.extname(file)) return path.join(ROOT, "index.html");
  return TYPES[path.extname(file)] ? file : null;
}

function notFound(res) {
  res.writeHead(404, { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" });
  res.end("Introuvable.");
}

export function serveStatic(req, res, pathname) {
  const file = resolveFile(pathname);
  if (!file) return notFound(res);
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return notFound(res);
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = { ...HEADERS, ETag: etag, "Content-Type": TYPES[path.extname(file)] };
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    res.writeHead(200, { ...headers, "Content-Length": stat.size });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
  });
}
