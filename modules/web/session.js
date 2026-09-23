// Sessions de l'API web : un jeton signé, rien en mémoire ni en base.
//
// Le jeton porte l'identité Discord et une échéance, et c'est sa signature
// HMAC qui le rend infalsifiable : le serveur n'a rien à retenir entre deux
// requêtes, et un redémarrage du bot ne déconnecte personne. Changer
// WEB_SESSION_SECRET, en revanche, déconnecte tout le monde d'un coup — c'est
// le bouton d'arrêt d'urgence en cas de fuite.
import crypto from "crypto";

const encode = (value) => Buffer.from(value).toString("base64url");
const decode = (value) => Buffer.from(value, "base64url").toString("utf8");

function secret() {
  const value = process.env.WEB_SESSION_SECRET ?? "";
  // Un secret court se devine : mieux vaut refuser de signer que de signer mal.
  if (value.length < 32) throw new Error("WEB_SESSION_SECRET doit faire au moins 32 caractères.");
  return value;
}

const signature = (payload) =>
  crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

// Un jeton `payload.signature`, valable `ttlMs` millisecondes.
export function signToken(data, ttlMs) {
  const payload = encode(JSON.stringify({ ...data, exp: Date.now() + ttlMs }));
  return `${payload}.${signature(payload)}`;
}

// Les données du jeton, ou null s'il est absent, falsifié ou expiré. La
// comparaison de signatures se fait à temps constant : une comparaison
// ordinaire s'arrête au premier caractère différent, et ce délai se mesure.
export function verifyToken(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = Buffer.from(signature(payload));
  const given = Buffer.from(sig ?? "");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(decode(payload));
    return Number(data.exp) > Date.now() ? data : null;
  } catch {
    return null;
  }
}

export function parseCookies(header = "") {
  const cookies = {};
  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name) cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

// HttpOnly : aucun script de la page ne lit le jeton. SameSite=Lax : un autre
// site ne peut pas faire partir une requête qui l'emporte. Secure dès que le
// site est servi en HTTPS, c'est-à-dire partout sauf en développement local.
export function serializeCookie(name, value, { maxAgeSeconds, secure }) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}
