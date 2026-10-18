// La porte unique des réécritures de messages publics : une à la fois par
// message, le contenu construit au dernier moment, des réessais sur les pannes
// passagères, et un abandon net sur un message qui n'existe plus.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, sleep } from "./helpers.js";

createSandbox({ config: { publicMessages: { retries: 2, retryDelayMs: 5 } } });
const { syncMessage, MESSAGE_GONE } = await import("../modules/message-sync.js");

// Un salon dont on règle la lenteur et les pannes, et qui note ce qu'il reçoit.
function fakeChannel({ fetchDelays = [], failures = [] } = {}) {
  const edits = [];
  let fetches = 0;
  const channel = {
    edits,
    messages: {
      fetch: async (id) => {
        const delay = fetchDelays[fetches++] ?? 0;
        if (delay) await sleep(delay);
        return { id, embeds: [{ description: "annonce" }], edit: async (payload) => channel.edit(id, payload) };
      },
      edit: async (id, payload) => channel.edit(id, payload),
    },
    edit: async (id, payload) => {
      const failure = failures.shift();
      if (failure) throw failure;
      edits.push({ id, payload });
    },
  };
  return { channel, client: { channels: { fetch: async () => channel } } };
}
const target = { channelId: "c", messageId: "m" };

describe("syncMessage", () => {
  it("deux réécritures d'un même message passent l'une après l'autre : la plus récente reste", async () => {
    const { channel, client } = fakeChannel({ fetchDelays: [80, 0] });
    let state = "actif";
    const first = syncMessage(client, "k1", { ...target, read: true, build: () => ({ content: `premier:${state}` }) });
    await sleep(10);
    state = "capturé";
    const second = syncMessage(client, "k1", { ...target, read: true, build: () => ({ content: `second:${state}` }) });
    assert.deepEqual(await Promise.all([first, second]), ["edited", "edited"]);
    assert.deepEqual(channel.edits.map((entry) => entry.payload.content), ["premier:capturé", "second:capturé"]);
  });

  it("le contenu se construit au dernier moment, une fois le message relu", async () => {
    const { channel, client } = fakeChannel({ fetchDelays: [50] });
    let state = "avant";
    const pending = syncMessage(client, "k2", { ...target, read: true, build: (message) => ({ content: `${state}|${message.embeds[0].description}` }) });
    state = "après";
    assert.equal(await pending, "edited");
    assert.equal(channel.edits[0].payload.content, "après|annonce", "l'état lu est celui du moment de l'écriture");
  });

  it("un contenu nul n'écrit rien", async () => {
    const { channel, client } = fakeChannel();
    assert.equal(await syncMessage(client, "k3", { ...target, build: () => null }), "skipped");
    assert.equal(channel.edits.length, 0);
  });

  it("une panne passagère se réessaie, en relisant la base à chaque essai", async () => {
    const { channel, client } = fakeChannel({ failures: [new Error("ECONNRESET"), Object.assign(new Error("Internal"), { code: 0, status: 500 })] });
    let builds = 0;
    assert.equal(await syncMessage(client, "k4", { ...target, build: () => ({ content: `essai ${++builds}` }) }), "edited");
    assert.equal(builds, 3);
    assert.deepEqual(channel.edits.map((entry) => entry.payload.content), ["essai 3"]);
  });

  it("au-delà des réessais, l'échec se rend sans lever", async () => {
    const { channel, client } = fakeChannel({ failures: [new Error("a"), new Error("b"), new Error("c")] });
    const original = console.error;
    console.error = () => {};
    try {
      assert.equal(await syncMessage(client, "k5", { ...target, build: () => ({ content: "x" }) }), "failed");
    } finally {
      console.error = original;
    }
    assert.equal(channel.edits.length, 0);
  });

  it("un autre refus 4xx ne se réessaie pas ; la limite de débit, si", async () => {
    const invalid = fakeChannel({ failures: [Object.assign(new Error("Invalid Form Body"), { code: 50035, status: 400 })] });
    let builds = 0;
    const original = console.error;
    console.error = () => {};
    try {
      assert.equal(await syncMessage(invalid.client, "k8", { ...target, build: () => ({ content: `${++builds}` }) }), "failed");
    } finally {
      console.error = original;
    }
    assert.equal(builds, 1);
    const limited = fakeChannel({ failures: [Object.assign(new Error("Too Many Requests"), { status: 429 })] });
    assert.equal(await syncMessage(limited.client, "k9", { ...target, build: () => ({ content: "x" }) }), "edited");
  });

  it("un message supprimé ou interdit s'abandonne aussitôt, sans réessai", async () => {
    for (const code of MESSAGE_GONE) {
      const { client } = fakeChannel({ failures: [Object.assign(new Error("gone"), { code })] });
      let builds = 0;
      assert.equal(await syncMessage(client, `k6-${code}`, { ...target, build: () => ({ content: `${++builds}` }) }), "gone", String(code));
      assert.equal(builds, 1);
    }
  });

  it("sans message ni client, rien à faire", async () => {
    assert.equal(await syncMessage(null, "k7", { ...target, build: () => ({}) }), "skipped");
    assert.equal(await syncMessage(fakeChannel().client, "k7", { channelId: "c", messageId: null, build: () => ({}) }), "skipped");
  });
});
