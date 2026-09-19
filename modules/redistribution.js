// Pot commun : chacun cotise une part de sa fortune, la cagnotte repart en
// parts égales entre tous les porteurs du rôle par défaut.
//
// Trois propriétés tiennent tout le module :
//
// 1. Le mouvement est appliqué en NET — une seule écriture par membre, part
//    reçue moins cotisation. Personne ne voit son solde plonger le temps que la
//    redistribution s'achève, et une interruption en cours de route ne laisse
//    pas la cagnotte coincée entre deux comptes.
// 2. La somme des mouvements fait exactement zéro. Le reste de la division
//    entière est distribué au lieu d'être brûlé, sinon l'économie fuirait un
//    peu chaque semaine.
// 3. L'échéance est revendiquée par un UPDATE gardé, comme les spawns : deux
//    ticks simultanés ne peuvent pas déclencher deux pots.
//
// Le prélèvement est obligatoire, automatique et SILENCIEUX : rien n'est envoyé
// dans aucun salon, personne n'est notifié, et les soldes évoluent sans
// explication publique. Le récapitulatif n'existe que pour les administrateurs,
// en éphémère, et dans les logs.
import db from "./points-db.js";
import { applyMovements } from "./economy.js";
import { getConfig } from "./config.js";
import { fetchRoleMembers } from "./members.js";
import { handleException, log } from "./utils.js";
import { EmbedBuilder } from "discord.js";
import dotenv from "dotenv";
dotenv.config(); // process.env.CONSTANT

function getRedistributionConfig() {
  return getConfig().redistribution;
}

// ============================ ÉCHÉANCE ============================

export function getNextRedistributionAt(cb) {
  db.get("SELECT next_redistribution_at AS at FROM economy_state WHERE id = 1", (err, row) =>
    cb(err, row?.at ?? 0)
  );
}

// Pose la première échéance sur une base neuve. Sans ça, next = 0 ferait
// prélever tout le monde dès la première heure de vie du bot.
function scheduleFirst(intervalMs, cb) {
  db.run(
    "UPDATE economy_state SET next_redistribution_at = ? WHERE id = 1 AND next_redistribution_at = 0",
    [Date.now() + intervalMs],
    function (err) {
      cb(err, this ? this.changes === 1 : false);
    }
  );
}

// Revendique l'échéance échue. Le calcul de la suivante est DANS le SQL, à
// partir de l'ancienne échéance et non de l'instant présent : le pot ne dérive
// pas de quelques secondes à chaque tour. Le nombre d'intervalles sautés est
// calculé au passage, donc une panne de trois semaines ne déclenche pas trois
// pots d'affilée — un seul, et l'échéance repart dans le futur.
//
// Les CAST ne sont pas décoratifs. node-sqlite3 lie un nombre JS trop grand
// pour un entier 32 bits en REAL, et Date.now() en fait partie : sans eux la
// division devient flottante, la troncature n'a jamais lieu, et l'échéance
// suivante retombe exactement sur « maintenant + un intervalle ». Soit très
// précisément la dérive que ce calcul existe pour éviter.
function claimRedistribution(intervalMs, cb) {
  const now = Date.now();
  db.run(
    `UPDATE economy_state
        SET next_redistribution_at =
            next_redistribution_at
            + ((CAST(? AS INTEGER) - next_redistribution_at) / CAST(? AS INTEGER) + 1)
              * CAST(? AS INTEGER)
      WHERE id = 1
        AND next_redistribution_at > 0
        AND next_redistribution_at <= CAST(? AS INTEGER)`,
    [now, intervalMs, intervalMs, now],
    function (err) {
      // On rend l'échéance qu'on vient de poser, pas un booléen : une relecture
      // séparée pouvait échouer, et son repli à 0 désarmait silencieusement la
      // compensation ci-dessous.
      if (err || !this || this.changes !== 1) return cb(err, null);
      getNextRedistributionAt((readError, at) => cb(readError, readError ? null : at));
    }
  );
}

// Bail d'exécution. L'échéance protège le minuteur de lui-même, mais pas de
// /admin potcommun, qui ne la revendique pas : deux pots lancés à la même
// seconde liraient le même instantané des soldes et prélèveraient deux fois les
// 5 %. Le bail est pris par tout pot réel, d'où qu'il vienne.
//
// Il périme au bout de LEASE_MS pour qu'un arrêt en plein pot ne condamne pas
// tous les suivants ; un pot met quelques secondes, la marge est large.
const LEASE_MS = 5 * 60 * 1000;

// Rend l'estampille posée, qui sert de jeton : c'est elle, et pas un simple
// booléen, qui permet de ne rendre QUE son propre bail.
function takeLease(cb) {
  const now = Date.now();
  db.run(
    `UPDATE economy_state SET redistribution_since = CAST(? AS INTEGER)
      WHERE id = 1
        AND (redistribution_since = 0 OR redistribution_since < CAST(? AS INTEGER))`,
    [now, now - LEASE_MS],
    function (err) {
      cb(err, this && this.changes === 1 ? now : null);
    }
  );
}

// Rend l'échéance telle qu'elle était, si et seulement si personne ne l'a
// touchée depuis. Un empêchement passager ne doit pas faire sauter le pot d'une
// semaine, et la revendication précède forcément des opérations qui peuvent
// échouer — le bail, la lecture des soldes.
//
// Réservée aux échecs PASSAGERS, et seulement tant que l'argent n'a pas bougé :
// rendre une échéance déjà dépassée sur un échec permanent transformerait le pot
// hebdomadaire en boucle horaire, et la rendre après un versement ferait
// prélever tout le monde une seconde fois au tour suivant.
function rollbackClaim(previous, claimed, cb = () => {}) {
  db.run(
    `UPDATE economy_state SET next_redistribution_at = CAST(? AS INTEGER)
      WHERE id = 1 AND next_redistribution_at = CAST(? AS INTEGER)`,
    [previous, claimed],
    function (err) {
      cb(err, this ? this.changes === 1 : false);
    }
  );
}

// Libération gardée sur le jeton. Sans la garde, un pot qui déborde de
// LEASE_MS — boucle d'événements bloquée, disque lent — rendrait en sortant le
// bail qu'un autre pot a légitimement repris entre-temps, et le suivant
// prélèverait une deuxième fois sur le même instantané.
//
// Ne rien toucher n'est donc pas un cas anodin : c'est la preuve que deux pots
// ont pu tourner en même temps. On le dit, sinon l'invariant se viole en silence.
function releaseLease(token, cb = () => {}) {
  db.run(
    "UPDATE economy_state SET redistribution_since = 0 WHERE id = 1 AND redistribution_since = CAST(? AS INTEGER)",
    [token],
    function (err) {
      if (!err && this && this.changes === 0) {
        handleException(
          "Pot commun : le bail avait été repris avant la fin — deux pots ont pu " +
            "tourner sur le même instantané des soldes. Vérifier points_redistributions."
        );
      }
      cb(err);
    }
  );
}

// ============================ CALCUL ============================

// Le mouvement complet, sans aucune écriture : c'est aussi ce que montre la
// simulation de /admin potcommun.
export function planRedistribution(balances, percent) {
  const participants = balances.length;
  if (!participants) return { participants: 0, contributors: 0, pot: 0, share: 0, entries: [] };

  // Arrondi vers le bas : on ne prélève jamais plus que le pourcentage annoncé.
  // Un solde négatif ou nul ne cotise pas — créditer quelqu'un au titre de sa
  // dette reviendrait à récompenser le découvert.
  const entries = balances.map(({ userId, balance }) => ({
    userId,
    balance,
    contribution: balance > 0 ? Math.floor((balance * percent) / 100) : 0,
    received: 0,
  }));

  const pot = entries.reduce((sum, e) => sum + e.contribution, 0);
  const share = Math.floor(pot / participants);
  for (const entry of entries) entry.received = share;

  // Le reste de la division entière part à autant de membres tirés au sort, un
  // point chacun : la cagnotte est rendue jusqu'au dernier point.
  let remainder = pot - share * participants;
  const luckyOrder = entries.map((_, i) => i);
  for (let i = luckyOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [luckyOrder[i], luckyOrder[j]] = [luckyOrder[j], luckyOrder[i]];
  }
  for (let i = 0; i < remainder; i++) entries[luckyOrder[i]].received += 1;

  for (const entry of entries) entry.delta = entry.received - entry.contribution;

  return {
    participants,
    contributors: entries.filter((e) => e.contribution > 0).length,
    pot,
    share,
    entries,
  };
}

// ============================ EXÉCUTION ============================

function readBalances(userIds, cb) {
  if (!userIds.length) return cb(null, []);
  const placeholders = userIds.map(() => "?").join(",");
  db.all(
    `SELECT user_id, balance FROM points WHERE user_id IN (${placeholders})`,
    userIds,
    (err, rows) => {
      if (err) return cb(err);
      // Un membre sans ligne n'a simplement jamais gagné de point : solde nul,
      // il ne cotise pas mais touche sa part comme les autres.
      const known = new Map((rows || []).map((r) => [r.user_id, r.balance ?? 0]));
      cb(null, userIds.map((userId) => ({ userId, balance: known.get(userId) ?? 0 })));
    }
  );
}

// `failures` fait partie de la trace : sans lui, le journal affirmerait un pot
// équilibré que le grand livre ne reflète pas.
function journal(plan, percent, triggeredBy, failures) {
  db.run(
    `INSERT INTO points_redistributions
       (ran_at, triggered_by, rate, participants, contributors, pot, share, failures)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [Date.now(), triggeredBy, percent, plan.participants, plan.contributors, plan.pot, plan.share, failures],
    (err) => {
      if (err) handleException("Journal du pot commun :", err);
    }
  );
}

// Point d'entrée unique, partagé par le minuteur et par /admin potcommun.
// `dryRun` calcule tout et n'écrit rien.
// `resolved` permet au minuteur de passer les membres qu'il a déjà cherchés,
// pour que la partie qui peut échouer se joue AVANT qu'il ne consomme
// l'échéance de la semaine.
export async function runRedistribution(
  guild,
  { triggeredBy = null, dryRun = false, resolved = null } = {}
) {
  const percent = getRedistributionConfig().contributionPercent;

  const { role, members, reason } = resolved ?? (await fetchRoleMembers(guild));
  if (reason) return { ok: false, reason };

  // Une simulation ne prend pas le bail : elle ne touche à rien, et le prendre
  // reviendrait à empêcher le vrai pot de passer.
  let token = null;
  let applied = false;
  if (!dryRun) {
    token = await new Promise((resolve, reject) =>
      takeLease((err, value) => (err ? reject(err) : resolve(value)))
    );
    if (!token) {
      return {
        ok: false,
        transient: true,
        reason: "Un pot commun est déjà en cours. Réessaie dans un instant.",
      };
    }
  }

  try {
    const balances = await new Promise((resolve, reject) =>
      readBalances(
        members.map((m) => m.id),
        (err, rows) => (err ? reject(err) : resolve(rows))
      )
    );

    const plan = planRedistribution(balances, percent);
    if (plan.pot <= 0) {
      // Pas passager : tant que les soldes ne remontent pas, réessayer dans une
      // heure ne donnerait rien de plus. L'échéance est donc consommée, sinon le
      // pot hebdomadaire se transforme en boucle horaire qui refait un
      // guild.members.fetch() complet à chaque tour, indéfiniment.
      return {
        ok: false,
        reason: "Personne n'a de quoi cotiser : le pot serait vide.",
        plan,
        role,
        percent,
      };
    }

    if (dryRun) return { ok: true, dryRun: true, plan, role, percent };

    // Un seul mouvement par membre, le net : personne ne voit son solde plonger
    // le temps que la redistribution s'achève.
    const failures = await applyMovements(
      plan.entries.map((entry) => ({ userId: entry.userId, amount: entry.delta }))
    );
    // À partir d'ici l'argent a bougé. Tout ce qui échoue après ne doit plus
    // JAMAIS faire rendre l'échéance : le tour suivant prélèverait une seconde
    // fois. applyMovements lève si la transaction n'a pas été validée, donc
    // arriver ici veut bien dire que les soldes sont à jour.
    applied = true;
    journal(plan, percent, triggeredBy, failures);
    log(
      `Pot commun : ${plan.pot} points de ${plan.contributors} cotisant(s), ` +
        `${plan.share} par tête pour ${plan.participants} membre(s) du rôle ${role.name}` +
        (failures ? ` — ${failures} échec(s)` : "")
    );
    return { ok: true, plan, role, percent, failures, applied };
  } catch (error) {
    // Le marqueur voyage avec l'exception : c'est lui qui interdit au minuteur
    // de rendre une échéance dont le versement a déjà eu lieu.
    error.applied = applied;
    throw error;
  } finally {
    if (token) {
      await new Promise((resolve) =>
        releaseLease(token, (err) => {
          if (err) handleException("Libération du bail de pot commun :", err);
          resolve();
        })
      );
    }
  }
}

// ============================ RÉCAPITULATIF ============================

// Réservé aux administrateurs : ce récapitulatif ne part jamais dans un salon
// public, il n'apparaît que dans la réponse éphémère de /admin potcommun.
export function buildRedistributionEmbed(result) {
  const { plan, role, percent, dryRun } = result;
  const top = [...plan.entries]
    .filter((e) => e.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3);

  const embed = new EmbedBuilder()
    .setTitle(dryRun ? "🍯 Pot commun — simulation" : "🍯 Pot commun")
    .setColor(0xf1c40f)
    .setDescription(
      `**${percent} %** de la fortune de chacun sont partis au pot, ` +
        `puis la cagnotte est revenue en parts égales.`
    )
    .addFields(
      { name: "Cagnotte", value: `**${plan.pot}** points`, inline: true },
      { name: "Part de chacun", value: `**${plan.share}** points`, inline: true },
      {
        name: "Bénéficiaires",
        value: `**${plan.participants}** ${role ? `(${role.name})` : ""}`.trim(),
        inline: true,
      }
    )
    .setTimestamp();

  if (top.length) {
    embed.addFields({
      name: "Plus grosses cotisations",
      value: top.map((e) => `• <@${e.userId}> — **${e.contribution}** points`).join("\n"),
      inline: false,
    });
  }

  const gagnants = plan.entries.filter((e) => e.delta > 0).length;
  embed.setFooter({
    text: `${gagnants} membre(s) y gagnent, ${plan.participants - gagnants} y perdent ou font jeu égal`,
  });

  return embed;
}

// ============================ MINUTEUR ============================

// Tick horaire : rien ne se passe tant que l'échéance n'est pas atteinte.
//
// L'ordre compte. Le serveur est résolu AVANT de revendiquer l'échéance, sinon
// une coupure de Discord consommerait le créneau et sauterait le pot de la
// semaine — le même piège que la pause des apparitions posée avant l'envoi du
// message du parc.
export async function maybeRunRedistribution(client) {
  const config = getRedistributionConfig();
  if (!config.enabled) return null;
  const intervalMs = Math.max(1, config.intervalHours) * 3600 * 1000;

  const planned = await new Promise((resolve) =>
    scheduleFirst(intervalMs, (err, ok) => {
      if (err) handleException("Première échéance du pot commun :", err);
      resolve(ok);
    })
  );
  if (planned) {
    return log(`Pot commun : première échéance posée dans ${config.intervalHours} h.`);
  }

  // Coup d'œil avant d'aller chercher le serveur : 167 ticks sur 168 n'ont rien
  // à faire, autant ne pas appeler Discord pour rien. Ce n'est qu'une économie —
  // c'est l'UPDATE gardé ci-dessous qui fait office de verrou.
  const dueAt = await new Promise((resolve) =>
    getNextRedistributionAt((err, at) => resolve(err ? 0 : at))
  );
  if (!dueAt || dueAt > Date.now()) return null;

  // TOUT ce qui peut échouer se joue avant la revendication, et pas seulement
  // la résolution du serveur : guild.members.fetch() expire au bout de deux
  // minutes, tombe sur une reconnexion de la passerelle, ou se heurte à
  // l'intention GUILD_MEMBERS désactivée. Revendiquer d'abord, c'était brûler
  // le pot de la semaine sur un hoquet de Discord.
  const guild = await client.guilds.fetch(process.env.GUILD_ID).catch((error) => {
    handleException("Pot commun : serveur introuvable", error);
    return null;
  });
  if (!guild) return null;

  const resolved = await fetchRoleMembers(guild).catch((error) => {
    handleException("Pot commun : liste des membres indisponible", error);
    return null;
  });
  if (!resolved) return null;
  if (resolved.reason) return log(`Pot commun reporté : ${resolved.reason}`);

  const claimedAt = await new Promise((resolve) =>
    claimRedistribution(intervalMs, (err, at) => {
      if (err) handleException("Revendication du pot commun :", err);
      resolve(at);
    })
  );
  if (!claimedAt) return null;

  const result = await runRedistribution(guild, { triggeredBy: "auto", resolved }).catch(
    (error) => {
      handleException("Pot commun :", error);
      // Une exception levée APRÈS le versement reste un pot qui a eu lieu :
      // l'échéance doit rester consommée, sous peine de tout reprélever.
      return { ok: false, reason: error.message, transient: !error.applied, applied: error.applied };
    }
  );

  if (result.ok) return result;

  // L'échéance n'est rendue que sur un empêchement PASSAGER, et jamais si
  // l'argent a bougé. Un pot vide, lui, consomme la semaine : la rendre ferait
  // reprendre le tick chaque heure, guild.members.fetch() compris, sans fin.
  if (!result.transient || result.applied) {
    return log(`Pot commun annulé : ${result.reason} — l'échéance reste consommée.`);
  }

  await new Promise((resolve) =>
    rollbackClaim(dueAt, claimedAt, (err, restored) => {
      if (err) handleException("Restitution de l'échéance :", err);
      log(
        `Pot commun reporté : ${result.reason}` +
          (restored
            ? " — l'échéance est rendue, le tour suivant réessaiera."
            : " — l'échéance n'a PAS pu être rendue, le pot saute son tour.")
      );
      resolve();
    })
  );
  return null;
}
