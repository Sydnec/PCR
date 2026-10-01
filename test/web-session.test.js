// Les jetons de session et les cookies : tout ce qui décide qu'un visiteur est
// bien celui qu'il prétend être. Un jeton falsifié, expiré ou fait pour un autre
// usage ne doit jamais passer pour une session.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createSandbox } from "./helpers.js";

createSandbox();
const SECRET = "s".repeat(40);
process.env.WEB_SESSION_SECRET = SECRET;
const { signToken, verifyToken, readCookie, serializeCookie } = await import("../modules/web/session.js");
const { authorizeUrl, redirectUri } = await import("../modules/web/discord.js");

const forge = (payload, secret = SECRET) => {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", secret).update(body).digest("base64url")}`;
};

describe("signer et vérifier un jeton", () => {
  it("un jeton signé revient intact tant qu'il est valable", () => {
    const token = signToken({ id: "123", username: "Sacha" }, 60_000, "session");
    const data = verifyToken(token, "session");
    assert.equal(data.id, "123");
    assert.equal(data.username, "Sacha");
    assert.equal(data.use, "session");
    assert.ok(data.exp > Date.now());
  });

  it("une signature modifiée est refusée", () => {
    const [payload, signature] = signToken({ id: "123" }, 60_000, "session").split(".");
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
    assert.equal(verifyToken(`${payload}.${flipped}`, "session"), null);
    assert.equal(verifyToken(`${payload}.`, "session"), null);
    assert.equal(verifyToken(`${payload}.${signature}extra`, "session"), null, "une signature plus longue n'est pas comparée à moitié");
  });

  it("un contenu modifié est refusé, même avec une signature d'un autre jeton", () => {
    const real = signToken({ id: "123" }, 60_000, "session");
    const other = signToken({ id: "999" }, 60_000, "session");
    assert.equal(verifyToken(`${other.split(".")[0]}.${real.split(".")[1]}`, "session"), null);
  });

  it("un jeton signé avec un autre secret est refusé", () => {
    const token = forge({ id: "123", use: "session", exp: Date.now() + 60_000 }, "x".repeat(40));
    assert.equal(verifyToken(token, "session"), null);
    assert.equal(verifyToken(forge({ id: "123", use: "session", exp: Date.now() + 60_000 }), "session").id, "123");
  });

  it("un jeton expiré est refusé", () => {
    assert.equal(verifyToken(signToken({ id: "1" }, -1, "session"), "session"), null);
    assert.equal(verifyToken(forge({ id: "1", use: "session", exp: 0 }), "session"), null);
    assert.equal(verifyToken(forge({ id: "1", use: "session" }), "session"), null, "sans échéance, il n'est jamais valable");
    assert.equal(verifyToken(forge({ id: "1", use: "session", exp: "demain" }), "session"), null);
  });

  it("un jeton d'état OAuth ne passe pas pour une session, et inversement", () => {
    const state = signToken({ state: "abc" }, 60_000, "oauth-state");
    const session = signToken({ id: "1" }, 60_000, "session");
    assert.equal(verifyToken(state, "session"), null);
    assert.equal(verifyToken(session, "oauth-state"), null);
    assert.equal(verifyToken(state, "oauth-state").state, "abc");
  });

  it("un jeton d'avant l'ajout de l'usage n'est accepté que sur demande expresse", () => {
    const legacy = forge({ id: "123", exp: Date.now() + 60_000 });
    assert.equal(verifyToken(legacy, "session"), null);
    assert.equal(verifyToken(legacy, "session", { legacy: true }).id, "123");
    const wrongUse = forge({ id: "123", use: "oauth-state", exp: Date.now() + 60_000 });
    assert.equal(verifyToken(wrongUse, "session", { legacy: true }), null, "legacy n'ouvre pas les jetons d'un autre usage");
  });

  it("n'importe quoi n'est pas un jeton", () => {
    for (const value of [undefined, null, 42, {}, "", "sans-point", ".", "..", "a.b.c", "%%%.%%%"]) {
      assert.equal(verifyToken(value, "session"), null, String(value));
    }
    const garbagePayload = `${Buffer.from("pas du json").toString("base64url")}`;
    const signature = crypto.createHmac("sha256", SECRET).update(garbagePayload).digest("base64url");
    assert.equal(verifyToken(`${garbagePayload}.${signature}`, "session"), null, "signé mais illisible");
  });

  it("un secret trop court refuse de signer comme de vérifier", () => {
    process.env.WEB_SESSION_SECRET = "court";
    try {
      assert.throws(() => signToken({ id: "1" }, 1000, "session"), /au moins 32 caractères/);
      assert.throws(() => verifyToken("a.b", "session"), /au moins 32 caractères/);
    } finally {
      process.env.WEB_SESSION_SECRET = SECRET;
    }
    delete process.env.WEB_SESSION_SECRET;
    try {
      assert.throws(() => signToken({ id: "1" }, 1000, "session"), /au moins 32 caractères/);
    } finally {
      process.env.WEB_SESSION_SECRET = SECRET;
    }
  });

  it("changer le secret déconnecte tout le monde", () => {
    const token = signToken({ id: "1" }, 60_000, "session");
    process.env.WEB_SESSION_SECRET = "n".repeat(40);
    try {
      assert.equal(verifyToken(token, "session"), null);
    } finally {
      process.env.WEB_SESSION_SECRET = SECRET;
    }
    assert.equal(verifyToken(token, "session").id, "1");
  });
});

describe("les cookies", () => {
  it("lit le cookie demandé parmi d'autres, avec ou sans espaces", () => {
    assert.equal(readCookie("a=1; pcr_session=abc; b=2", "pcr_session"), "abc");
    assert.equal(readCookie("pcr_session=abc", "pcr_session"), "abc");
    assert.equal(readCookie("a=1;pcr_session=abc ;b=2", "pcr_session"), "abc");
  });

  it("décode les caractères échappés", () => {
    assert.equal(readCookie("pcr_session=a%20b%3Dc", "pcr_session"), "a b=c");
  });

  it("un cookie absent, vide ou mal formé vaut « absent » : jamais une exception", () => {
    assert.equal(readCookie("", "x"), undefined);
    assert.equal(readCookie(undefined, "x"), undefined);
    assert.equal(readCookie("a=1", "x"), undefined);
    assert.equal(readCookie("x", "x"), undefined, "sans « = », ce n'est pas un cookie");
    assert.equal(readCookie("x=%E0%A4%A", "x"), undefined, "un « % » mal formé ne fait pas lever decodeURIComponent");
    assert.equal(readCookie("xx=1; x=2", "x"), "2", "un nom qui commence pareil n'est pas le même cookie");
  });

  it("le nom d'un cookie venu du navigateur n'écrit aucune propriété", () => {
    assert.equal(readCookie("__proto__=1; constructor=2", "pcr_session"), undefined);
    assert.equal(Object.prototype.polluted, undefined);
  });

  it("le cookie de session est HttpOnly et SameSite=Lax, Secure en HTTPS", () => {
    const https = serializeCookie("pcr_session", "a b", { maxAgeSeconds: 3600.9, secure: true });
    assert.match(https, /^pcr_session=a%20b; Path=\/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure$/);
    const local = serializeCookie("pcr_session", "x", { maxAgeSeconds: 10, secure: false });
    assert.doesNotMatch(local, /Secure/);
    assert.match(serializeCookie("c", "", { maxAgeSeconds: -5, secure: false }), /Max-Age=0/, "une durée négative efface");
  });
});

describe("la connexion Discord", () => {
  it("l'adresse d'autorisation ne demande que `identify`, avec l'état et l'adresse de retour", () => {
    process.env.WEB_BASE_URL = "https://pcr.example";
    process.env.CLIENT_ID = "client-1";
    const url = new URL(authorizeUrl("etat-123"));
    assert.equal(url.origin + url.pathname, "https://discord.com/oauth2/authorize");
    assert.equal(url.searchParams.get("scope"), "identify", "ni serveurs ni e-mail");
    assert.equal(url.searchParams.get("state"), "etat-123");
    assert.equal(url.searchParams.get("client_id"), "client-1");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("redirect_uri"), "https://pcr.example/api/auth/callback");
    assert.equal(redirectUri(), "https://pcr.example/api/auth/callback");
  });
});
