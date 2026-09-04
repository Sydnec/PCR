// Lancer de ball : la partie la plus délicate du système.
//
// Course à un seul vainqueur avec débit direct des points. Deux invariants à
// tenir absolument :
//   1. aucun solde ne passe sous zéro, même sur des clics simultanés ;
//   2. deux personnes ne capturent jamais le même Pokémon.
//
// Les deux reposent sur des UPDATE gardés dont on inspecte this.changes, et non
// sur un enchaînement de SELECT puis UPDATE, qui laisserait une fenêtre entre
// les deux. À noter : db.serialize(async () => {...}) ne protège rien après le
// premier await — d'où le chaînage explicite en callbacks ci-dessous.
import { MessageFlags } from "discord.js";
import db from "../points-db.js";
import { addPoints, getBalance, spendPoints } from "../economy.js";
import { handleException, log } from "../utils.js";
import { getBall, getPokemonConfig } from "./config.js";
import { catchProbability, getSpecies } from "./data.js";
import { displayName } from "./embeds.js";
import { finalizeCaughtSpawn, refreshSpawnEmbed } from "./spawn.js";
import { recordSpawnEnd, recordThrow } from "./stats.js";

// Anti-spam. Entièrement synchrone, donc atomique dans la boucle d'événements :
// l'écriture a lieu avant le moindre await, aucun entrelacement possible.
// En mémoire, donc remis à zéro au redémarrage — sans incidence sur la
// correction, le débit et la réclamation restant gardés.
const lastThrowAt = new Map();

function tryConsumeCooldown(userId, cooldownMs) {
  if (cooldownMs <= 0) return 0;
  const now = Date.now();
  const previous = lastThrowAt.get(userId) || 0;
  if (now - previous < cooldownMs) {
    return Math.ceil((cooldownMs - (now - previous)) / 1000);
  }
  lastThrowAt.set(userId, now);
  return 0;
}

function logThrow(spawnId, userId, ballKey, cost, probability, result) {
  db.run(
    `INSERT INTO pokemon_throws (spawn_id, user_id, ball, cost, probability, result, thrown_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [spawnId, userId, ballKey, cost, probability, result, Date.now()],
    (err) => {
      if (err) handleException("Enregistrement du lancer :", err);
    }
  );
}

function creditCollection(userId, speciesId, isShiny, cb = () => {}) {
  const now = Date.now();
  db.run(
    `INSERT INTO pokemon_collection (user_id, species_id, is_shiny, count, first_caught_at, last_caught_at)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(user_id, species_id, is_shiny) DO UPDATE SET
       count = count + 1,
       first_caught_at = COALESCE(first_caught_at, excluded.first_caught_at),
       last_caught_at = excluded.last_caught_at`,
    [userId, speciesId, isShiny ? 1 : 0, now, now],
    (err) => {
      if (err) handleException("Crédit de la collection :", err);
      cb(err);
    }
  );
}

// Chemin de remboursement unique et journalisé. Le crédit est inconditionnel et
// sûr : on ne rembourse qu'après un débit réussi, donc la ligne existe.
function refundThrow(interaction, spawnId, ball, probability) {
  const userId = interaction.user.id;
  addPoints(userId, ball.price, (err) => {
    if (err) handleException("Remboursement impossible :", err);
    logThrow(spawnId, userId, ball.key, ball.price, probability, "VOID");
    log(`Remboursement de ${ball.price} pts à ${userId} (spawn #${spawnId} déjà résolu)`);
    interaction
      .editReply({
        content: `💨 Trop tard, quelqu'un a été plus rapide ! Tes **${ball.price}** points ont été remboursés.`,
      })
      .catch(() => {});
  });
}

export async function throwBall(interaction, spawnId, ballKey) {
  const config = getPokemonConfig();
  const ball = getBall(ballKey);
  const userId = interaction.user.id;

  if (!ball) {
    return interaction.reply({
      content: "❌ Ball inconnue.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const remaining = tryConsumeCooldown(userId, config.capture.throwCooldownSeconds * 1000);
  if (remaining > 0) {
    return interaction.reply({
      content: `⏳ Doucement ! Attends encore **${remaining}s** avant de relancer.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  db.get("SELECT * FROM pokemon_spawns WHERE id = ?", [spawnId], (err, spawn) => {
    if (err) {
      handleException("Lecture du spawn :", err);
      return interaction.editReply({ content: "❌ Erreur base de données." }).catch(() => {});
    }
    // Sortie anticipée AVANT tout débit : un Pokémon déjà parti ne coûte rien.
    if (!spawn || spawn.status !== "ACTIVE") {
      return interaction
        .editReply({ content: "💨 Ce Pokémon n'est plus là !" })
        .catch(() => {});
    }

    const species = getSpecies(spawn.species_id);
    if (!species) {
      return interaction.editReply({ content: "❌ Espèce inconnue." }).catch(() => {});
    }

    const probability = ball.guaranteed
      ? 1
      : catchProbability(
          spawn.catch_rate,
          ball.multiplier,
          config.capture.globalMultiplier
        );

    // 1. Débit atomique : refusé sans rien prélever si le solde ne suffit pas.
    spendPoints(userId, ball.price, (err, debited) => {
      if (err) {
        handleException("Débit du lancer :", err);
        return interaction.editReply({ content: "❌ Erreur base de données." }).catch(() => {});
      }

      if (!debited) {
        return getBalance(userId, (err, balance) => {
          interaction
            .editReply({
              content: `❌ Solde insuffisant : une **${ball.label}** coûte **${ball.price}** points, tu en as **${balance}**.`,
            })
            .catch(() => {});
        });
      }

      // 2. Tirage.
      const success = ball.guaranteed || Math.random() < probability;

      if (!success) {
        // 3a. Un seul UPDATE sert à la fois de compteur et de garde « encore
        // actif » : si le Pokémon a été capturé entre le débit et le tirage,
        // on rend les points au lieu de les brûler pour rien.
        return db.run(
          "UPDATE pokemon_spawns SET throw_count = throw_count + 1 WHERE id = ? AND status = 'ACTIVE'",
          [spawnId],
          function (err) {
            if (err) {
              handleException("Comptabilisation du raté :", err);
              return refundThrow(interaction, spawnId, ball, probability);
            }
            if (this.changes === 0) {
              return refundThrow(interaction, spawnId, ball, probability);
            }

            logThrow(spawnId, userId, ball.key, ball.price, probability, "MISS");
            recordThrow({
              userId,
              speciesId: spawn.species_id,
              ball: ball.key,
              cost: ball.price,
              probability,
              result: "MISS",
            });
            refreshSpawnEmbed(interaction.client, spawnId);
            interaction
              .editReply({
                content: `❌ Raté ! **${displayName(species, spawn.is_shiny)}** s'est dégagé de ta ${ball.label}. (**-${ball.price}** points, ${(probability * 100).toFixed(1)} % de réussite)`,
              })
              .catch(() => {});
          }
        );
      }

      // 3b. Réclamation atomique : exactement un appelant obtient changes === 1.
      const now = Date.now();
      db.run(
        `UPDATE pokemon_spawns
            SET status = 'CAUGHT', caught_by = ?, caught_at = ?, caught_ball = ?,
                ended_at = ?, throw_count = throw_count + 1
          WHERE id = ? AND status = 'ACTIVE'`,
        [userId, now, ball.key, now, spawnId],
        function (err) {
          if (err) {
            handleException("Réclamation du spawn :", err);
            return refundThrow(interaction, spawnId, ball, probability);
          }
          if (this.changes === 0) {
            // Battu à la milliseconde près.
            return refundThrow(interaction, spawnId, ball, probability);
          }

          logThrow(spawnId, userId, ball.key, ball.price, probability, "CATCH");
          recordThrow({
            userId,
            speciesId: spawn.species_id,
            ball: ball.key,
            cost: ball.price,
            probability,
            result: "CATCH",
          });
          recordSpawnEnd(spawn, species, {
            caughtBy: userId,
            ball: ball.label,
            probability,
          });
          creditCollection(userId, spawn.species_id, spawn.is_shiny, () => {
            finalizeCaughtSpawn(interaction.client, spawnId, userId, ball.key);
            log(
              `Capture : ${userId} attrape ${species.name}${spawn.is_shiny ? " ✨" : ""} (spawn #${spawnId}, ${ball.key})`
            );
            interaction
              .editReply({
                content: `🎉 Bravo ! **${displayName(species, spawn.is_shiny)}** rejoint ton Pokédex ! (**-${ball.price}** points)`,
              })
              .catch(() => {});
          });
        }
      );
    });
  });
}
