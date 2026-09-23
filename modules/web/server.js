// Le serveur du site et de son API, dans le même processus que le bot.
//
// Même processus et même base : l'API appelle les fonctions du jeu en direct,
// sans rien dupliquer, et le bot sert à vérifier qu'un visiteur est bien membre
// du serveur. Tout ce qui n'est pas sous /api/ est le site (static.js). Rien ne
// démarre sans WEB_PORT : sans lui, le bot tourne exactement comme avant.
//
// Node pur (http, crypto, fetch) : pas de framework pour une vingtaine de
// routes, donc pas de dépendance de plus à tenir à jour.
//
// Sécurité, en couches :
// - l'identité vient de Discord (OAuth2), la session est un jeton signé
//   (session.js), en cookie HttpOnly et SameSite=Lax ;
// - seuls les membres du serveur (GUILD_ID) obtiennent une session ;
// - une écriture exige un corps JSON et, s'il est fourni, un en-tête Origin égal
//   à WEB_BASE_URL : un formulaire d'un autre site ne peut produire ni l'un ni
//   l'autre ;
// - corps plafonné, écritures limitées par minute et par dresseur, et aucune
//   trace de pile dans les réponses.
import http from "http";
import crypto from "crypto";
import { handleException, log } from "../utils.js";
import { getConfig } from "../config.js";
import { HttpError, routes } from "./api.js";
import { authorizeUrl, fetchDiscordUser } from "./discord.js";
import { parseCookies, serializeCookie, signToken, verifyToken } from "./session.js";
import { serveStatic } from "./static.js";

const SESSION_COOKIE = "pcr_session";
const STATE_COOKIE = "pcr_oauth_state";
const MAX_BODY_BYTES = 16 * 1024;
const STATE_TTL_MS = 10 * 60 * 1000;

const webConfig = () => getConfig().web;
const baseUrl = () => String(process.env.WEB_BASE_URL || "").replace(/\/+$/, "");

// Vrai une fois le serveur à l'écoute : sans WEB_PORT, ou avec une variable
// manquante, il ne démarre pas, et son adresse mènerait à une page morte.
let listening = false;

// L'adresse publique du site pour /pk web, ou null s'il n'est pas en ligne.
export const siteUrl = () => (listening ? baseUrl() : null);
const secureCookies = () => baseUrl().startsWith("https://");

// Les chemins déclarés dans api.js (« /api/users/:userId/box ») deviennent des
// expressions régulières une fois pour toutes, avec leurs paramètres nommés.
const compiled = routes.map((route) => {
  const names = [];
  const pattern = route.path.replace(/:([a-zA-Z]+)/g, (_, name) => {
    names.push(name);
    return "([^/]+)";
  });
  return { ...route, regex: new RegExp(`^${pattern}$`), names };
});

function match(method, pathname) {
  let allowed = false;
  for (const route of compiled) {
    const found = route.regex.exec(pathname);
    if (!found) continue;
    if (route.method !== method) {
      allowed = true;
      continue;
    }
    // Un « % » mal formé ferait lever decodeURIComponent : c'est une requête
    // invalide, pas une panne.
    let params;
    try {
      params = Object.fromEntries(
        route.names.map((name, index) => [name, decodeURIComponent(found[index + 1])])
      );
    } catch {
      throw new HttpError(400, "Adresse invalide.");
    }
    return { route, params };
  }
  return { allowed };
}

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(payload);
}

function redirect(res, location, cookies = []) {
  res.writeHead(302, { Location: location, "Set-Cookie": cookies, "Cache-Control": "no-store" });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const onData = (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // On cesse de garder le corps sans couper la connexion : le reste se
        // vide dans le vide, et le client reçoit un 413 lisible plutôt qu'une
        // socket fermée au nez.
        req.off("data", onData);
        req.resume();
        reject(new HttpError(413, "Requête trop volumineuse."));
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Les écritures par dresseur et par minute. En mémoire, et c'est voulu : ce
// n'est pas un état de jeu, seulement un garde-fou contre une boucle ou un
// script, et le perdre au redémarrage ne coûte rien.
const writes = new Map();
function allowWrite(userId) {
  const limit = Math.max(1, Number(webConfig()?.writesPerMinute) || 60);
  const now = Date.now();
  const recent = (writes.get(userId) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= limit) return false;
  recent.push(now);
  writes.set(userId, recent);
  return true;
}

// Un visiteur n'obtient une session que s'il est membre du serveur. C'est le
// bot qui répond, il connaît déjà la liste.
async function isGuildMember(bot, userId) {
  try {
    const guild = await bot.guilds.fetch(process.env.GUILD_ID);
    return Boolean(await guild.members.fetch(userId));
  } catch {
    return false;
  }
}

// Après connexion, on ne renvoie que vers une page du site : un chemin relatif,
// jamais une adresse complète, sans quoi l'API servirait de tremplin vers
// n'importe quel site.
const safeReturnPath = (value) =>
  typeof value === "string" && /^\/(?!\/)[^\s\\]*$/.test(value) ? value : "/";

// ---------------------- Connexion ----------------------

function login(req, res, url) {
  const state = crypto.randomBytes(16).toString("hex");
  const token = signToken({ state, back: safeReturnPath(url.searchParams.get("back")) }, STATE_TTL_MS);
  redirect(res, authorizeUrl(state), [
    serializeCookie(STATE_COOKIE, token, {
      maxAgeSeconds: STATE_TTL_MS / 1000,
      secure: secureCookies(),
    }),
  ]);
}

async function callback(req, res, url, bot) {
  const cookies = parseCookies(req.headers.cookie);
  const expected = verifyToken(cookies[STATE_COOKIE]);
  const clearState = serializeCookie(STATE_COOKIE, "", { maxAgeSeconds: 0, secure: secureCookies() });
  // Un échec renvoie sur l'accueil du site, qui l'explique : le visiteur est
  // dans un navigateur, pas devant un client d'API, et une page de JSON brut ne
  // lui dirait rien.
  const fail = (reason) => redirect(res, `${baseUrl()}/?connexion=${reason}`, [clearState]);
  // Le `state` lie la réponse de Discord au navigateur qui a demandé la
  // connexion : sans lui, on pourrait connecter quelqu'un à un autre compte.
  if (!expected || expected.state !== url.searchParams.get("state")) return fail("expiree");
  const code = url.searchParams.get("code");
  if (!code) return fail("refusee");

  let user;
  try {
    user = await fetchDiscordUser(code);
  } catch (error) {
    handleException("Connexion web par Discord :", error);
    return fail("discord");
  }
  if (!(await isGuildMember(bot, user.id))) return fail("membre");

  const hours = Math.max(1, Number(webConfig()?.sessionHours) || 168);
  const session = signToken(user, hours * 3600 * 1000);
  log(`Web : connexion de ${user.username} (${user.id})`);
  redirect(res, `${baseUrl()}${expected.back}`, [
    clearState,
    serializeCookie(SESSION_COOKIE, session, {
      maxAgeSeconds: hours * 3600,
      secure: secureCookies(),
    }),
  ]);
}

// ---------------------- Requêtes ----------------------

async function handle(req, res, bot) {
  const url = new URL(req.url, "http://localhost");
  const method = req.method.toUpperCase();

  if (!url.pathname.startsWith("/api/")) {
    if (method !== "GET" && method !== "HEAD") {
      return send(res, 405, { error: "Méthode non autorisée." });
    }
    return serveStatic(req, res, url.pathname);
  }

  if (method === "GET" && url.pathname === "/api/auth/login") return login(req, res, url);
  if (method === "GET" && url.pathname === "/api/auth/callback") {
    return callback(req, res, url, bot);
  }
  if (method === "POST" && url.pathname === "/api/auth/logout") {
    return send(res, 204, undefined, {
      "Set-Cookie": serializeCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0, secure: secureCookies() }),
    });
  }

  const { route, params, allowed } = match(method, url.pathname);
  if (!route) {
    return send(res, allowed ? 405 : 404, { error: allowed ? "Méthode non autorisée." : "Introuvable." });
  }

  const session = verifyToken(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  const user = session ? { id: session.id, username: session.username, avatar: session.avatar } : null;
  if (route.auth && !user) throw new HttpError(401, "Connexion requise.");

  let body = {};
  if (route.write) {
    const origin = req.headers.origin;
    if (origin && origin !== new URL(baseUrl()).origin) {
      throw new HttpError(403, "Origine refusée.");
    }
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
      throw new HttpError(415, "Le corps doit être en JSON.");
    }
    if (!allowWrite(user.id)) throw new HttpError(429, "Trop d'actions, réessaie dans une minute.");
    const raw = await readBody(req);
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      throw new HttpError(400, "JSON invalide.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "Le corps doit être un objet JSON.");
    }
  }

  const query = Object.fromEntries(url.searchParams);
  const result = await route.handler({ user, params, query, body, bot });
  send(res, 200, result);
}

export function startWebServer(bot) {
  const port = Number(process.env.WEB_PORT);
  if (!port) return log("Site et API web désactivés (WEB_PORT absent)");

  // Sans ces réglages, la connexion ne peut pas marcher : mieux vaut ne pas
  // démarrer que servir une API où personne ne peut entrer.
  const missing = ["WEB_BASE_URL", "WEB_SESSION_SECRET", "DISCORD_CLIENT_SECRET", "CLIENT_ID", "GUILD_ID"]
    .filter((name) => !process.env[name]);
  if (missing.length) {
    return handleException(`API web non démarrée, variables manquantes : ${missing.join(", ")}`);
  }
  if (String(process.env.WEB_SESSION_SECRET).length < 32) {
    return handleException("API web non démarrée : WEB_SESSION_SECRET doit faire au moins 32 caractères.");
  }

  const server = http.createServer((req, res) => {
    handle(req, res, bot).catch((error) => {
      if (error instanceof HttpError) return send(res, error.status, { error: error.message });
      handleException(`API web, ${req.method} ${req.url} :`, error);
      send(res, 500, { error: "Erreur interne." });
    });
  });
  // Derrière le reverse proxy : on n'écoute que la machine elle-même, sauf
  // réglage contraire.
  server.listen(port, process.env.WEB_HOST || "127.0.0.1", () => {
    listening = true;
    log(`Site et API web à l'écoute sur ${process.env.WEB_HOST || "127.0.0.1"}:${port}`);
  });
  server.on("error", (error) => handleException("Serveur de l'API web :", error));
  return server;
}
