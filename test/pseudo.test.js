// Le pseudo d'un membre pour les journaux : son nom sur le serveur, à défaut son
// nom Discord, à défaut son identifiant — et la mémoire des membres partis, pour ne
// pas redemander à Discord un membre qu'il n'a pas.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSandbox } from "./helpers.js";

createSandbox();
process.env.GUILD_ID = "guild-1";
const { pseudo, pseudos, pseudoOf, setPseudoClient } = await import("../modules/pseudo.js");

const client = ({ members = {}, users = {} } = {}) => {
  const calls = { guild: 0, member: 0, user: 0 };
  return {
    calls,
    guilds: {
      fetch: async () => {
        calls.guild++;
        return {
          members: {
            fetch: async (id) => {
              calls.member++;
              if (!(id in members)) throw new Error("Unknown Member");
              return { displayName: members[id] };
            },
          },
        };
      },
    },
    users: {
      fetch: async (id) => {
        calls.user++;
        if (!(id in users)) throw new Error("Unknown User");
        return { displayName: users[id] };
      },
    },
  };
};

describe("le pseudo d'une interaction", () => {
  it("le nom sur le serveur d'abord, puis le nom Discord, puis le nom d'utilisateur, puis l'identifiant", () => {
    assert.equal(pseudoOf({ member: { displayName: "Surnom" }, user: { displayName: "Global", username: "u", id: "1" } }), "Surnom");
    assert.equal(pseudoOf({ user: { displayName: "Global", username: "u", id: "1" } }), "Global");
    assert.equal(pseudoOf({ user: { username: "u", id: "1" } }), "u");
    assert.equal(pseudoOf({ user: { id: "1" } }), "1");
  });
});

describe("le pseudo d'un identifiant", () => {
  it("sans client, c'est l'identifiant : un journal ne dépend pas de Discord", async () => {
    assert.equal(await pseudo("42"), "42");
    assert.equal(await pseudo(42), "42");
  });

  it("le nom sur le serveur quand le membre y est", async () => {
    setPseudoClient(client({ members: { 1: "Sacha" } }));
    assert.equal(await pseudo("1"), "Sacha");
  });

  it("un membre parti retombe sur son nom Discord, et le souvenir évite de le redemander", async () => {
    const discord = client({ users: { 2: "Ondine" } });
    setPseudoClient(discord);
    assert.equal(await pseudo("2"), "Ondine");
    assert.equal(discord.calls.member, 1);
    assert.equal(await pseudo("2"), "Ondine");
    assert.equal(discord.calls.member, 1, "le membre parti n'est pas redemandé pendant une heure");
    assert.equal(discord.calls.user, 2);
  });

  it("inconnu de Discord : l'identifiant, sans planter", async () => {
    setPseudoClient(client());
    assert.equal(await pseudo("999"), "999");
  });

  it("plusieurs pseudos d'un coup, dans l'ordre des identifiants", async () => {
    setPseudoClient(client({ members: { 3: "Pierre" }, users: { 4: "Mistie" } }));
    assert.deepEqual(await pseudos("4", "3", "5"), ["Mistie", "Pierre", "5"]);
  });
});
