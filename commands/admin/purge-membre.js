import { ChannelType, Constants, PermissionFlagsBits, RESTJSONErrorCodes, SnowflakeUtil } from "discord.js";
import { handleException, log, splitMessage } from "../../modules/utils.js";
import { pseudoOf } from "../../modules/pseudo.js";

// Discord ne rend pas plus de 100 messages (ou fils archivés) par requête, et
// n'en supprime pas plus de 100 d'un coup.
const PAGE_SIZE = 100;
const SNOWFLAKE = /^\d{17,20}$/;
const REASON = "/admin purge-membre";
// Lire l'historique et y supprimer : sans l'un des trois, le salon est ignoré
// et cité dans le bilan, plutôt que de faire échouer chaque requête.
const NEEDED = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageMessages,
];

// Les purges en cours, par identifiant visé : deux purges du même membre se
// marcheraient dessus. Ce n'est pas un état de jeu : un redémarrage interrompt
// la purge sans bilan, et la relancer reprend simplement ce qui reste.
const running = new Set();

const fr = (value) => value.toLocaleString("fr-FR");

export default {
  describe: (sub) =>
    sub
      .setName("purge-membre")
      .setDescription("Supprime tous les messages d'un membre sur le serveur, bilan en MP")
      .addStringOption((option) =>
        option
          .setName("id")
          .setDescription("Identifiant Discord du membre (il peut avoir quitté le serveur)")
          .setRequired(true)
      ),

  async execute(interaction, bot) {
    // Une option texte plutôt qu'une option membre : quelqu'un qui a quitté le
    // serveur doit rester visable, et seul son identifiant le permet.
    const id = (interaction.options.getString("id") ?? "").trim();
    if (!SNOWFLAKE.test(id)) {
      await interaction
        .editReply({ content: `❌ « ${id} » n'est pas un identifiant Discord : il faut 17 à 20 chiffres.` })
        .catch(() => {});
      return;
    }

    const { guild } = interaction;
    const me = guild.members.me ?? (await guild.members.fetchMe());
    if (id === me.id) {
      await interaction
        .editReply({
          content: "❌ C'est l'identifiant du bot : effacer ses messages casserait les apparitions et les boutons en cours.",
        })
        .catch(() => {});
      return;
    }

    // Une faute de frappe dans un identifiant tombe presque toujours sur un
    // compte qui n'existe pas : c'est le seul garde-fou avant l'irréversible,
    // une autre panne de Discord remonte au filet du routeur.
    const target = await bot.users.fetch(id).catch((error) => {
      if (error?.code === RESTJSONErrorCodes.UnknownUser) return null;
      throw error;
    });
    if (!target) {
      await interaction
        .editReply({ content: `❌ Aucun compte Discord ne porte l'identifiant \`${id}\`.` })
        .catch(() => {});
      return;
    }

    const who = `**${target.displayName ?? target.username}** (\`${id}\`)`;
    if (running.has(id)) {
      await interaction
        .editReply({ content: `❌ Une purge des messages de ${who} est déjà en cours.` })
        .catch(() => {});
      return;
    }

    running.add(id);
    await interaction
      .editReply({ content: `🧹 Purge des messages de ${who} lancée sur tout le serveur. Le bilan t'arrivera en MP.` })
      .catch(() => {});
    log(`/admin purge-membre : messages de ${target.username} (${id}), lancée par ${pseudoOf(interaction)}`);

    // Sans attendre : le parcours peut durer des heures, bien au-delà des
    // 15 minutes de vie de l'interaction. Le bilan part donc en MP, et rien
    // n'est publié dans les salons.
    const report = { deleted: 0, channels: [], skipped: [], failed: [] };
    const adminId = interaction.user.id;
    purgeMember(guild, me, id, report)
      .then(() => {
        const lines = summary(report, who, guild);
        log(`/admin purge-membre : ${report.deleted} message(s) de ${target.username} (${id}) supprimé(s)`);
        return notify(bot, adminId, lines);
      })
      .catch((error) => {
        handleException(`/admin purge-membre (${id}) :`, error);
        return notify(bot, adminId, [
          `❌ La purge des messages de ${who} s'est arrêtée sur une erreur, voir le journal du bot.`,
          `**${fr(report.deleted)}** message(s) supprimé(s) avant l'arrêt : la relancer reprendra le reste.`,
        ]);
      })
      .finally(() => running.delete(id));
  },
};

// Le bilan, coupé en plusieurs MP s'il dépasse la limite d'un message Discord.
// Des MP fermés ne doivent pas faire disparaître le bilan : il reste au journal.
async function notify(bot, adminId, lines) {
  try {
    for (const content of splitMessage(lines.join("\n"))) await bot.users.send(adminId, { content });
  } catch (error) {
    handleException(`/admin purge-membre : bilan impossible à envoyer en MP. ${lines.join(" | ")}`, error);
  }
}

function summary(report, who, guild) {
  const lines = [
    report.deleted || report.channels.length
      ? `🧹 Purge terminée sur **${guild.name}** : **${fr(report.deleted)}** message(s) de ${who} supprimé(s).`
      : `🧹 Purge terminée sur **${guild.name}** : aucun message de ${who} trouvé.`,
  ];
  for (const { channel, deleted, failed } of report.channels) {
    lines.push(`• <#${channel.id}> : ${fr(deleted)}${failed ? ` (⚠️ ${fr(failed)} impossible(s) à supprimer)` : ""}`);
  }
  if (report.failed.length) {
    lines.push("❌ Salons en erreur, à relancer :");
    for (const { channel, error } of report.failed) lines.push(`• <#${channel.id}> : ${error?.message ?? error}`);
  }
  if (report.skipped.length) {
    lines.push("🚫 Salons ignorés faute de droits (voir, lire l'historique, gérer les messages) :");
    for (const channel of report.skipped) lines.push(`• <#${channel.id}>`);
  }
  return lines;
}

async function purgeMember(guild, me, targetId, report) {
  for (const channel of await listChannels(guild, me, report)) {
    // Une panne sur un salon (droits retirés en cours de route, fil supprimé)
    // n'arrête pas les autres : elle est citée dans le bilan.
    try {
      const { deleted, failed } = await purgeChannel(channel, targetId);
      if (deleted || failed) report.channels.push({ channel, deleted, failed });
      report.deleted += deleted;
    } catch (error) {
      report.failed.push({ channel, error });
    }
  }
}

const can = (channel, me, permissions) => Boolean(channel.permissionsFor?.(me)?.has(permissions));

// Tous les salons qui portent des messages : textes, annonces, chats vocaux,
// puis les fils, actifs comme archivés, y compris les posts de forum.
async function listChannels(guild, me, report) {
  const channels = new Map();
  const threads = new Map();
  const skipped = new Set();
  for (const channel of (await guild.channels.fetch()).values()) {
    // Les catégories n'ont ni messages ni fils.
    if (!channel || (!channel.isTextBased?.() && !channel.threads)) continue;
    if (!can(channel, me, NEEDED)) {
      report.skipped.push(channel);
      skipped.add(channel.id);
      continue;
    }
    if (channel.isTextBased()) channels.set(channel.id, channel);
    if (!channel.threads) continue;
    try {
      await collectArchivedThreads(channel, me, threads);
    } catch (error) {
      report.failed.push({ channel, error: `fils archivés illisibles (${error?.message ?? error})` });
    }
  }
  for (const thread of (await guild.channels.fetchActiveThreads()).threads.values()) {
    // Le salon parent est déjà cité comme ignoré : inutile d'y ajouter chacun de ses fils.
    if (skipped.has(thread.parentId)) continue;
    if (!can(thread, me, NEEDED)) {
      report.skipped.push(thread);
      continue;
    }
    threads.set(thread.id, thread);
  }
  return [...channels.values(), ...threads.values()];
}

async function collectArchivedThreads(parent, me, threads) {
  const types = ["public"];
  // Les fils privés n'existent que dans les salons textuels, et ne se listent
  // tous qu'avec « Gérer les fils ».
  if (parent.type === ChannelType.GuildText && can(parent, me, [PermissionFlagsBits.ManageThreads])) types.push("private");
  for (const type of types) {
    let before;
    for (;;) {
      const page = await parent.threads.fetchArchived({ type, fetchAll: true, before, limit: PAGE_SIZE });
      const found = [...page.threads.values()];
      for (const thread of found) threads.set(thread.id, thread);
      if (!page.hasMore || !found.length) break;
      // Discord rend les fils du plus récemment archivé au plus ancien.
      before = found.at(-1).archivedAt;
    }
  }
}

async function purgeChannel(channel, targetId) {
  const ids = await collectMessages(channel, targetId);
  if (!ids.length) return { deleted: 0, failed: 0 };

  // Un fil archivé refuse toute suppression : on le rouvre le temps du ménage,
  // puis on le referme quoi qu'il arrive, pour le laisser tel qu'on l'a trouvé.
  // On ne le touche que s'il contient des messages à supprimer.
  const reopened = channel.isThread?.() && channel.archived;
  if (reopened) await channel.setArchived(false, REASON);
  try {
    return await deleteMessages(channel, ids);
  } finally {
    if (reopened) {
      await channel
        .setArchived(true, REASON)
        .catch((error) => handleException(`/admin purge-membre : fil ${channel.id} resté rouvert`, error));
    }
  }
}

// Remonte tout l'historique du salon, page par page, et ne garde que les
// messages du membre visé. `cache: false` : des millions de messages lus ne
// doivent pas s'entasser dans la mémoire du bot.
async function collectMessages(channel, targetId) {
  const ids = [];
  let before;
  for (;;) {
    const page = await channel.messages.fetch({ limit: PAGE_SIZE, before, cache: false });
    for (const message of page.values()) {
      if (message.author?.id === targetId) ids.push(message.id);
    }
    if (page.size < PAGE_SIZE) return ids;
    // Le plus ancien de la page, comparé en nombre : l'ordre de la collection
    // n'est pas une garantie.
    before = [...page.keys()].reduce((oldest, key) => (BigInt(key) < BigInt(oldest) ? key : oldest));
  }
}

async function deleteMessages(channel, ids) {
  // Discord ne supprime par lots que les messages de moins de 14 jours ; l'âge
  // se lit dans l'identifiant. Les plus anciens partent un par un.
  const now = Date.now();
  const isRecent = (id) => now - SnowflakeUtil.timestampFrom(id) < Constants.MaxBulkDeletableMessageAge;
  const recent = ids.filter(isRecent);
  const oneByOne = ids.filter((id) => !isRecent(id));
  let deleted = 0;
  let failed = 0;

  for (let start = 0; start < recent.length; start += PAGE_SIZE) {
    const batch = recent.slice(start, start + PAGE_SIZE);
    try {
      deleted += (await channel.bulkDelete(batch)).size;
    } catch {
      // Un seul message passé au-delà des 14 jours depuis la lecture fait
      // refuser tout le lot : chacun repart alors seul.
      oneByOne.push(...batch);
    }
  }

  for (const id of oneByOne) {
    try {
      await channel.messages.delete(id);
      deleted += 1;
    } catch (error) {
      // Déjà supprimé entre-temps (par son auteur, un modérateur) : rien à faire.
      if (error?.code !== RESTJSONErrorCodes.UnknownMessage) failed += 1;
    }
  }
  return { deleted, failed };
}
