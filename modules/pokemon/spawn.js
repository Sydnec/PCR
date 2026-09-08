// Apparition des Pokémon : déclenchement, remplacement, rafraîchissement de
// l'embed et réparation au démarrage.
//
// Aucun collector, aucun timer de fuite : un spawn vit jusqu'à ce que le
// suivant le remplace. Tout l'état est en base, donc les boutons continuent de
// fonctionner après un redémarrage du bot.
import db from "../points-db.js";
import { handleException, log } from "../utils.js";
import { getPokemonConfig } from "./config.js";
import { getSpecies, pickWeightedSpecies, rarityOf } from "./data.js";
import {
  buildBallRow,
  buildCaughtEmbed,
  buildFledEmbed,
  buildOwnedRow,
  buildSpawnEmbed,
} from "./embeds.js";
import { recordSpawn, recordSpawnEnd } from "./stats.js";

// Rafraîchissements différés par spawn. Discord limite les éditions d'un même
// message à 5 par 5 secondes ; une salve de lancers les dépasserait largement.
const pendingRefreshes = new Map();

export function getActiveSpawn(cb) {
  db.get("SELECT * FROM pokemon_spawns WHERE status = 'ACTIVE'", [], cb);
}

export function getSpawn(spawnId, cb) {
  db.get("SELECT * FROM pokemon_spawns WHERE id = ?", [spawnId], cb);
}

// Qui a perdu combien sur ce spawn, et le total. Ce sont les points brûlés :
// les lancers ratés, jamais la capture gagnante ni les remboursements.
export function spendingBreakdown(spawnId, cb) {
  db.all(
    `SELECT user_id, SUM(cost) AS burned
       FROM pokemon_throws
      WHERE spawn_id = ? AND result = 'MISS'
      GROUP BY user_id
      ORDER BY burned DESC`,
    [spawnId],
    (err, rows) => {
      if (err) return cb(err, { total: 0, spenders: [] });
      const spenders = rows || [];
      cb(null, {
        total: spenders.reduce((sum, row) => sum + row.burned, 0),
        spenders,
      });
    }
  );
}

function recentThrows(spawnId, limit, cb) {
  db.all(
    `SELECT user_id, ball, result FROM pokemon_throws
      WHERE spawn_id = ? AND result != 'VOID'
      ORDER BY id DESC LIMIT ?`,
    [spawnId, limit],
    (err, rows) => cb(err, (rows || []).reverse())
  );
}

function releaseSpawnSlot() {
  db.run("UPDATE pokemon_state SET spawning = 0 WHERE id = 1", (err) => {
    if (err) handleException("Libération du verrou de spawn impossible :", err);
  });
}

function resolveChannel(client) {
  const channelId = process.env.POKEMON_CHANNEL_ID;
  if (!channelId) {
    log("⚠️ POKEMON_CHANNEL_ID non configuré, spawns Pokémon désactivés");
    return null;
  }
  return client.channels.fetch(channelId);
}

// Compte le message et, si les conditions sont réunies, revendique le droit de
// faire apparaître un Pokémon.
//
// La revendication tient en UNE instruction gardée : sur dix messages
// simultanés, un seul obtient this.changes === 1. C'est ce qui rend le
// double-spawn structurellement impossible, sans verrou en mémoire.
export function registerMessageForSpawn(client) {
  try {
    const config = getPokemonConfig();
    if (!config.enabled || !process.env.POKEMON_CHANNEL_ID) return;

    db.run("UPDATE pokemon_state SET message_count = message_count + 1 WHERE id = 1", (err) => {
      if (err) return handleException("Compteur de messages Pokémon :", err);

      const now = Date.now();
      const minDelayMs = config.spawn.minDelayMinutes * 60 * 1000;

      // Deux cas, en une seule instruction gardée pour rester atomique :
      //  - plus aucun Pokémon dans le salon (capturé ou enfui) : le prochain
      //    message en fait apparaître un, éventuellement après un court délai
      //    plancher réglable (0 par défaut) ;
      //  - un Pokémon est encore là : le seuil de messages et le délai
      //    minimum décident du moment où il s'enfuit, remplacé par le suivant.
      const afterEndMs = config.spawn.minDelayAfterEndMinutes * 60 * 1000;

      db.run(
        `UPDATE pokemon_state
            SET message_count = 0, last_spawn_at = ?, spawning = 1
          WHERE id = 1
            AND spawning = 0
            AND (
              ( NOT EXISTS (SELECT 1 FROM pokemon_spawns WHERE status = 'ACTIVE')
                AND COALESCE((SELECT MAX(ended_at) FROM pokemon_spawns), 0) <= ? )
              OR ( message_count >= ? AND last_spawn_at <= ? )
            )`,
        [now, now - afterEndMs, config.spawn.messagesPerSpawn, now - minDelayMs],
        function (err) {
          if (err) return handleException("Revendication du spawn :", err);
          if (this.changes === 1) doSpawn(client);
        }
      );
    });
  } catch (error) {
    handleException(error, "registerMessageForSpawn");
  }
}

// Revendique le créneau sans condition de seuil : utilisé par /pokespawn.
// Remet aussi le compteur et l'horloge à zéro, sinon un spawn automatique
// pourrait tomber juste après un événement et faire fuir le Pokémon annoncé.
export function claimForcedSpawn(cb) {
  db.run(
    `UPDATE pokemon_state
        SET message_count = 0, last_spawn_at = ?, spawning = 1
      WHERE id = 1 AND spawning = 0`,
    [Date.now()],
    function (err) {
      cb(err, this ? this.changes === 1 : false);
    }
  );
}

// Fait fuir le spawn actif et en crée un nouveau. Suppose le verrou déjà acquis.
export async function doSpawn(client, options = {}) {
  const { speciesId = null, forceShiny = null, announcement = null, ping = null } = options;

  try {
    const config = getPokemonConfig();
    const channel = await resolveChannel(client);
    if (!channel) return releaseSpawnSlot();

    const species = speciesId ? getSpecies(speciesId) : pickWeightedSpecies(config.spawn);
    if (!species) {
      log("⚠️ Aucune espèce disponible pour le spawn");
      return releaseSpawnSlot();
    }

    const isShiny =
      forceShiny !== null
        ? forceShiny
        : Math.floor(Math.random() * config.spawn.shinyOdds) === 0;

    getActiveSpawn(async (err, previous) => {
      if (err) {
        handleException("Lecture du spawn actif :", err);
        return releaseSpawnSlot();
      }

      // L'ancien doit passer en FLED AVANT l'insertion : l'index unique partiel
      // refuserait un second ACTIVE.
      const insertNew = () => createSpawn(client, channel, species, isShiny, announcement, ping, previous);

      if (!previous) return insertNew();

      db.run(
        "UPDATE pokemon_spawns SET status = 'FLED', ended_at = ? WHERE id = ? AND status = 'ACTIVE'",
        [Date.now(), previous.id],
        function (err) {
          if (err) {
            handleException("Fuite du spawn précédent :", err);
            return releaseSpawnSlot();
          }
          // La fuite n'est conclue que si ce spawn était bien encore actif :
          // la garde évite de la comptabiliser deux fois. L'affichage suit dans
          // createSpawn, une fois le nouveau message posté.
          if (this.changes !== 1) previous = null;
          insertNew();
        }
      );
    });
  } catch (error) {
    handleException(error, "doSpawn");
    releaseSpawnSlot();
  }
}

// Durée de vie tirée au sort, figée à la création : elle survit aux
// redémarrages et n'est jamais recalculée à la lecture.
export function rollFleeDeadline(spawnedAt, spawnConfig) {
  const { min, max } = spawnConfig.fleeAfterMinutes;
  const low = Math.min(min, max);
  const span = Math.abs(max - min);
  return spawnedAt + (low + Math.random() * span) * 60 * 1000;
}

function createSpawn(client, channel, species, isShiny, announcement, ping, previous) {
  const now = Date.now();
  const rarity = rarityOf(species);
  const fleesAt = Math.round(rollFleeDeadline(now, getPokemonConfig().spawn));

  db.run(
    `INSERT INTO pokemon_spawns (species_id, is_shiny, catch_rate, rarity, channel_id, spawned_at, flees_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [species.id, isShiny ? 1 : 0, species.catchRate, rarity, channel.id, now, fleesAt],
    async function (err) {
      if (err) {
        handleException("Insertion du spawn :", err);
        return releaseSpawnSlot();
      }

      const spawnId = this.lastID;
      const spawn = {
        id: spawnId,
        is_shiny: isShiny ? 1 : 0,
        catch_rate: species.catchRate,
        rarity,
        throw_count: 0,
      };

      const shouldPing =
        ping !== null
          ? ping
          : isShiny || getPokemonConfig().spawn.pingRarities.includes(rarity);
      const roleId = process.env.POKEMON_ROLE_ID;
      const content = shouldPing && roleId ? `<@&${roleId}>` : undefined;

      try {
        const message = await channel.send({
          content,
          embeds: [buildSpawnEmbed(spawn, species, [], announcement)],
          components: [buildBallRow(spawnId), buildOwnedRow(spawnId)],
        });

        db.run(
          "UPDATE pokemon_spawns SET message_id = ? WHERE id = ?",
          [message.id, spawnId],
          (err) => {
            if (err) handleException("Enregistrement du message de spawn :", err);
          }
        );

        db.run(
          "UPDATE pokemon_state SET spawning = 0, total_spawns = total_spawns + 1 WHERE id = 1",
          (err) => {
            if (err) handleException("Fin du spawn :", err);
          }
        );

        recordSpawn(spawn, species);

        log(
          `Spawn #${spawnId} : ${species.name}${isShiny ? " ✨" : ""} (${rarity}, rate ${species.catchRate})`
        );

        if (previous) endSpawnAsFled(client, previous);
      } catch (error) {
        // Envoi impossible : on annule le spawn plutôt que de laisser une ligne
        // ACTIVE sans message, qui bloquerait tous les spawns suivants.
        handleException("Envoi du message de spawn :", error);
        db.run(
          "UPDATE pokemon_spawns SET status = 'FLED', ended_at = ? WHERE id = ?",
          [Date.now(), spawnId],
          () => releaseSpawnSlot()
        );
      }
    }
  );
}

// Conclut un spawn en fuite : statistiques puis édition du message.
//
// Chemin unique partagé par les deux causes de fuite — le remplacement par un
// nouveau spawn, et l'expiration de la durée de vie — pour qu'il n'existe
// qu'une seule façon de terminer un Pokémon.
//
// L'affichage est best-effort : le message a pu être supprimé entre-temps, ce
// qui ne doit pas empêcher la fuite d'être comptabilisée.
export function endSpawnAsFled(client, spawn) {
  const species = getSpecies(spawn.species_id);
  if (!species) return;

  recordSpawnEnd(spawn, species);

  if (!spawn.channel_id || !spawn.message_id) return;

  spendingBreakdown(spawn.id, async (err, spending) => {
    if (err) handleException("Répartition des dépenses :", err);
    try {
      const channel = await client.channels.fetch(spawn.channel_id);
      const message = await channel.messages.fetch(spawn.message_id);
      await message.edit({
        content: null,
        embeds: [buildFledEmbed(spawn, species, spending)],
        components: [],
      });
    } catch (error) {
      log(`Message du spawn #${spawn.id} introuvable, fuite non affichée`);
    }
  });
}

// Rafraîchissement différé de l'embed d'un spawn en cours.
// Le flush relit toujours la base, donc les rafraîchissements concurrents
// convergent vers le bon état.
export function refreshSpawnEmbed(client, spawnId, { immediate = false } = {}) {
  const delay = immediate ? 0 : getPokemonConfig().spawn.embedRefreshMs;

  if (pendingRefreshes.has(spawnId)) {
    clearTimeout(pendingRefreshes.get(spawnId));
    pendingRefreshes.delete(spawnId);
  }

  const flush = () => {
    pendingRefreshes.delete(spawnId);
    getSpawn(spawnId, (err, spawn) => {
      if (err || !spawn || spawn.status !== "ACTIVE" || !spawn.message_id) return;
      const species = getSpecies(spawn.species_id);
      if (!species) return;

      recentThrows(spawnId, getPokemonConfig().spawn.throwLogSize, async (err, throws) => {
        if (err) return handleException("Lecture du journal des lancers :", err);
        try {
          const channel = await client.channels.fetch(spawn.channel_id);
          const message = await channel.messages.fetch(spawn.message_id);
          const description = message.embeds[0]?.description ?? null;
          await message.edit({
            embeds: [buildSpawnEmbed(spawn, species, throws, description)],
          });
        } catch (error) {
          log(`Rafraîchissement du spawn #${spawnId} impossible`);
        }
      });
    });
  };

  if (delay === 0) return flush();
  pendingRefreshes.set(spawnId, setTimeout(flush, delay));
}

// Édition finale après une capture : embed de victoire, boutons retirés.
export function finalizeCaughtSpawn(client, spawnId, winnerId, ballKey) {
  if (pendingRefreshes.has(spawnId)) {
    clearTimeout(pendingRefreshes.get(spawnId));
    pendingRefreshes.delete(spawnId);
  }

  getSpawn(spawnId, (err, spawn) => {
    if (err || !spawn || !spawn.message_id) return;
    const species = getSpecies(spawn.species_id);
    if (!species) return;

    spendingBreakdown(spawnId, async (err, spending) => {
      if (err) handleException("Répartition des dépenses :", err);
      try {
        const channel = await client.channels.fetch(spawn.channel_id);
        const message = await channel.messages.fetch(spawn.message_id);
        await message.edit({
          content: null,
          embeds: [buildCaughtEmbed(spawn, species, winnerId, ballKey, spending)],
          components: [],
        });
      } catch (error) {
        log(`Message du spawn #${spawnId} introuvable, capture non affichée`);
      }
    });
  });
}

// Réparation au démarrage.
//
// Un plantage entre l'insertion d'un spawn et l'envoi de son message laisse une
// ligne ACTIVE sans message_id. À cause de l'index unique partiel, plus AUCUN
// spawn ne pourrait jamais être inséré : le jeu serait définitivement gelé.
// Même chose pour un verrou spawning resté à 1.
export function rehydratePokemon(client) {
  db.run("UPDATE pokemon_state SET spawning = 0 WHERE id = 1 AND spawning = 1", function (err) {
    if (err) return handleException("Réinitialisation du verrou de spawn :", err);
    if (this.changes) log("Verrou de spawn Pokémon libéré après un arrêt brutal");
  });

  db.run(
    "UPDATE pokemon_spawns SET status = 'FLED', ended_at = ? WHERE status = 'ACTIVE' AND message_id IS NULL",
    [Date.now()],
    function (err) {
      if (err) return handleException("Nettoyage des spawns incomplets :", err);
      if (this.changes) log(`${this.changes} spawn(s) incomplet(s) nettoyé(s)`);
    }
  );

  // Un spawn antérieur à l'ajout de flees_at n'a pas d'échéance. On lui en
  // donne une à partir de maintenant : ni immortel, ni tué au premier tick.
  db.run(
    "UPDATE pokemon_spawns SET flees_at = ? WHERE status = 'ACTIVE' AND flees_at IS NULL",
    [Math.round(rollFleeDeadline(Date.now(), getPokemonConfig().spawn))],
    function (err) {
      if (err) return handleException("Attribution d'une échéance de fuite :", err);
      if (this.changes) log("Échéance de fuite attribuée au spawn en cours");
    }
  );

  // Un spawn dont le message a été supprimé bloquerait lui aussi tous les
  // suivants : on le fait fuir.
  getActiveSpawn(async (err, spawn) => {
    if (err || !spawn || !spawn.message_id) return;
    try {
      const channel = await client.channels.fetch(spawn.channel_id);
      await channel.messages.fetch(spawn.message_id);
      refreshSpawnEmbed(client, spawn.id, { immediate: true });
    } catch (error) {
      log(`Message du spawn actif #${spawn.id} introuvable, spawn libéré`);
      db.run(
        "UPDATE pokemon_spawns SET status = 'FLED', ended_at = ? WHERE id = ? AND status = 'ACTIVE'",
        [Date.now(), spawn.id]
      );
    }
  });
}
