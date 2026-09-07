// Routage de toutes les interactions « poke_* ».
//
// Rien n'est conservé en mémoire : chaque customId porte les identifiants
// nécessaires et l'état est relu en base. Les boutons continuent donc de
// fonctionner après un redémarrage du bot, sans collector ni réhydratation.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import { getBalance } from "../economy.js";
import { handleException, log } from "../utils.js";
import { getPokemonConfig } from "./config.js";
import { throwBall } from "./capture.js";
import { getSpawn } from "./spawn.js";
import { getSpecies } from "./data.js";
import {
  acceptTrade,
  describeEvolution,
  evolve,
  getCollection,
  getOwnedVariants,
  getTrade,
  resolveTradeAs,
} from "./collection.js";
import {
  buildDexEmbed,
  buildDexRow,
  buildTradeEmbed,
  buildTradeRow,
  displayName,
} from "./embeds.js";

const ephemeral = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});

// ---------------------- Master Ball ----------------------

function askMasterBallConfirmation(interaction, spawnId) {
  const ball = getPokemonConfig().capture.balls.master;
  getBalance(interaction.user.id, (err, balance) => {
    if (err) {
      handleException(err);
      return ephemeral(interaction, "❌ Erreur base de données.");
    }
    if (balance < ball.price) {
      return ephemeral(
        interaction,
        `❌ Une **${ball.label}** coûte **${ball.price}** points, tu en as **${balance}**.`
      );
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`poke_master_ok|${spawnId}`)
        .setLabel(`Confirmer (-${ball.price})`)
        .setEmoji(ball.emoji)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("poke_master_cancel")
        .setLabel("Annuler")
        .setStyle(ButtonStyle.Secondary)
    );

    interaction
      .reply({
        content:
          `⚠️ La **${ball.label}** garantit la capture mais coûte **${ball.price}** points, ` +
          `et ils sont perdus si quelqu'un t'attrape le Pokémon avant.\n` +
          `Ton solde : **${balance}** points.`,
        components: [row],
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  });
}

// ---------------------- « Je l'ai déjà ? » ----------------------

// Répond en privé au cliqueur, ce qu'un embed public ne peut pas faire :
// un message Discord est identique pour tous ses lecteurs.
function answerAlreadyOwned(interaction, spawnId) {
  getSpawn(spawnId, (err, spawn) => {
    if (err) {
      handleException(err);
      return ephemeral(interaction, "❌ Erreur base de données.");
    }
    if (!spawn) return ephemeral(interaction, "❌ Ce Pokémon est introuvable.");

    const species = getSpecies(spawn.species_id);
    if (!species) return ephemeral(interaction, "❌ Espèce inconnue.");

    getOwnedVariants(interaction.user.id, species.id, (err, owned) => {
      if (err) {
        handleException(err);
        return ephemeral(interaction, "❌ Erreur base de données.");
      }

      const plural = (n) => (n > 1 ? ` (×${n})` : "");

      if (spawn.is_shiny) {
        if (owned.shiny > 0) {
          return ephemeral(
            interaction,
            `✅ Tu as déjà **${species.name}** ✨ dans ton Pokédex${plural(owned.shiny)}.`
          );
        }
        return ephemeral(
          interaction,
          `🆕 Tu n'as pas encore **${species.name}** en shiny !` +
            (owned.normal > 0
              ? ` (tu possèdes la version normale${plural(owned.normal)})`
              : ` Et tu n'as même pas la version normale.`)
        );
      }

      if (owned.normal > 0) {
        return ephemeral(
          interaction,
          `✅ Tu as déjà **${species.name}** dans ton Pokédex${plural(owned.normal)}.`
        );
      }
      return ephemeral(
        interaction,
        `🆕 **${species.name}** n'est pas encore dans ton Pokédex !`
      );
    });
  });
}

// ---------------------- Pokédex ----------------------

function showDexPage(interaction, targetUserId, page) {
  getCollection(targetUserId, async (err, rows) => {
    if (err) {
      handleException(err);
      return ephemeral(interaction, "❌ Impossible de lire le Pokédex.");
    }
    let target = { username: "Dresseur inconnu", id: targetUserId };
    try {
      target = await interaction.client.users.fetch(targetUserId);
    } catch (error) {
      // Dresseur parti du serveur : on affiche quand même sa collection.
    }
    await interaction
      .update({
        embeds: [buildDexEmbed(target, rows || [], page)],
        components: [buildDexRow(targetUserId, page)],
      })
      .catch(() => {});
  });
}

// ---------------------- Évolution ----------------------

function runEvolution(interaction, speciesId, isShiny, chosenTargetId) {
  evolve(interaction.user.id, speciesId, isShiny, chosenTargetId, (err, result) => {
    if (err) {
      handleException(err);
      return interaction
        .update({ content: "❌ Erreur base de données.", embeds: [], components: [] })
        .catch(() => {});
    }
    if (!result.ok) {
      return interaction
        .update({ content: `❌ ${result.reason}`, embeds: [], components: [] })
        .catch(() => {});
    }

    const source = getSpecies(speciesId);
    log(
      `Fusion : ${interaction.user.id} transforme ${source.name} en ${result.target.name}` +
        ` (${result.plan.duplicates} doublons, ${result.plan.points} pts)`
    );
    interaction
      .update({
        content:
          `✨ Félicitations ! Ton **${displayName(source, isShiny)}** a évolué en ` +
          `**${displayName(result.target, isShiny)}** ! ` +
          `(-${result.plan.duplicates} doublons, -${result.plan.points} points)`,
        embeds: [],
        components: [],
      })
      .catch(() => {});
  });
}

function showEvolutionChoices(interaction, speciesId, isShiny) {
  const plan = describeEvolution(speciesId);
  if (plan.error) {
    return interaction
      .update({ content: `❌ ${plan.error}`, embeds: [], components: [] })
      .catch(() => {});
  }

  const row = new ActionRowBuilder();
  for (const target of plan.targets) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`poke_evo_pick|${speciesId}|${isShiny ? 1 : 0}|${target.id}`)
        .setLabel(target.name)
        .setStyle(ButtonStyle.Primary)
    );
  }

  const cost = describeEvolution(speciesId, plan.targets[0].id).points;
  interaction
    .update({
      content: `🎯 Choisis l'évolution (**${cost}** points, ${plan.duplicates} doublons) :`,
      embeds: [],
      components: [row],
    })
    .catch(() => {});
}

// ---------------------- Échanges ----------------------

function finishTrade(interaction, trade, status, note) {
  interaction
    .update({
      content: note ?? null,
      embeds: [buildTradeEmbed(trade, status)],
      components: [buildTradeRow(trade.id, { disabled: true })],
    })
    .catch(() => {});
}

function handleTradeButton(interaction, action, tradeId) {
  getTrade(tradeId, (err, trade) => {
    if (err || !trade) return ephemeral(interaction, "❌ Échange introuvable.");
    if (trade.status !== "PENDING") {
      return ephemeral(interaction, "❌ Cet échange a déjà été traité.");
    }

    const userId = interaction.user.id;
    if (action === "cancel") {
      if (userId !== trade.from_user_id) {
        return ephemeral(interaction, "❌ Seul l'auteur de l'offre peut l'annuler.");
      }
      return resolveTradeAs(tradeId, userId, "CANCELLED", (err, done) => {
        if (err) handleException(err);
        if (!done) return ephemeral(interaction, "❌ Cet échange a déjà été traité.");
        finishTrade(interaction, trade, "CANCELLED");
      });
    }

    if (userId !== trade.to_user_id) {
      return ephemeral(interaction, "❌ Cet échange ne t'est pas destiné.");
    }

    if (action === "decline") {
      return resolveTradeAs(tradeId, userId, "DECLINED", (err, done) => {
        if (err) handleException(err);
        if (!done) return ephemeral(interaction, "❌ Cet échange a déjà été traité.");
        finishTrade(interaction, trade, "DECLINED");
      });
    }

    acceptTrade(tradeId, (err, result) => {
      if (err) {
        handleException(err);
        return ephemeral(interaction, "❌ Erreur base de données.");
      }
      if (!result.ok) {
        return finishTrade(interaction, trade, "FAILED", `❌ ${result.reason}`);
      }
      log(`Échange #${tradeId} accepté entre ${trade.from_user_id} et ${trade.to_user_id}`);
      finishTrade(interaction, trade, "ACCEPTED");
    });
  });
}

// ---------------------- Routeur ----------------------

export async function handlePokemonButton(interaction) {
  const [action, ...args] = interaction.customId.split("|");

  switch (action) {
    case "poke_throw":
      return throwBall(interaction, args[0], args[1]);

    case "poke_master":
      return askMasterBallConfirmation(interaction, args[0]);

    case "poke_master_ok":
      return throwBall(interaction, args[0], "master");

    case "poke_master_cancel":
      return interaction
        .update({ content: "Annulé, tes points sont intacts.", components: [] })
        .catch(() => {});

    case "poke_owned":
      return answerAlreadyOwned(interaction, args[0]);

    case "poke_dex":
      return showDexPage(interaction, args[0], Number(args[1]));

    case "poke_evo": {
      const [speciesId, shiny, mode] = args;
      if (mode === "choose") {
        return showEvolutionChoices(interaction, Number(speciesId), shiny === "1");
      }
      return runEvolution(interaction, Number(speciesId), shiny === "1", null);
    }

    case "poke_evo_pick": {
      const [speciesId, shiny, targetId] = args;
      return runEvolution(interaction, Number(speciesId), shiny === "1", Number(targetId));
    }

    case "poke_trade_accept":
      return handleTradeButton(interaction, "accept", args[0]);
    case "poke_trade_decline":
      return handleTradeButton(interaction, "decline", args[0]);
    case "poke_trade_cancel":
      return handleTradeButton(interaction, "cancel", args[0]);

    default:
      return;
  }
}
