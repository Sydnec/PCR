// Un faux Discord pour les commandes : une interaction « slash » qui note ce
// qu'on lui répond, avec ses options, sa sous-commande, son membre et son salon.
// Les commandes lisent leurs options par getString / getInteger / getUser…, et
// répondent par reply / deferReply / editReply / followUp : ce sont ces appels, et
// eux seuls, qu'on enregistre.
import { PermissionsBitField } from "discord.js";
import { sleep } from "./helpers.js";

const TERMINAL = ["reply", "editReply", "followUp", "update", "respond"];

// Un utilisateur Discord, tel que discord.js le donne aux commandes.
export const fakeUser = (id, { bot = false, username = `user-${id}` } = {}) => ({
  id: String(id),
  bot,
  username,
  globalName: `Nom ${id}`,
  displayName: `Dresseur ${id}`,
  displayAvatarURL: () => `https://cdn.test/${id}.png`,
});

// Un salon qui note ce qu'on y publie.
export function fakeChannel({ id = "chan-1", messages = [] } = {}) {
  const sent = [];
  const deleted = [];
  const fetched = [];
  return {
    id,
    name: "salon",
    sent,
    deleted,
    fetched,
    toString: () => `<#${id}>`,
    send: async (payload) => {
      sent.push(payload);
      return { id: `msg-${sent.length}`, edit: async () => {} };
    },
    messages: {
      fetch: async (arg) => {
        fetched.push(arg);
        if (typeof arg === "string") return messages.find((message) => message.id === arg) ?? Promise.reject(new Error("Unknown Message"));
        const list = new Map(messages.slice(0, arg?.limit ?? 50).map((message) => [message.id, message]));
        return list;
      },
    },
    bulkDelete: async (collection) => {
      const ids = [...(collection.keys?.() ?? [])];
      deleted.push(...ids);
      return { size: ids.length };
    },
  };
}

// Un serveur : ses rôles, ses membres. `members` : [{ id, bot, roles: [ids] }].
export function fakeGuild({ roles = [], members = [] } = {}) {
  const roleCache = new Map(roles.map((role) => [role.id, { ...role, members: new Map() }]));
  const memberCache = new Map(
    members.map((member) => [
      member.id,
      { id: member.id, user: fakeUser(member.id, { bot: member.bot }), roles: { cache: new Set(member.roles ?? []) } },
    ])
  );
  memberCache.filter = (predicate) => new Map([...memberCache].filter(([, value]) => predicate(value)));
  return {
    id: "guild-1",
    roles: { cache: roleCache },
    members: { cache: memberCache, fetch: async () => memberCache },
  };
}

// Une commande lancée : `options` donne les valeurs des options par leur nom ;
// `users` et `mentionables` les objets résolus par Discord.
export function slash({
  user = "u1",
  admin = false,
  sub = null,
  group = null,
  options = {},
  users = {},
  members = {},
  mentionables = {},
  focused = null,
  guild = fakeGuild(),
  channel = fakeChannel(),
  channelId = channel?.id ?? "chan-1",
} = {}) {
  const calls = [];
  const record = (method) => async (payload) => {
    calls.push({ method, payload });
    return { id: `reply-${calls.length}` };
  };
  const value = (name) => (options[name] === undefined ? null : options[name]);
  const interaction = {
    user: fakeUser(user),
    member: { permissions: new PermissionsBitField(admin ? PermissionsBitField.Flags.Administrator : 0n), displayName: `Membre ${user}` },
    guild,
    channel,
    channelId,
    client: { channels: { fetch: async () => channel }, users: { fetch: async (id) => fakeUser(id) }, guilds: { fetch: async () => guild } },
    commandName: "test",
    deferred: false,
    replied: false,
    options: {
      getSubcommand: (required = true) => {
        if (sub === null && required) throw new Error("Aucune sous-commande");
        return sub;
      },
      getSubcommandGroup: (required = true) => {
        if (group === null && required) throw new Error("Aucun groupe");
        return group;
      },
      getString: (name) => value(name),
      getInteger: (name) => value(name),
      getNumber: (name) => value(name),
      getBoolean: (name) => value(name),
      getUser: (name) => users[name] ?? null,
      getMember: (name) => members[name] ?? null,
      get: (name, required = false) => {
        if (mentionables[name]) return { name, value: mentionables[name].user?.id ?? mentionables[name].role?.id, ...mentionables[name] };
        if (value(name) === null) {
          if (required) throw new Error(`Option ${name} manquante`);
          return null;
        }
        return { name, value: value(name) };
      },
      getFocused: (full = false) => (full ? (focused ?? { name: "", value: "" }) : (focused?.value ?? "")),
    },
  };
  for (const method of ["reply", "update", "deferReply", "deferUpdate", "editReply", "followUp", "respond"]) interaction[method] = record(method);
  const deferReply = interaction.deferReply;
  interaction.deferReply = async (payload) => {
    interaction.deferred = true;
    return deferReply(payload);
  };
  const reply = interaction.reply;
  interaction.reply = async (payload) => {
    interaction.replied = true;
    return reply(payload);
  };
  return { interaction, calls };
}

// Attend la première réponse, puis un court instant pour celles qui suivent.
export async function settle(calls, { timeout = 3000 } = {}) {
  for (let waited = 0; waited < timeout && !calls.some((entry) => TERMINAL.includes(entry.method)); waited += 10) await sleep(10);
  await sleep(60);
  return calls;
}

// Lance une commande (son routeur ou un sous-module) et rend ce qu'elle a répondu.
export async function runCommand(command, config = {}, bot = {}) {
  const { interaction, calls } = slash(config);
  await command.execute(interaction, { client: interaction.client, ...bot });
  await settle(calls);
  return calls;
}

export async function runAutocomplete(command, config = {}, bot = {}) {
  const { interaction, calls } = slash(config);
  await command.autocomplete(interaction, { client: interaction.client, ...bot });
  await settle(calls);
  return calls;
}

export const payloadOf = (calls, method) => {
  const found = calls.filter((entry) => entry.method === method);
  if (found.length !== 1) throw new Error(`${method} : une seule réponse attendue, reçu ${found.length} (${calls.map((entry) => entry.method).join(", ")})`);
  return found[0].payload;
};
export const lastOf = (calls, method) => calls.filter((entry) => entry.method === method).at(-1)?.payload;
export const textOf = (payload) => JSON.stringify(payload?.embeds?.map((embed) => embed.toJSON?.() ?? embed) ?? []) + (payload?.content ?? "");
