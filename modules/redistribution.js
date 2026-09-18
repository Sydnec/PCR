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
      cb(err, this ? this.changes === 1 : false);
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

function journal(plan, percent, triggeredBy) {
  db.run(
    `INSERT INTO points_redistributions
       (ran_at, triggered_by, rate, participants, contributors, pot, share)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [Date.now(), triggeredBy, percent, plan.participants, plan.contributors, plan.pot, plan.share],
    (err) => {
      if (err) handleException("Journal du pot commun :", err);
    }
  );
}

// Point d'entrée unique, partagé par le minuteur et par /admin potcommun.
// `dryRun` calcule tout et n'écrit rien.
export async function runRedistribution(guild, { triggeredBy = null, dryRun = false } = {}) {
  const config = getRedistributionConfig();
  const percent = config.contributionPercent;

  const { role, members, error } = await fetchRoleMembers(guild);
  if (error) return { ok: false, reason: error };

  const balances = await new Promise((resolve, reject) =>
    readBalances(
      members.map((m) => m.id),
      (err, rows) => (err ? reject(err) : resolve(rows))
    )
  );

  const plan = planRedistribution(balances, percent);
  if (plan.pot <= 0) {
    return {
      ok: false,
      reason: `Personne n'a de quoi cotiser : le pot serait vide.`,
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
  journal(plan, percent, triggeredBy);
  log(
    `Pot commun : ${plan.pot} points de ${plan.contributors} cotisant(s), ` +
      `${plan.share} par tête pour ${plan.participants} membre(s) du rôle ${role.name}` +
      (failures ? ` — ${failures} échec(s)` : "")
  );
  return { ok: true, plan, role, percent, failures };
}

// ============================ RÉCAPITULATIF ============================

// Réservé aux administrateurs : ce récapitulatif ne part jamais dans un salon
// public, il n'apparaît que dans la réponse éphémère de /admin potcommun.
export function buildRedistributionEmbed(result, nameOf = (id) => `<@${id}>`) {
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
  const dueAt = await new Promise((resolve) => getNextRedistributionAt((err, at) => resolve(err ? 0 : at)));
  if (!dueAt || dueAt > Date.now()) return null;

  const guild = await client.guilds.fetch(process.env.GUILD_ID).catch((error) => {
    handleException("Pot commun : serveur introuvable", error);
    return null;
  });
  if (!guild) return null;

  const claimed = await new Promise((resolve) =>
    claimRedistribution(intervalMs, (err, ok) => {
      if (err) handleException("Revendication du pot commun :", err);
      resolve(ok);
    })
  );
  if (!claimed) return null;

  const result = await runRedistribution(guild, { triggeredBy: "auto" });
  if (!result.ok) return log(`Pot commun annulé : ${result.reason}`);
  return result;
}
