import { ChannelType, Constants, PermissionFlagsBits, RESTJSONErrorCodes, SnowflakeUtil } from "discord.js";
import { handleException, log, splitMessage } from "../../modules/utils.js";
import { pseudoOf } from "../../modules/pseudo.js";
import { getConfig } from "../../modules/config.js";

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

// Les purges en cours, par identifiant visé, avec leur avancement : deux purges
// du même membre se marcheraient dessus, et le refus de la seconde dit où en est
// la première. Ce n'est pas un état de jeu : un redémarrage interrompt la purge
// sans bilan, et la relancer reprend simplement ce qui reste.
const running = new Map();

const fr = (value) => value.toLocaleString("fr-FR");
const nameOf = (channel) => `#${channel.name ?? channel.id}`;

function duration(ms) {
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return [hours && `${hours} h`, (hours || minutes) && `${minutes} min`, `${total % 60} s`].filter(Boolean).join(" ");
}

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
    const current = running.get(id);
    if (current) {
      const { report, progress } = current;
      await interaction
        .editReply({
          content:
            `❌ Une purge des messages de ${who} est déjà en cours depuis ${duration(Date.now() - progress.startedAt)} : ` +
            `**${fr(report.deleted)}** message(s) supprimé(s) sur ${fr(progress.scanned)} lu(s), ` +
            `${fr(progress.done)} salon(s) parcouru(s) sur ${fr(progress.queued)}.`,
        })
        .catch(() => {});
      return;
    }

    const settings = getConfig().purgeMember;
    const report = { deleted: 0, channels: [], skipped: [], failed: [] };
    // `active` : les salons en cours, avec leurs compteurs, pour le journal.
    // `listing` : l'inventaire des fils archivés n'est pas fini, d'autres salons arrivent.
    const progress = { startedAt: Date.now(), queued: 0, done: 0, scanned: 0, listing: true, active: new Map() };
    running.set(id, { report, progress });
    await interaction
      .editReply({ content: `🧹 Purge des messages de ${who} lancée sur tout le serveur. Le bilan t'arrivera en MP.` })
      .catch(() => {});
    const label = `/admin purge-membre (${target.username})`;
    log(`/admin purge-membre : messages de ${target.username} (${id}), lancée par ${pseudoOf(interaction)}`);

    // Sans attendre : le parcours peut durer des heures, bien au-delà des
    // 15 minutes de vie de l'interaction. Le bilan part donc en MP, le suivi au
    // journal du bot, et rien n'est publié dans les salons.
    const adminId = interaction.user.id;
    // Le suivi démarre dans la chaîne : s'il échoue, le verrou est rendu quand même.
    let stopTracking = () => {};
    Promise.resolve()
      .then(() => {
        stopTracking = track(bot, label, report, progress, settings);
        return purgeMember(guild, me, id, { report, progress, settings, label });
      })
      .then(() => {
        const lines = summary(report, progress, who, guild);
        log(
          `${label} : terminée en ${duration(Date.now() - progress.startedAt)}, ${fr(report.deleted)} message(s) supprimé(s) ` +
            `sur ${fr(progress.scanned)} lu(s) dans ${fr(progress.done)} salon(s)`
        );
        return notify(bot, adminId, lines);
      })
      .catch((error) => {
        handleException(`/admin purge-membre (${id}) :`, error);
        return notify(bot, adminId, [
          `❌ La purge des messages de ${who} s'est arrêtée sur une erreur, voir le journal du bot.`,
          `**${fr(report.deleted)}** message(s) supprimé(s) avant l'arrêt : la relancer reprendra le reste.`,
        ]);
      })
      .finally(() => {
        stopTracking();
        running.delete(id);
      });
  },
};

// Le suivi au journal du bot, jamais sur Discord : un point d'étape à
// intervalle régulier, et chaque attente imposée par Discord assez longue pour
// faire passer la purge pour bloquée. Rend de quoi tout arrêter à la fin.
function track(bot, label, report, progress, settings) {
  const timer = setInterval(() => log(`${label} : ${status(report, progress)}`), settings.progressLogSeconds * 1000);
  // Le point d'étape ne doit pas retenir le processus quand il s'arrête.
  timer.unref?.();
  const onRateLimit = (info) => {
    // Les routes /channels/:id ont le salon pour paramètre majeur : c'est par
    // lui qu'on reconnaît les attentes de la purge parmi celles du reste du bot.
    const tally = progress.active.get(info.majorParameter);
    if ((!tally && !info.global) || info.timeToReset < settings.rateLimitLogSeconds * 1000) return;
    const scope = info.global ? "tout le bot (limite globale)" : nameOf(tally.channel);
    log(`${label} : Discord fait patienter ${scope} ${duration(info.timeToReset)} (${String(info.method).toUpperCase()} ${info.route})`);
  };
  bot.rest?.on?.("rateLimited", onRateLimit);
  return () => {
    clearInterval(timer);
    bot.rest?.off?.("rateLimited", onRateLimit);
  };
}

function status(report, progress) {
  const line =
    `${duration(Date.now() - progress.startedAt)} écoulées, ` +
    `${fr(progress.done)}/${fr(progress.queued)} salon(s) parcouru(s)${progress.listing ? " (inventaire des fils archivés en cours)" : ""}, ` +
    `${fr(progress.scanned)} message(s) lu(s), ${fr(report.deleted)} supprimé(s)`;
  const active = [...progress.active.values()].map(
    ({ channel, scanned, deleted }) => `${nameOf(channel)} ${fr(scanned)} lu(s) / ${fr(deleted)} supprimé(s)`
  );
  return active.length ? `${line}. En cours : ${active.join(", ")}` : line;
}

// Le bilan, coupé en plusieurs MP s'il dépasse la limite d'un message Discord.
// Des MP fermés ne doivent pas faire disparaître le bilan : il reste au journal.
async function notify(bot, adminId, lines) {
  try {
    for (const content of splitMessage(lines.join("\n"))) await bot.users.send(adminId, { content });
  } catch (error) {
    handleException(`/admin purge-membre : bilan impossible à envoyer en MP. ${lines.join(" | ")}`, error);
  }
}

function summary(report, progress, who, guild) {
  const lines = [
    report.deleted || report.channels.length
      ? `🧹 Purge terminée sur **${guild.name}** : **${fr(report.deleted)}** message(s) de ${who} supprimé(s).`
      : `🧹 Purge terminée sur **${guild.name}** : aucun message de ${who} trouvé.`,
    `⏱️ ${duration(Date.now() - progress.startedAt)}, ${fr(progress.scanned)} message(s) lu(s) dans ${fr(progress.done)} salon(s) et fil(s).`,
  ];
  // Les salons finissent dans le désordre, en parallèle : les plus touchés d'abord.
  for (const { channel, deleted, failed } of [...report.channels].sort((a, b) => b.deleted - a.deleted)) {
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

async function purgeMember(guild, me, targetId, run) {
  const { report, progress, settings, label } = run;
  const work = pool(settings.concurrency, label);
  // Un fil peut se présenter deux fois : archivé ou rouvert entre deux listes.
  const seen = new Set();
  const enqueue = (channel) => {
    if (seen.has(channel.id)) return;
    seen.add(channel.id);
    progress.queued += 1;
    work.add(() => purgeOne(channel, targetId, run));
  };

  // Tout l'inventaire immédiat est lu avant de lancer quoi que ce soit : une
  // panne ici arrête la purge avant la moindre suppression.
  const { channels, parents } = await listChannels(guild, me, report);
  for (const channel of channels) enqueue(channel);
  log(
    `${label} : ${fr(progress.queued)} salon(s) et fil(s) actif(s) à parcourir, ${settings.concurrency} à la fois, ` +
      `${fr(report.skipped.length)} ignoré(s) faute de droits. Fils archivés de ${fr(parents.length)} salon(s) à inventorier`
  );

  // Les fils archivés se découvrent pendant que les premiers salons se
  // purgent : un gros forum ne retarde plus le reste. Quoi qu'il arrive, on ne
  // rend la main (et le verrou) qu'une fois les salons lancés terminés : une
  // relance ne doit pas chevaucher une purge qui tourne encore.
  try {
    let archived = 0;
    for (const parent of parents) {
      try {
        archived += await collectArchivedThreads(parent, me, enqueue);
      } catch (error) {
        report.failed.push({ channel: parent, error: `fils archivés illisibles (${error?.message ?? error})` });
        log(`${label} : fils archivés de ${nameOf(parent)} illisibles : ${error?.message ?? error}`);
      }
    }
    progress.listing = false;
    log(`${label} : inventaire terminé, ${fr(archived)} fil(s) archivé(s) trouvé(s), ${fr(progress.queued)} salon(s) et fil(s) au total`);
  } finally {
    await work.idle();
  }
}

// Au plus `size` tâches à la fois, et on peut en ajouter pendant que d'autres
// tournent. `idle()` attend que tout soit fini, y compris ce qui a été ajouté
// entre-temps.
function pool(size, label) {
  const waiting = [];
  const idlers = [];
  let running = 0;
  const next = () => {
    while (running < size && waiting.length) {
      const task = waiting.shift();
      running += 1;
      task()
        // Chaque tâche range ses pannes dans le bilan : ce filet ne voit que l'imprévu.
        .catch((error) => handleException(`${label} : tâche en échec`, error))
        .finally(() => {
          running -= 1;
          next();
        });
    }
    if (!running && !waiting.length) idlers.splice(0).forEach((resolve) => resolve());
  };
  return {
    add(task) {
      waiting.push(task);
      next();
    },
    idle: () =>
      new Promise((resolve) => {
        idlers.push(resolve);
        next();
      }),
  };
}

const can = (channel, me, permissions) => Boolean(channel.permissionsFor?.(me)?.has(permissions));

// Tous les salons qui portent des messages : textes, annonces, chats vocaux et
// fils actifs. Les salons à fils (forums compris) sont rendus à part : leurs
// fils archivés s'inventorient ensuite, page par page.
async function listChannels(guild, me, report) {
  const channels = [];
  const parents = [];
  const skipped = new Set();
  for (const channel of (await guild.channels.fetch()).values()) {
    // Les catégories n'ont ni messages ni fils.
    if (!channel || (!channel.isTextBased?.() && !channel.threads)) continue;
    if (!can(channel, me, NEEDED)) {
      report.skipped.push(channel);
      skipped.add(channel.id);
      continue;
    }
    if (channel.isTextBased()) channels.push(channel);
    if (channel.threads) parents.push(channel);
  }
  for (const thread of (await guild.channels.fetchActiveThreads()).threads.values()) {
    // Le salon parent est déjà cité comme ignoré : inutile d'y ajouter chacun de ses fils.
    if (skipped.has(thread.parentId)) continue;
    if (!can(thread, me, NEEDED)) {
      report.skipped.push(thread);
      continue;
    }
    channels.push(thread);
  }
  return { channels, parents };
}

// Rend le nombre de fils trouvés, chacun passé à `found` dès sa page lue.
async function collectArchivedThreads(parent, me, found) {
  const types = ["public"];
  // Les fils privés n'existent que dans les salons textuels, et ne se listent
  // tous qu'avec « Gérer les fils ».
  if (parent.type === ChannelType.GuildText && can(parent, me, [PermissionFlagsBits.ManageThreads])) types.push("private");
  let count = 0;
  for (const type of types) {
    let before;
    for (;;) {
      const page = await parent.threads.fetchArchived({ type, fetchAll: true, before, limit: PAGE_SIZE });
      const threads = [...page.threads.values()];
      threads.forEach(found);
      count += threads.length;
      if (!page.hasMore || !threads.length) break;
      // Discord rend les fils du plus récemment archivé au plus ancien.
      before = threads.at(-1).archivedAt;
    }
  }
  return count;
}

// Un salon, du début à la fin. Une panne (droits retirés en cours de route, fil
// supprimé) n'arrête pas les autres : elle est citée dans le bilan, avec ce qui
// a déjà été supprimé avant elle.
async function purgeOne(channel, targetId, { report, progress, label }) {
  const tally = { channel, scanned: 0, deleted: 0, failed: 0 };
  const startedAt = Date.now();
  progress.active.set(channel.id, tally);
  try {
    await purgeChannel(channel, targetId, (scanned) => {
      tally.scanned += scanned;
      progress.scanned += scanned;
    }, (deleted, failed) => {
      tally.deleted += deleted;
      tally.failed += failed;
      report.deleted += deleted;
    });
  } catch (error) {
    report.failed.push({ channel, error });
    log(`${label} : ${nameOf(channel)} en erreur après ${fr(tally.scanned)} message(s) lu(s) : ${error?.message ?? error}`);
  } finally {
    progress.active.delete(channel.id);
    progress.done += 1;
  }
  if (!tally.deleted && !tally.failed) return;
  report.channels.push({ channel, deleted: tally.deleted, failed: tally.failed });
  log(
    `${label} : ${nameOf(channel)} terminé en ${duration(Date.now() - startedAt)}, ${fr(tally.deleted)} supprimé(s)` +
      `${tally.failed ? ` et ${fr(tally.failed)} impossible(s)` : ""} sur ${fr(tally.scanned)} lu(s)`
  );
}

// Remonte tout l'historique du salon, page par page, et supprime les messages
// du membre au fil de la lecture : la lecture et les suppressions avancent
// chacune à leur rythme, sous des limites de débit distinctes chez Discord.
// `cache: false` : des millions de messages lus ne doivent pas s'entasser dans
// la mémoire du bot.
async function purgeChannel(channel, targetId, onScanned, onDeleted) {
  // Un fil archivé refuse toute suppression : on le rouvre au premier message
  // du membre trouvé, puis on le referme quoi qu'il arrive, pour le laisser tel
  // qu'on l'a trouvé. Sans message à supprimer, on n'y touche pas. Un fil peut
  // aussi s'archiver de lui-même au milieu d'une longue purge (supprimer n'est
  // pas une activité) : la file qui s'y heurte le rouvre de la même façon.
  const archived = channel.isThread?.() && channel.archived;
  let reopened = false;
  let reopening = null;
  const reopen = () =>
    (reopening ??= channel.setArchived(false, REASON).then(
      () => {
        reopened = true;
        reopening = null;
      },
      (error) => {
        reopening = null;
        throw error;
      }
    ));
  const deleter = createDeleter(channel, onDeleted, reopen);
  try {
    let before;
    for (;;) {
      const page = await channel.messages.fetch({ limit: PAGE_SIZE, before, cache: false });
      onScanned(page.size);
      const ids = [];
      for (const message of page.values()) {
        if (message.author?.id === targetId) ids.push(message.id);
      }
      if (ids.length && archived && !reopened) await reopen();
      if (page.size) {
        // Le plus ancien de la page, comparé en nombre : l'ordre de la
        // collection n'est pas une garantie.
        before = [...page.keys()].reduce((oldest, key) => (BigInt(key) < BigInt(oldest) ? key : oldest));
      }
      deleter.add(ids, before);
      if (page.size < PAGE_SIZE) return;
    }
  } finally {
    // Ce qui a été trouvé avant une panne de lecture part quand même.
    await deleter.flush();
    if (reopened) {
      await channel
        .setArchived(true, REASON)
        .catch((error) => handleException(`/admin purge-membre : fil ${channel.id} resté rouvert`, error));
    }
  }
}

// Deux files, qui avancent pendant que la lecture continue : les lots de
// messages récents, et les suppressions une par une. Chacune traite ses
// messages dans l'ordre ; aucune ne lève, les échecs sont comptés.
function createDeleter(channel, onDeleted, reopen) {
  // Discord ne supprime par lots que les messages de moins de 14 jours ; l'âge
  // se lit dans l'identifiant. Les plus anciens partent un par un.
  const isRecent = (id) => Date.now() - SnowflakeUtil.timestampFrom(id) < Constants.MaxBulkDeletableMessageAge;
  // Les récents attendent d'être cent, le maximum d'un lot, ou que la lecture
  // passe les 14 jours : l'historique se lit du plus récent au plus ancien,
  // aucun autre ne viendra.
  let recent = [];
  let bulkQueue = Promise.resolve();
  let singleQueue = Promise.resolve();

  const deleteOne = async (id) => {
    try {
      await channel.messages.delete(id);
    } catch (error) {
      if (error?.code !== RESTJSONErrorCodes.InvalidActionOnArchivedThread) throw error;
      await reopen();
      await channel.messages.delete(id);
    }
  };
  const oneByOne = (ids) => {
    singleQueue = singleQueue.then(async () => {
      for (const id of ids) {
        try {
          await deleteOne(id);
          onDeleted(1, 0);
        } catch (error) {
          // Déjà supprimé entre-temps (par son auteur, un modérateur) : rien à faire.
          if (error?.code !== RESTJSONErrorCodes.UnknownMessage) onDeleted(0, 1);
        }
      }
    });
  };
  const bulk = (ids) => {
    bulkQueue = bulkQueue.then(async () => {
      // Le lot a pu attendre : ce qui a passé les 14 jours entre-temps ferait
      // refuser tout le lot, il part donc seul dès maintenant.
      const batch = ids.filter(isRecent);
      if (batch.length < ids.length) oneByOne(ids.filter((id) => !isRecent(id)));
      if (!batch.length) return;
      try {
        // Le lot passe entier ou pas du tout : on compte ce qu'on a envoyé. La
        // collection rendue par discord.js est vide pour un lot d'un seul
        // message absent du cache, et l'historique est lu sans cache.
        await channel.bulkDelete(batch);
        onDeleted(batch.length, 0);
      } catch {
        // Refusé quand même (le fil s'est archivé, une limite d'âge franchie à
        // la seconde près) : chacun repart seul.
        oneByOne(batch);
      }
    });
  };
  const sendRecent = () => {
    if (recent.length) bulk(recent);
    recent = [];
  };

  return {
    // `oldest` : le plus ancien message lu jusqu'ici, du membre ou non.
    add(ids, oldest) {
      const old = [];
      for (const id of ids) (isRecent(id) ? recent : old).push(id);
      while (recent.length >= PAGE_SIZE) bulk(recent.splice(0, PAGE_SIZE));
      if (oldest && !isRecent(oldest)) sendRecent();
      if (old.length) oneByOne(old);
    },
    async flush() {
      sendRecent();
      // Les lots d'abord : un lot refusé ajoute ses messages à l'autre file.
      await bulkQueue;
      await singleQueue;
    },
  };
}
