// Parc safari : l'événement public, les sessions individuelles et les rencontres.
//
// Même doctrine que le reste du module Pokémon : rien en mémoire, tout l'état en
// base, et chaque mutation passe par un UPDATE gardé dont on inspecte
// this.changes. Les boutons répondent donc encore après un redémarrage du bot.
//
// Le jeton anti-double-clic est `actions_left` lui-même : il décroît strictement,
// donc il identifie une action de façon unique. Il voyage dans le customId du
// bouton et sert de garde dans le WHERE — inutile d'inventer une colonne pour ça.
//
// Ici les actions sont gratuites : le parc n'est pas un puits à points, c'est la
// contrepartie du malus d'apparition infligé aux évolutions et aux légendaires.
// Seule l'entrée payante (/safari) débite quelque chose.
import db from "../points-db.js";
import { addPoints, getBalance, spendPoints } from "../economy.js";
import { handleException, log } from "../utils.js";
import { getPokemonConfig, getSafariConfig } from "./config.js";
import {
  getSpecies,
  rollSafariEncounter,
  safariBaitCapped,
  safariCatchProbability,
} from "./data.js";
import { creditSpecies, getOwnedVariants } from "./collection.js";
import { resolveChannel } from "./spawn.js";
import { recordSafariCatch, recordSafariEntry } from "./stats.js";
import { buildParkEmbed, buildParkRow } from "./embeds.js";

const HOUR = 60 * 60 * 1000;

// Les noms de colonnes finissent concaténés dans le SQL : ils viennent de cette
// table et jamais de l'appelant, comme la liste blanche de stats.js.
const ACTION_COLUMNS = {
  BALL: "balls_thrown",
  BAIT: "baits_used",
  FLEE: "flees",
};

// Refus que plusieurs gardes peuvent produire — l'index unique et la
// vérification qui le précède, par exemple. Un seul libellé, pour que le joueur
// lise la même phrase quel que soit le chemin qui l'a arrêté.
const REFUSALS = {
  ALREADY_IN_PARK: "Tu es déjà dans le parc ! Termine ta visite en cours d'abord.",
  ALREADY_ENTERED: "Tu es déjà entré dans ce parc safari : c'est une visite par dresseur.",
  REPLAYED: "Cette action a déjà été jouée.",
};

const refuse = (code, extra = {}) => ({
  ok: false,
  code,
  reason: REFUSALS[code],
  ...extra,
});

// Rafraîchissements différés du message de parc. Discord plafonne les éditions
// d'un même message à 5 par 5 secondes, et une salve d'entrées juste après le
// ping les dépasserait. Même mécanique que refreshSpawnEmbed.
const pendingParkRefreshes = new Map();

// ====================== LECTURES ======================

function getSession(sessionId, cb) {
  db.get("SELECT * FROM pokemon_safari_sessions WHERE id = ?", [sessionId], cb);
}

function getPark(parkId, cb) {
  db.get("SELECT * FROM pokemon_safari_parks WHERE id = ?", [parkId], cb);
}

// Un parc ouvert où ce dresseur peut encore entrer gratuitement : l'événement
// public, ou un parc qui lui est réservé. Payer l'entrée alors qu'une visite
// offerte l'attend serait une mauvaise surprise, et /safari s'en sert pour
// rediriger vers le bouton plutôt que de débiter.
// Un parc réservé passe en premier : c'est un cadeau nominatif, il serait absurde
// de le laisser expirer au profit de l'événement public.
export function findFreeParkFor(userId, cb) {
  db.get(
    `SELECT * FROM pokemon_safari_parks AS park
      WHERE park.status = 'OPEN'
        AND park.expires_at > ?
        AND (park.reserved_for IS NULL OR park.reserved_for = ?)
        AND NOT EXISTS (SELECT 1 FROM pokemon_safari_sessions
                         WHERE park_id = park.id AND user_id = ?)
      ORDER BY park.reserved_for IS NULL, park.id DESC
      LIMIT 1`,
    [Date.now(), userId, userId],
    (err, row) => cb(err, row || null)
  );
}

function getSessionCatches(sessionId, cb) {
  db.all(
    `SELECT species_id, is_shiny FROM pokemon_safari_catches
      WHERE session_id = ? ORDER BY id`,
    [sessionId],
    (err, rows) => cb(err, rows || [])
  );
}

// ====================== RENCONTRES ======================

function rollNextEncounter(sessionId, config, cb) {
  const encounter = rollSafariEncounter(config);
  if (!encounter) return cb(new Error("Aucune espèce disponible pour le parc safari."));
  db.run(
    `UPDATE pokemon_safari_sessions
        SET encounter_no = encounter_no + 1,
            encounter_species_id = ?,
            encounter_is_shiny = ?,
            encounter_catch_rate = ?,
            encounter_bait = 0
      WHERE id = ?`,
    [encounter.species.id, encounter.isShiny ? 1 : 0, encounter.catchRate, sessionId],
    (err) => cb(err)
  );
}

// Joint au résultat l'état de la collection du dresseur pour l'espèce en face de
// lui. Sur un spawn public, cette question passe par le bouton « Je l'ai déjà ? »
// parce qu'un message Discord est identique pour tous ses lecteurs ; ici la
// rencontre est éphémère et n'appartient qu'à un joueur, donc la réponse tient
// directement dans l'embed.
function withOwned(payload, cb) {
  const session = payload.session;
  // Une visite terminée affiche son bilan, pas une rencontre : rien à lire.
  if (!session || session.status !== "ACTIVE" || session.actions_left <= 0) {
    return cb(null, payload);
  }
  getOwnedVariants(session.user_id, session.encounter_species_id, (err, owned) => {
    // Une collection illisible ne doit jamais faire échouer une action déjà
    // jouée et déjà décomptée : on affiche la rencontre sans la pastille.
    if (err) handleException("Lecture de la collection au parc safari :", err);
    cb(null, { ...payload, owned: err ? null : owned });
  });
}

// ====================== SESSIONS ======================

// Une session expirée reste ACTIVE tant que personne ne l'a close, et occupe
// l'index unique : sans ce nettoyage, un joueur qui abandonne à mi-parcours ne
// pourrait plus jamais entrer.
function expireStaleSessions(userId, cb) {
  const now = Date.now();
  const where = userId ? "AND user_id = ?" : "";
  const params = userId ? [now, userId, now] : [now, now];
  db.run(
    `UPDATE pokemon_safari_sessions SET status = 'EXPIRED', ended_at = ?
      WHERE status = 'ACTIVE' ${where} AND expires_at <= ?`,
    params,
    function (err) {
      if (err) handleException("Expiration des sessions de parc safari :", err);
      cb(err, this ? this.changes : 0);
    }
  );
}

// Deux index uniques peuvent refuser l'insertion d'une session. SQLite nomme les
// colonnes en conflit et non l'index, et ce texte n'est pas un contrat : on
// demande donc à la base laquelle des deux règles a joué, plutôt que de lire
// dans l'erreur.
function explainSessionConflict(userId, parkId, cb) {
  db.get(
    `SELECT
       EXISTS(SELECT 1 FROM pokemon_safari_sessions
               WHERE user_id = ? AND status = 'ACTIVE') AS in_park,
       EXISTS(SELECT 1 FROM pokemon_safari_sessions
               WHERE user_id = ? AND park_id IS NOT NULL AND park_id = ?) AS entered`,
    [userId, userId, parkId],
    (err, row) => {
      if (err) return cb(err);
      if (row?.in_park) return cb(null, refuse("ALREADY_IN_PARK"));
      if (row?.entered) return cb(null, refuse("ALREADY_ENTERED"));
      // Aucune des deux règles ne s'applique : la contrainte violée n'est pas
      // celle qu'on croit, et la masquer rendrait le bug introuvable.
      cb(new Error("Insertion de session de parc safari refusée par la base."));
    }
  );
}

function startSession(userId, { parkId = null, entryCost = 0 }, cb) {
  const config = getSafariConfig();
  const now = Date.now();

  expireStaleSessions(userId, () => {
    const encounter = rollSafariEncounter(config);
    if (!encounter) {
      return cb(new Error("Aucune espèce disponible pour le parc safari."));
    }

    db.run(
      `INSERT INTO pokemon_safari_sessions
         (park_id, user_id, actions_left, entry_cost, started_at, expires_at,
          encounter_no, encounter_species_id, encounter_is_shiny, encounter_catch_rate)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        parkId,
        userId,
        config.actionsPerSession,
        entryCost,
        now,
        now + config.sessionDurationMinutes * 60 * 1000,
        encounter.species.id,
        encounter.isShiny ? 1 : 0,
        encounter.catchRate,
      ],
      function (err) {
        // C'est la base qui arbitre, pas un SELECT préalable qui laisserait une
        // fenêtre entre la vérification et l'insertion.
        if (err) {
          if (err.code !== "SQLITE_CONSTRAINT") return cb(err);
          return explainSessionConflict(userId, parkId, cb);
        }

        getSession(this.lastID, (err, session) => {
          if (err) return cb(err);
          recordSafariEntry({ userId, cost: entryCost });
          log(
            `Parc safari : ${userId} entre (session #${session.id}, parc ${parkId ?? "—"}, ${entryCost} pts)`
          );
          withOwned({ ok: true, session }, cb);
        });
      }
    );
  });
}

// Entrée gratuite par le bouton du message de parc.
export function enterPark(userId, parkId, cb) {
  getPark(parkId, (err, park) => {
    if (err) return cb(err);
    if (!park || park.status !== "OPEN" || park.expires_at <= Date.now()) {
      return cb(null, { ok: false, reason: "Ce parc safari a fermé ses portes." });
    }
    if (park.reserved_for && park.reserved_for !== userId) {
      return cb(null, {
        ok: false,
        reason: "Ce parc safari est réservé à un autre dresseur.",
      });
    }

    startSession(userId, { parkId, entryCost: 0 }, (err, result) => {
      if (err) return cb(err);
      if (result.ok) bumpParkEntries(parkId);
      cb(null, result);
    });
  });
}

// Entrée payante par /safari.
export function startPaidSession(userId, cb) {
  const config = getSafariConfig();
  const price = Math.max(0, Math.round(config.entryPrice));
  const now = Date.now();
  const cooldownMs = config.entryCooldownHours * HOUR;

  // Les sessions abandonnées sont closes d'abord, sinon un joueur qui a quitté
  // en cours de route se verrait refuser l'entrée pour une visite finie.
  expireStaleSessions(userId, () => {
    db.get(
      `SELECT
         EXISTS(SELECT 1 FROM pokemon_safari_sessions
                 WHERE user_id = ? AND status = 'ACTIVE') AS in_park,
         (SELECT MAX(started_at) FROM pokemon_safari_sessions
           WHERE user_id = ? AND entry_cost > 0) AS last_paid`,
      [userId, userId],
      (err, row) => {
        if (err) return cb(err);

        // Les deux refus prévisibles passent avant le débit : l'index unique
        // rattraperait le cas, mais au prix d'un aller-retour débit/remboursement
        // que le joueur verrait passer sur son solde.
        if (row?.in_park) return cb(null, refuse("ALREADY_IN_PARK"));

        const lastAt = row?.last_paid ?? 0;
        if (lastAt && now - lastAt < cooldownMs) {
          return cb(null, {
            ok: false,
            code: "COOLDOWN",
            retryAt: lastAt + cooldownMs,
            reason: "Tu as déjà payé une entrée récemment.",
          });
        }

        // Débit atomique, comme pour un lancer de ball : refusé sans rien
        // prélever si le solde ne suffit pas.
        spendPoints(userId, price, (err, debited) => {
          if (err) return cb(err);
          if (!debited) {
            return getBalance(userId, (err, balance) =>
              cb(err, {
                ok: false,
                code: "BALANCE",
                reason:
                  `L'entrée du parc safari coûte **${price}** points, tu en as **${balance}**.`,
              })
            );
          }

          startSession(userId, { parkId: null, entryCost: price }, (err, result) => {
            // Filet de sécurité pour les courses que les gardes ci-dessus ne
            // peuvent pas couvrir. Chemin de remboursement unique et journalisé :
            // on ne rembourse qu'après un débit réussi, donc la ligne existe.
            if (err || !result.ok) {
              addPoints(userId, price, (refundErr) => {
                if (refundErr) {
                  handleException("Remboursement de l'entrée du parc safari :", refundErr);
                }
                log(`Remboursement de ${price} pts à ${userId} (entrée du parc impossible)`);
              });
              return err ? cb(err) : cb(null, { ...result, refunded: price });
            }
            cb(null, result);
          });
        });
      }
    );
  });
}

// ====================== ACTIONS ======================

// La seule écriture qui consomme une action. `actions_left = ?` est le jeton :
// exactement un appelant obtient this.changes === 1, donc un double-clic ne peut
// pas jouer deux fois. La garde user_id reste indispensable même sur un message
// éphémère — les customId sont devinables.
function consumeAction(sessionId, userId, token, column, cb) {
  db.run(
    `UPDATE pokemon_safari_sessions
        SET actions_left = actions_left - 1, ${column} = ${column} + 1
      WHERE id = ? AND user_id = ? AND status = 'ACTIVE'
        AND actions_left = ? AND expires_at > ?`,
    [sessionId, userId, token, Date.now()],
    function (err) {
      cb(err, this ? this.changes === 1 : false);
    }
  );
}

export function playAction(userId, sessionId, token, action, cb) {
  const column = ACTION_COLUMNS[action];
  if (!column) return cb(new Error(`Action de parc inconnue : ${action}`));

  getSession(sessionId, (err, session) => {
    if (err) return cb(err);
    if (!session || session.user_id !== userId) {
      return cb(null, { ok: false, reason: "Cette visite du parc n'est pas la tienne." });
    }
    if (session.status !== "ACTIVE" || session.expires_at <= Date.now()) {
      return cb(null, { ok: false, reason: "Ta visite du parc safari est terminée." });
    }
    if (session.actions_left !== Number(token)) return cb(null, refuse("REPLAYED"));

    const species = getSpecies(session.encounter_species_id);
    if (!species) {
      return cb(new Error(`Espèce de rencontre inconnue : ${session.encounter_species_id}`));
    }

    const config = getSafariConfig();

    // L'appât plafonné est refusé AVANT de consommer l'action : le bouton est
    // déjà désactivé dans ce cas, seul un clic sur un message périmé arrive ici,
    // et il ne doit pas coûter une action pour rien.
    if (action === "BAIT" && safariBaitCapped(session.encounter_bait, config)) {
      return cb(null, {
        ok: false,
        reason: `**${species.name}** n'a plus faim, un appât de plus ne changerait rien.`,
      });
    }

    consumeAction(sessionId, userId, session.actions_left, column, (err, consumed) => {
      if (err) return cb(err);
      if (!consumed) return cb(null, refuse("REPLAYED"));
      resolveAction({ session, species, action, config }, cb);
    });
  });
}

// L'action nous appartient : plus aucune course à craindre à partir d'ici.
function resolveAction({ session, species, action, config }, cb) {
  const isShiny = Boolean(session.encounter_is_shiny);
  const probability = safariCatchProbability(
    session.encounter_catch_rate,
    session.encounter_bait,
    config
  );
  const base = { species, isShiny, probability, baitStacks: session.encounter_bait };
  const done = (outcome, extra = {}) =>
    finishOrContinue(session.id, { ...base, outcome, ...extra }, cb);

  if (action === "BAIT") {
    return db.run(
      "UPDATE pokemon_safari_sessions SET encounter_bait = encounter_bait + 1 WHERE id = ?",
      [session.id],
      (err) => {
        if (err) return cb(err);
        const stacks = session.encounter_bait + 1;
        done("BAIT", {
          baitStacks: stacks,
          probability: safariCatchProbability(session.encounter_catch_rate, stacks, config),
        });
      }
    );
  }

  if (action === "FLEE") {
    if (Math.random() < config.fleeFailChance) return done("FLEE_FAILED");
    return rollNextEncounter(session.id, config, (err) =>
      err ? cb(err) : done("FLED")
    );
  }

  if (Math.random() >= probability) {
    // Raté. Le Pokémon peut en profiter pour détaler — jamais après un appât,
    // sinon appâter serait un piège et l'action n'aurait aucun intérêt.
    if (Math.random() < config.wildFleeChance) {
      return rollNextEncounter(session.id, config, (err) =>
        err ? cb(err) : done("MISS_FLED")
      );
    }
    return done("MISS");
  }

  creditSpecies(session.user_id, species.id, isShiny, (err) => {
    if (err) return cb(err);
    recordSafariCatch({ userId: session.user_id, species, isShiny });
    log(
      `Parc safari : ${session.user_id} attrape ${species.name}${isShiny ? " ✨" : ""} (session #${session.id})`
    );

    db.run(
      `INSERT INTO pokemon_safari_catches (session_id, species_id, is_shiny, caught_at)
       VALUES (?, ?, ?, ?)`,
      [session.id, species.id, isShiny ? 1 : 0, Date.now()],
      (err) => {
        if (err) handleException("Enregistrement d'une capture du parc safari :", err);
        db.run(
          "UPDATE pokemon_safari_sessions SET catches = catches + 1 WHERE id = ?",
          [session.id],
          (err) => {
            if (err) handleException("Compteur de captures du parc safari :", err);
            rollNextEncounter(session.id, config, (err) =>
              err ? cb(err) : done("CATCH")
            );
          }
        );
      }
    );
  });
}

// Relit la session après l'action et clôt la visite si les actions sont épuisées.
function finishOrContinue(sessionId, result, cb) {
  getSession(sessionId, (err, session) => {
    if (err) return cb(err);
    if (!session) return cb(new Error(`Session de parc introuvable : ${sessionId}`));
    if (session.actions_left > 0) {
      return withOwned({ ok: true, ...result, session, finished: false }, cb);
    }

    db.run(
      `UPDATE pokemon_safari_sessions SET status = 'FINISHED', ended_at = ?
        WHERE id = ? AND status = 'ACTIVE'`,
      [Date.now(), sessionId],
      (err) => {
        if (err) return cb(err);
        getSessionCatches(sessionId, (err, catches) => {
          if (err) return cb(err);
          log(
            `Parc safari : session #${sessionId} terminée (${session.catches} capture(s))`
          );
          cb(null, { ok: true, ...result, session, finished: true, catches });
        });
      }
    );
  });
}

// ====================== PARCS ======================

// Revendication atomique, sur le modèle de celle des spawns : la garde tient en
// une instruction, donc deux tirages simultanés ne peuvent pas ouvrir deux parcs.
// Un parc réservé échappe aux deux conditions : il est offert à la main par un
// administrateur et ne concurrence pas l'événement public.
function claimPark({ openedBy = null, reservedFor = null, ignoreCooldown = false }, cb) {
  const config = getSafariConfig();
  const now = Date.now();
  const cooldownBefore =
    ignoreCooldown || reservedFor ? now : now - config.minHoursBetweenParks * HOUR;

  db.run(
    `INSERT INTO pokemon_safari_parks (status, opened_at, expires_at, opened_by, reserved_for)
     SELECT 'OPEN', ?, ?, ?, ?
      WHERE ( ? IS NOT NULL
              OR NOT EXISTS (SELECT 1 FROM pokemon_safari_parks
                              WHERE status = 'OPEN' AND reserved_for IS NULL) )
        AND COALESCE((SELECT MAX(opened_at) FROM pokemon_safari_parks
                       WHERE reserved_for IS NULL), 0) <= ?`,
    [
      now,
      now + config.parkDurationHours * HOUR,
      openedBy,
      reservedFor,
      reservedFor,
      cooldownBefore,
    ],
    function (err) {
      if (err) return cb(err, null);
      cb(null, this.changes === 1 ? this.lastID : null);
    }
  );
}

// MAX par défaut : une pause plus courte ne doit jamais raccourcir celle déjà en
// cours. `clear` est l'exception explicite — un administrateur qui passe
// `pause:false` veut rendre le salon aux apparitions, y compris si un parc
// précédent l'avait gelé.
function setSpawnPause(until, { clear = false } = {}, cb = () => {}) {
  const sql = clear
    ? "UPDATE pokemon_state SET spawn_paused_until = 0 WHERE id = 1"
    : "UPDATE pokemon_state SET spawn_paused_until = MAX(spawn_paused_until, ?) WHERE id = 1";
  db.run(sql, clear ? [] : [Math.round(until)], (err) => {
    if (err) handleException("Pause des apparitions pendant le parc safari :", err);
    cb();
  });
}

function bumpParkEntries(parkId) {
  db.run(
    "UPDATE pokemon_safari_parks SET entries = entries + 1 WHERE id = ?",
    [parkId],
    (err) => {
      if (err) handleException("Compteur d'entrées du parc safari :", err);
    }
  );
}

export async function openPark(
  client,
  { openedBy = null, reservedFor = null, pauseSpawns = null, ignoreCooldown = false } = {}
) {
  try {
    const config = getSafariConfig();
    const channel = await resolveChannel(client);
    if (!channel) {
      return { ok: false, reason: "`POKEMON_CHANNEL_ID` n'est pas configuré." };
    }

    // Un parc public encore ouvert mais périmé occuperait l'index unique et
    // ferait échouer la revendication sans raison lisible.
    await new Promise((resolve) => sweepSafari(client, resolve));

    const parkId = await new Promise((resolve, reject) =>
      claimPark({ openedBy, reservedFor, ignoreCooldown }, (err, id) =>
        err ? reject(err) : resolve(id)
      )
    );
    if (!parkId) {
      return {
        ok: false,
        reason:
          "Un parc safari est déjà ouvert, ou le délai entre deux parcs n'est pas écoulé.",
      };
    }

    const park = await new Promise((resolve, reject) =>
      getPark(parkId, (err, row) => (err ? reject(err) : resolve(row)))
    );

    // Un parc réservé ne gèle pas le salon : c'est un cadeau personnel, pas un
    // événement de serveur.
    const shouldPause = pauseSpawns !== null ? pauseSpawns : !reservedFor;

    const roleId = process.env.POKEMON_ROLE_ID;
    const content = reservedFor
      ? `<@${reservedFor}>`
      : roleId
        ? `<@&${roleId}>`
        : undefined;

    try {
      const message = await channel.send({
        content,
        embeds: [buildParkEmbed(park)],
        components: [buildParkRow(parkId)],
      });

      db.run(
        "UPDATE pokemon_safari_parks SET channel_id = ?, message_id = ? WHERE id = ?",
        [channel.id, message.id, parkId],
        (err) => {
          if (err) handleException("Enregistrement du message de parc safari :", err);
        }
      );

      // La pause n'est posée qu'une fois le parc réellement annoncé : un envoi
      // raté referme le parc, et il ne doit pas laisser le salon gelé six heures
      // pour un événement que personne n'a vu.
      //
      // On attend l'écriture avant de rendre la main : openPark annonce l'état de
      // la pause dans son résultat, et le premier message posté juste après doit
      // déjà la voir, sans quoi un Pokémon pourrait apparaître en plein parc.
      if (shouldPause) {
        await new Promise((resolve) =>
          setSpawnPause(Date.now() + config.spawnPauseHours * HOUR, {}, resolve)
        );
      } else if (pauseSpawns === false) {
        await new Promise((resolve) => setSpawnPause(0, { clear: true }, resolve));
      }

      log(
        `Parc safari #${parkId} ouvert${reservedFor ? ` pour ${reservedFor}` : ""}` +
          `${shouldPause ? `, apparitions suspendues ${config.spawnPauseHours} h` : ""}`
      );
      return { ok: true, parkId, park, paused: shouldPause };
    } catch (error) {
      // Envoi impossible : on referme le parc plutôt que de laisser une ligne
      // OPEN sans message, qui bloquerait tous les parcs suivants.
      handleException("Envoi du message de parc safari :", error);
      db.run(
        "UPDATE pokemon_safari_parks SET status = 'CLOSED', closed_at = ? WHERE id = ?",
        [Date.now(), parkId]
      );
      return { ok: false, reason: "Impossible de poster le message du parc safari." };
    }
  } catch (error) {
    handleException(error, "openPark");
    return { ok: false, reason: "Erreur lors de l'ouverture du parc safari." };
  }
}

// Tirage horaire. Le délai entre deux parcs est tenu par claimPark, donc un
// tirage gagnant trop tôt échoue simplement, sans bruit.
export async function maybeOpenRandomPark(client) {
  const config = getSafariConfig();
  if (!getPokemonConfig().enabled || !config.enabled) return null;
  if (Math.random() >= config.randomChancePerHour) return null;
  const result = await openPark(client);
  return result.ok ? result : null;
}

// L'affichage est best-effort : le message a pu être supprimé, ce qui ne doit
// jamais empêcher la fermeture d'être enregistrée.
function closeExpiredParks(client, cb = () => {}) {
  const now = Date.now();
  db.all(
    "SELECT * FROM pokemon_safari_parks WHERE status = 'OPEN' AND expires_at <= ?",
    [now],
    (err, rows) => {
      if (err) {
        handleException("Balayage des parcs safari :", err);
        return cb();
      }
      let remaining = (rows || []).length;
      if (!remaining) return cb();

      for (const park of rows) {
        db.run(
          `UPDATE pokemon_safari_parks SET status = 'CLOSED', closed_at = ?
            WHERE id = ? AND status = 'OPEN'`,
          [Date.now(), park.id],
          function (err) {
            const finish = () => {
              if (--remaining === 0) cb();
            };
            if (err) {
              handleException("Fermeture d'un parc safari :", err);
              return finish();
            }
            if (this.changes !== 1) return finish();
            log(`Parc safari #${park.id} fermé (${park.entries} entrée(s))`);
            closeParkMessage(client, park).finally(finish);
          }
        );
      }
    }
  );
}

async function closeParkMessage(client, park) {
  if (!client || !park.channel_id || !park.message_id) return;
  try {
    const channel = await client.channels.fetch(park.channel_id);
    const message = await channel.messages.fetch(park.message_id);
    await message.edit({
      content: null,
      embeds: [buildParkEmbed(park, { closed: true })],
      components: [],
    });
  } catch (error) {
    log(`Message du parc safari #${park.id} introuvable, fermeture non affichée`);
  }
}

// Rafraîchissement différé du compteur d'entrées. Le flush relit la base, donc
// les rafraîchissements concurrents convergent vers le bon état.
export function refreshParkMessage(client, parkId) {
  const delay = getPokemonConfig().spawn.embedRefreshMs;

  if (pendingParkRefreshes.has(parkId)) {
    clearTimeout(pendingParkRefreshes.get(parkId));
    pendingParkRefreshes.delete(parkId);
  }

  const flush = () => {
    pendingParkRefreshes.delete(parkId);
    getPark(parkId, async (err, park) => {
      if (err || !park || park.status !== "OPEN" || !park.message_id) return;
      try {
        const channel = await client.channels.fetch(park.channel_id);
        const message = await channel.messages.fetch(park.message_id);
        await message.edit({ embeds: [buildParkEmbed(park)] });
      } catch (error) {
        log(`Rafraîchissement du parc safari #${parkId} impossible`);
      }
    });
  };

  if (delay === 0) return flush();
  pendingParkRefreshes.set(parkId, setTimeout(flush, delay));
}

// ====================== MÉNAGE ======================

// Une session ACTIVE périmée occupe l'index unique et empêche son propriétaire
// de rejouer ; un parc OPEN périmé bloque tous les suivants. Les deux se
// rattrapent ici, et c'est le seul endroit où on le fait : au démarrage après un
// arrêt brutal, à chaque tour d'horloge, et juste avant d'ouvrir un parc — un
// administrateur ne doit pas se voir refuser une ouverture à cause d'un parc
// périmé que le balayage horaire n'a pas encore vu passer.
export function sweepSafari(client, cb = () => {}) {
  expireStaleSessions(null, (err, changes) => {
    if (!err && changes) {
      log(`${changes} session(s) de parc safari expirée(s) close(s)`);
    }
    closeExpiredParks(client, cb);
  });
}
