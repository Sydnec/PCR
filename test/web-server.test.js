// Le serveur HTTP du site, démarré pour de vrai sur une prise locale, avec un faux
// Discord (l'OAuth2 et le serveur) : c'est la porte d'entrée de tout le reste, donc
// ce qu'on y vérifie, c'est ce qui la garde fermée — session, appartenance au
// serveur, administrateur, origine et type des écritures, taille du corps, cadence
// des écritures, chemins des fichiers statiques.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createSandbox, openDatabases, dbRun } from "./helpers.js";

const sandbox = createSandbox({ config: { pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } }, web: { writesPerMinute: 1000, accessDenialCacheSeconds: 60 } } });
const { points } = await openDatabases();

const freePort = () =>
  new Promise((resolve) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

// ---------------------- Faux Discord ----------------------

// Des codes OAuth « code-<id> » donnent le compte <id> ; « refuse » est refusé.
const discordCalls = { token: 0, user: 0 };
const fakeDiscord = http.createServer((req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "POST" && req.url === "/oauth2/token") {
    discordCalls.token++;
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const code = new URLSearchParams(raw).get("code");
      if (code === "refuse") return reply(400, { error: "invalid_grant" });
      reply(200, { access_token: `jeton-${code}` });
    });
    return;
  }
  if (req.method === "GET" && req.url === "/users/@me") {
    discordCalls.user++;
    const auth = req.headers.authorization ?? "";
    const id = auth.replace("Bearer jeton-code-", "");
    if (id === "401") return reply(401, {});
    return reply(200, { id, global_name: `Nom ${id}`, avatar: "av" });
  }
  reply(404, {});
});
await new Promise((resolve) => fakeDiscord.listen(0, "127.0.0.1", resolve));

const port = await freePort();
const ADMIN = "100000000000000001";
const MEMBER = "100000000000000002";
const NOROLE = "100000000000000003";
const GONE = "100000000000000004";
const BROKEN = "100000000000000005";
const OTHER = "100000000000000006";
Object.assign(process.env, {
  WEB_PORT: String(port),
  WEB_HOST: "127.0.0.1",
  WEB_BASE_URL: `http://127.0.0.1:${port}`,
  WEB_SESSION_SECRET: "s".repeat(40),
  DISCORD_CLIENT_SECRET: "secret",
  CLIENT_ID: "client-1",
  GUILD_ID: "guild-1",
  DEFAULT_ROLE_ID: "role-default",
  SYDNEC_USER_ID: ADMIN,
  DISCORD_API_BASE: `http://127.0.0.1:${fakeDiscord.address().port}`,
  DISCORD_AUTHORIZE_URL: "https://discord.test/oauth2/authorize",
});

const memberLookups = [];
const bot = {
  guilds: {
    fetch: async () => ({
      members: {
        fetch: async (id) => {
          memberLookups.push(id);
          if (id === GONE) throw Object.assign(new Error("Unknown Member"), { code: 10007 });
          if (id === BROKEN) throw new Error("Discord est tombé");
          const roles = new Set(id === NOROLE ? [] : ["role-default"]);
          return { displayName: `Dresseur ${id}`, displayAvatarURL: () => "https://cdn.test/a.png", roles: { cache: roles } };
        },
      },
    }),
  },
  channels: { fetch: async () => ({ send: async () => ({ id: "m" }), messages: { fetch: async (id) => ({ id, embeds: [], edit: async () => {} }) } }) },
};

const { startWebServer, siteAccessDenial, siteUrl } = await import("../modules/web/server.js");
const { signToken } = await import("../modules/web/session.js");

let server;
before(async () => {
  server = startWebServer(bot);
  await new Promise((resolve) => (server.listening ? resolve() : server.once("listening", resolve)));
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => fakeDiscord.close(resolve));
  server.closeAllConnections?.();
});

const BASE = `http://127.0.0.1:${port}`;
const cookieFor = (id, { ttl = 3_600_000, use = "session", extra = {} } = {}) =>
  `pcr_session=${encodeURIComponent(signToken({ id, username: "Test", avatar: null, ...extra }, ttl, use))}`;
const request = (path, { method = "GET", cookie, headers = {}, body, json } = {}) =>
  fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(json !== undefined ? { "content-type": "application/json", origin: BASE } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : body,
  });
const read = async (response) => {
  const text = await response.text();
  try {
    return { status: response.status, headers: response.headers, body: JSON.parse(text) };
  } catch {
    return { status: response.status, headers: response.headers, text };
  }
};

beforeEach(async () => {
  memberLookups.length = 0;
  for (const table of ["pokemon_owned", "points", "points_log"]) await dbRun(points, `DELETE FROM ${table}`);
});

describe("le démarrage", () => {
  it("l'adresse publique n'est donnée qu'une fois le serveur à l'écoute", () => {
    assert.equal(siteUrl(), BASE);
  });
});

describe("l'API sans connexion", () => {
  it("la santé est publique, et ne laisse rien en cache", async () => {
    const result = await read(await request("/api/health"));
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, generation: 1 });
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal(result.headers.get("x-content-type-options"), "nosniff");
  });

  it("les référentiels sont publics", async () => {
    assert.equal((await request("/api/species")).status, 200);
    assert.equal((await request("/api/catalogue")).status, 200);
  });

  it("une route inconnue est 404, une mauvaise méthode 405", async () => {
    assert.equal((await request("/api/nexiste/pas")).status, 404);
    assert.equal((await request("/api/health", { method: "POST", json: {} })).status, 405);
    assert.equal((await request("/api/me/evolve")).status, 405, "GET sur une route POST");
  });

  it("une route de joueur sans cookie est refusée : 401", async () => {
    for (const path of ["/api/me", "/api/me/pc", "/api/users/me/box", "/api/spawn", "/api/safari"]) {
      const result = await read(await request(path));
      assert.equal(result.status, 401, path);
      assert.deepEqual(result.body, { error: "Connexion requise." });
    }
    assert.deepEqual(memberLookups, [], "pas de session, pas d'appel à Discord");
  });

  it("une adresse mal encodée est une requête invalide, pas une panne", async () => {
    const result = await read(await request("/api/species/%E0%A4%A", { cookie: cookieFor(MEMBER) }));
    assert.equal(result.status, 400);
  });
});

describe("la session", () => {
  it("un membre du serveur avec le rôle entre", async () => {
    const result = await read(await request("/api/me", { cookie: cookieFor(MEMBER) }));
    assert.equal(result.status, 200);
    assert.equal(result.body.user.id, MEMBER);
    assert.equal(result.body.user.admin, false);
    assert.equal(result.body.balance, 0);
  });

  it("les jetons falsifiés, expirés ou d'un autre usage n'ouvrent rien", async () => {
    const cases = [
      `pcr_session=${encodeURIComponent("n.importe.quoi")}`,
      cookieFor(MEMBER, { ttl: -1 }),
      cookieFor(MEMBER, { use: "oauth-state" }),
      `${cookieFor(MEMBER)}x`,
      "pcr_session=",
    ];
    for (const cookie of cases) assert.equal((await request("/api/me", { cookie })).status, 401, cookie.slice(0, 40));
  });

  it("un identifiant qui n'est pas un identifiant Discord est refusé : sans lui on irait lire tous les membres", async () => {
    for (const id of ["abc", "123", "1".repeat(30), "../../x", ""]) {
      const response = await request("/api/me", { cookie: cookieFor(id) });
      assert.equal(response.status, 401, id);
    }
    assert.deepEqual(memberLookups, []);
  });

  it("un ancien jeton sans usage reste valable s'il porte un identifiant Discord", async () => {
    const legacy = signToken({ id: MEMBER }, 60_000, undefined);
    assert.equal((await request("/api/me", { cookie: `pcr_session=${encodeURIComponent(legacy)}` })).status, 200);
    const stateToken = signToken({ state: "abc" }, 60_000, undefined);
    assert.equal((await request("/api/me", { cookie: `pcr_session=${encodeURIComponent(stateToken)}` })).status, 401, "un ancien jeton d'état n'a pas d'identifiant");
  });

  it("un membre parti perd l'accès tout de suite : 401, cookie effacé", async () => {
    const response = await request("/api/me", { cookie: cookieFor(GONE) });
    const result = await read(response);
    assert.equal(result.status, 401);
    assert.match(result.body.error, /plus accès/);
    assert.match(response.headers.get("set-cookie"), /pcr_session=; .*Max-Age=0/);
  });

  it("un membre sans le rôle par défaut est dehors aussi", async () => {
    assert.equal((await request("/api/me", { cookie: cookieFor(NOROLE) })).status, 401);
  });

  it("une panne de Discord n'est pas une porte fermée : 502, la session reste", async () => {
    const response = await request("/api/me", { cookie: cookieFor(BROKEN) });
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("set-cookie"), null);
  });

  it("le refus d'un membre parti est retenu : Discord n'est pas réinterrogé à chaque requête", async () => {
    const goneCookie = cookieFor(GONE);
    await request("/api/me", { cookie: goneCookie });
    const before = memberLookups.filter((id) => id === GONE).length;
    await request("/api/me", { cookie: goneCookie });
    await request("/api/me", { cookie: goneCookie });
    assert.equal(memberLookups.filter((id) => id === GONE).length, before, "retenu `accessDenialCacheSeconds`");
  });

  it("l'état d'accès se lit directement aussi : null pour un membre en règle", async () => {
    assert.equal(await siteAccessDenial(bot, MEMBER), null);
    assert.equal(await siteAccessDenial(bot, NOROLE), "role");
    assert.equal(await siteAccessDenial(bot, GONE), "membre");
    await assert.rejects(() => siteAccessDenial(bot, BROKEN), /Discord est tombé/);
  });
});

describe("l'administrateur", () => {
  it("l'administration est fermée aux membres, ouverte à SYDNEC_USER_ID seul", async () => {
    const member = await read(await request("/api/admin/config", { cookie: cookieFor(MEMBER) }));
    assert.equal(member.status, 403);
    assert.match(member.body.error, /Réservé à l'administrateur/);
    const admin = await read(await request("/api/admin/config", { cookie: cookieFor(ADMIN) }));
    assert.equal(admin.status, 200);
    assert.ok(admin.body.tree);
    assert.equal((await request("/api/admin/config", { cookie: cookieFor(MEMBER, { extra: { admin: true } }) })).status, 403, "un jeton qui se dit admin ne l'est pas");
  });

  it("sans connexion, c'est 401 avant même la question du droit", async () => {
    assert.equal((await request("/api/admin/points")).status, 401);
  });

  it("l'administration d'un membre qui perd l'accès se ferme aussitôt", async () => {
    assert.equal((await request("/api/admin/points", { cookie: cookieFor(ADMIN) })).status, 200);
    assert.equal((await request("/api/admin/points", { cookie: cookieFor(OTHER) })).status, 403);
  });
});

describe("les écritures", () => {
  const post = (json, options = {}) => request("/api/me/pc/boxes/0/name", { method: "POST", cookie: cookieFor(MEMBER), json, ...options });

  it("une écriture valide passe", async () => {
    const result = await read(await post({ name: "Équipe" }));
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { name: "Équipe", custom: true });
  });

  it("une origine étrangère est refusée : un formulaire d'un autre site ne peut pas écrire", async () => {
    const response = await request("/api/me/pc/boxes/0/name", {
      method: "POST",
      cookie: cookieFor(MEMBER),
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ name: "Piraté" }),
    });
    assert.equal(response.status, 403);
    assert.match((await read(response)).body?.error ?? "", /Origine refusée/);
  });

  it("sans en-tête Origin (un client qui n'est pas un navigateur) l'écriture passe, avec sa session", async () => {
    const response = await request("/api/me/pc/boxes/0/name", {
      method: "POST",
      cookie: cookieFor(MEMBER),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Sans origine" }),
    });
    assert.equal(response.status, 200);
  });

  it("le corps doit être en JSON : 415", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      const response = await request("/api/me/pc/boxes/0/name", {
        method: "POST",
        cookie: cookieFor(MEMBER),
        headers: { "content-type": type, origin: BASE },
        body: "name=x",
      });
      assert.equal(response.status, 415, type);
    }
    const none = await request("/api/me/pc/boxes/0/name", { method: "POST", cookie: cookieFor(MEMBER), headers: { origin: BASE } });
    assert.equal(none.status, 415);
  });

  it("un JSON illisible ou qui n'est pas un objet : 400", async () => {
    const bad = (body) =>
      request("/api/me/pc/boxes/0/name", { method: "POST", cookie: cookieFor(MEMBER), headers: { "content-type": "application/json", origin: BASE }, body });
    assert.equal((await bad("{pas du json")).status, 400);
    assert.equal((await bad("[1,2]")).status, 400);
    assert.equal((await bad("42")).status, 400);
    assert.equal((await bad("null")).status, 400);
    assert.equal((await bad("")).status, 200, "un corps vide vaut un objet vide");
  });

  it("un corps trop volumineux : 413", async () => {
    const response = await post({ name: "x".repeat(40_000) });
    assert.equal(response.status, 413);
    assert.match((await read(response)).body.error, /trop volumineuse/);
  });

  it("une écriture sans connexion est refusée avant d'être lue", async () => {
    const response = await request("/api/me/pc/boxes/0/name", { method: "POST", json: { name: "x" } });
    assert.equal(response.status, 401);
  });

  it("un refus du jeu est un 409 avec son message, jamais une trace de pile", async () => {
    const result = await read(await request("/api/me/pc/move", { method: "POST", cookie: cookieFor(MEMBER), json: { pokemonId: 999999, pos: 3 } }));
    assert.equal(result.status, 409);
    assert.match(result.body.error, /n'est pas à toi/);
    assert.equal(JSON.stringify(result.body).includes("at "), false);
  });

  it("une panne interne est un 500 sobre : pas de pile, pas de détail", async () => {
    await dbRun(points, "ALTER TABLE pokemon_owned RENAME TO pokemon_owned_off");
    try {
      const result = await read(await request("/api/me/pc", { cookie: cookieFor(MEMBER) }));
      assert.equal(result.status, 500);
      assert.deepEqual(result.body, { error: "Erreur interne." });
    } finally {
      await dbRun(points, "ALTER TABLE pokemon_owned_off RENAME TO pokemon_owned");
    }
  });

  it("la cadence des écritures est limitée par dresseur, pas pour les autres", async () => {
    sandbox.writeConfig({ pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } }, web: { writesPerMinute: 3, accessDenialCacheSeconds: 60 } });
    try {
      const spammer = cookieFor(OTHER);
      const statuses = [];
      for (let index = 0; index < 5; index++) {
        statuses.push((await request("/api/me/pc/boxes/0/name", { method: "POST", cookie: spammer, json: { name: `n${index}` } })).status);
      }
      assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
      const calm = await request("/api/me/pc/boxes/0/name", { method: "POST", cookie: cookieFor(ADMIN), json: { name: "calme" } });
      assert.equal(calm.status, 200, "chacun sa cadence");
      assert.equal((await request("/api/me", { cookie: spammer })).status, 200, "les lectures ne comptent pas");
    } finally {
      sandbox.writeConfig({ pokemon: { generationOpenings: { 2: "2999-01-01T00:00:00+01:00" } }, web: { writesPerMinute: 1000, accessDenialCacheSeconds: 60 } });
    }
  });

  it("la déconnexion efface le cookie, sans corps", async () => {
    const response = await request("/api/auth/logout", { method: "POST" });
    assert.equal(response.status, 204);
    assert.match(response.headers.get("set-cookie"), /pcr_session=; .*Max-Age=0/);
  });

  it("les requêtes d'écriture sur les pages du site sont refusées : 405", async () => {
    assert.equal((await request("/boite", { method: "POST", json: {} })).status, 405);
  });
});

describe("la connexion par Discord", () => {
  const stateCookie = (response) => /pcr_oauth_state=([^;]+)/.exec(response.headers.get("set-cookie"))?.[1];
  const start = async (back) => {
    const response = await request(`/api/auth/login${back === undefined ? "" : `?back=${encodeURIComponent(back)}`}`);
    const location = new URL(response.headers.get("location"));
    return { response, location, cookie: `pcr_oauth_state=${stateCookie(response)}`, state: location.searchParams.get("state") };
  };
  const callback = (query, cookie) => request(`/api/auth/callback?${new URLSearchParams(query)}`, { cookie });
  const failedWith = (response) => new URL(response.headers.get("location")).searchParams.get("connexion");

  it("envoie vers Discord avec un état lié au navigateur par un cookie HttpOnly", async () => {
    const { response, location, state } = await start();
    assert.equal(response.status, 302);
    assert.equal(location.origin + location.pathname, "https://discord.test/oauth2/authorize");
    assert.equal(location.searchParams.get("scope"), "identify");
    assert.equal(location.searchParams.get("redirect_uri"), `${BASE}/api/auth/callback`);
    assert.match(state, /^[0-9a-f]{32}$/);
    const cookie = response.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.notEqual((await start()).state, state, "un état neuf à chaque connexion");
  });

  it("le tour complet : l'identité vient de Discord, la session est un cookie, on revient où l'on était", async () => {
    const { cookie, state } = await start("/boite?page=2");
    const response = await callback({ code: `code-${MEMBER}`, state }, cookie);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), `${BASE}/boite?page=2`);
    const cookies = response.headers.getSetCookie();
    const session = cookies.find((value) => value.startsWith("pcr_session="));
    assert.ok(session, "un cookie de session");
    assert.match(session, /HttpOnly/);
    assert.ok(cookies.some((value) => /pcr_oauth_state=; .*Max-Age=0/.test(value)), "l'état est effacé");

    const me = await read(await request("/api/me", { cookie: session.split(";")[0] }));
    assert.equal(me.status, 200);
    assert.equal(me.body.user.id, MEMBER);
    assert.equal(me.body.user.username, `Nom ${MEMBER}`);
  });

  it("l'adresse de retour reste une page du site : jamais un autre domaine", async () => {
    for (const back of ["https://evil.example/", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/ avec espace"]) {
      const { cookie, state } = await start(back);
      const response = await callback({ code: `code-${MEMBER}`, state }, cookie);
      assert.equal(response.headers.get("location"), `${BASE}/`, back);
    }
    const { cookie, state } = await start();
    assert.equal((await callback({ code: `code-${MEMBER}`, state }, cookie)).headers.get("location"), `${BASE}/`);
  });

  it("un état qui ne correspond pas, ou sans cookie, est refusé : « expiree »", async () => {
    const { cookie, state } = await start();
    assert.equal(failedWith(await callback({ code: `code-${MEMBER}`, state: "autre" }, cookie)), "expiree");
    assert.equal(failedWith(await callback({ code: `code-${MEMBER}`, state })), "expiree");
    assert.equal(failedWith(await callback({ code: `code-${MEMBER}` }, cookie)), "expiree");
    const forged = `pcr_oauth_state=${encodeURIComponent(signToken({ state, back: "/" }, 60_000, "session"))}`;
    assert.equal(failedWith(await callback({ code: `code-${MEMBER}`, state }, forged)), "expiree", "un jeton de session n'est pas un état");
  });

  it("sans code (refus sur Discord) : « refusee »", async () => {
    const { cookie, state } = await start();
    assert.equal(failedWith(await callback({ state, error: "access_denied" }, cookie)), "refusee");
  });

  it("un code que Discord refuse, ou un compte illisible : « discord »", async () => {
    const first = await start();
    assert.equal(failedWith(await callback({ code: "refuse", state: first.state }, first.cookie)), "discord");
    const second = await start();
    assert.equal(failedWith(await callback({ code: "code-401", state: second.state }, second.cookie)), "discord");
  });

  it("un compte qui n'est pas membre du serveur ou sans le rôle n'obtient pas de session", async () => {
    for (const [id, reason] of [[GONE, "membre"], [NOROLE, "role"]]) {
      const { cookie, state } = await start();
      const response = await callback({ code: `code-${id}`, state }, cookie);
      assert.equal(failedWith(response), reason);
      assert.ok(!response.headers.getSetCookie().some((value) => value.startsWith("pcr_session=") && !/Max-Age=0/.test(value)), "aucune session ouverte");
    }
  });

  it("une panne de Discord en lisant le membre : « discord », pas une session", async () => {
    const { cookie, state } = await start();
    assert.equal(failedWith(await callback({ code: `code-${BROKEN}`, state }, cookie)), "discord");
  });
});

describe("les fichiers du site", () => {
  it("la page d'accueil, avec ses en-têtes de sécurité", async () => {
    const response = await request("/");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    const csp = response.headers.get("content-security-policy");
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'(;|$)/, "aucun script en ligne, aucun domaine tiers");
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cache-control"), "no-cache");
  });

  it("une page du site sans extension est dessinée par l'accueil", async () => {
    const home = await (await request("/")).text();
    const page = await (await request("/boite/mes-pokemon")).text();
    assert.equal(page, home);
  });

  it("les scripts, styles et images du site se servent avec le bon type", async () => {
    assert.match((await request("/app.js")).headers.get("content-type"), /javascript/);
    assert.match((await request("/style.css")).headers.get("content-type"), /text\/css/);
    assert.match((await request("/favicon.svg")).headers.get("content-type"), /svg/);
    assert.match((await request("/views/sac.js")).headers.get("content-type"), /javascript/);
  });

  it("l'ETag évite de retélécharger : 304 sur une page inchangée", async () => {
    const first = await request("/app.js");
    const etag = first.headers.get("etag");
    assert.ok(etag);
    await first.arrayBuffer();
    const again = await request("/app.js", { headers: { "if-none-match": etag } });
    assert.equal(again.status, 304);
    assert.equal((await again.text()), "");
  });

  it("HEAD ne rend pas de corps", async () => {
    const response = await request("/app.js", { method: "HEAD" });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");
    assert.ok(Number(response.headers.get("content-length")) > 0);
  });

  it("aucun chemin ne sort de web/ : ni .., ni encodé, ni octet nul", async () => {
    for (const path of ["/../package.json", "/%2e%2e/package.json", "/..%2fpackage.json", "/views/../../package.json", "/%2e%2e%2f%2e%2e%2f.env", "/a%00.js", "/..\\package.json"]) {
      const response = await request(path);
      assert.ok([404, 200].includes(response.status), path);
      const body = await response.text();
      assert.doesNotMatch(body, /"name": "pcr"|DISCORD|TOKEN/, `${path} ne doit rien laisser fuir`);
    }
  });

  it("les fichiers cachés et les types inconnus restent invisibles", async () => {
    for (const path of ["/.env", "/.git/config", "/views/.secret.js", "/app.js.map", "/données.json", "/script.sh", "/package.json"]) {
      assert.equal((await request(path)).status, 404, path);
    }
  });

  it("un dossier n'est pas un fichier", async () => {
    assert.equal((await request("/views.js")).status, 404);
  });

  it("le 404 d'un fichier est en texte brut, avec les mêmes en-têtes de sécurité", async () => {
    const response = await request("/absent.js");
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("content-type"), /text\/plain/);
  });
});
