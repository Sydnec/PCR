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
  PermissionFlagsBits,
} from "discord.js";
import { getBalance } from "../economy.js";
import { handleException, log } from "../utils.js";
import { getPokemonConfig, getSafariConfig } from "./config.js";
import { answerThrow, throwBall, trackPanel } from "./capture.js";
import { getSpawn } from "./spawn.js";
import {
  claimShare,
  enterPark,
  playAction,
  prepareShare,
  refreshParkMessage,
  releaseShare,
} from "./safari.js";
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
  buildBallRow,
  buildDexEmbed,
  buildDexRow,
  buildSafariRecapEmbed,
  buildSafariView,
  buildTradeEmbed,
  buildTradeRow,
  displayName,
} from "./embeds.js";

const ephemeral = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});

// ---------------------- Master Ball ----------------------

// Depuis le panneau de relance, la confirmation le TRANSFORME au lieu d'ouvrir
// un éphémère de plus : c'est tout l'intérêt du panneau.
function askMasterBallConfirmation(interaction, spawnId, { panel = false } = {}) {
  const ball = getPokemonConfig().capture.balls.master;

  // Un refus répond exactement comme un cooldown : même règle, même fonction.
  const refuse = (content) => answerThrow(interaction, spawnId, content, { panel });

  getBalance(interaction.user.id, (err, balance) => {
    if (err) {
      handleException(err);
      return refuse("❌ Erreur base de données.");
    }
    if (balance < ball.price) {
      return refuse(
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
        // Le spawnId permet de restaurer le panneau à l'annulation plutôt que
        // de laisser un message sans boutons.
        .setCustomId(`poke_master_cancel|${spawnId}`)
        .setLabel("Annuler")
        .setStyle(ButtonStyle.Secondary)
    );

    const payload = {
      content:
        `⚠️ La **${ball.label}** garantit la capture mais coûte **${ball.price}** points, ` +
        `et ils sont perdus si quelqu'un t'attrape le Pokémon avant.\n` +
        `Ton solde : **${balance}** points.`,
      components: [row],
    };

    (panel
      ? interaction.update(payload)
      : interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
    )
      // Depuis l'annonce, la confirmation est elle aussi un nouvel éphémère :
      // elle remplace le panneau ouvert plutôt que de le laisser derrière elle.
      // Le poke_master_ok qui suit réécrit ce message, la trace reste valide.
      .then(() => trackPanel(interaction, spawnId, { replacing: !panel }))
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

// ---------------------- Parc safari ----------------------

// Le parc vit dans un message éphémère réécrit à chaque clic : chaque bouton est
// une nouvelle interaction, donc un nouveau token, et la visite survit largement
// aux 15 minutes de validité d'un token d'interaction.

function handleSafariEnter(interaction, parkId) {
  enterPark(interaction.user.id, Number(parkId), (err, result) => {
    if (err) {
      handleException(err);
      return ephemeral(interaction, "❌ Erreur base de données.");
    }
    if (!result.ok) return ephemeral(interaction, `❌ ${result.reason}`);

    refreshParkMessage(interaction.client, Number(parkId));
    interaction
      .reply({
        ...buildSafariView(result.session, { owned: result.owned }),
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  });
}

// Partage du bilan dans le salon courant.
//
// L'ordre est dicté par ce qui peut échouer : on vérifie les autorisations
// AVANT de revendiquer, sinon un salon en lecture seule consommerait le droit
// de partager ; et on rend ce droit si l'envoi échoue quand même.
//
// La vérification porte sur DEUX permissions, pas une. Que le bot puisse écrire
// ne suffit pas : le parc s'annonce parfois dans un salon où les membres ne
// postent pas, et le bouton deviendrait un moyen d'y faire parler le bot.
function handleSafariShare(interaction, sessionId) {
  const channel = interaction.channel;
  if (!channel) return ephemeral(interaction, "❌ Salon introuvable.");

  prepareShare(interaction.user.id, Number(sessionId), async (err, result) => {
    if (err) {
      handleException(err);
      return ephemeral(interaction, "❌ Erreur base de données.");
    }
    if (!result.ok) return ephemeral(interaction, `❌ ${result.reason}`);

    const besoin = channel.isThread()
      ? PermissionFlagsBits.SendMessagesInThreads
      : PermissionFlagsBits.SendMessages;
    const dresseur = channel.permissionsFor(interaction.member);
    if (!dresseur?.has(PermissionFlagsBits.ViewChannel) || !dresseur.has(besoin)) {
      return ephemeral(interaction, `❌ Tu ne peux pas écrire dans ${channel}.`);
    }
    const moi = channel.permissionsFor(interaction.guild.members.me);
    if (!moi?.has(PermissionFlagsBits.ViewChannel) || !moi.has(besoin)) {
      return ephemeral(interaction, `❌ Je n'ai pas accès à ${channel}.`);
    }

    const claimed = await new Promise((resolve) =>
      claimShare(result.session.id, (err, ok) => {
        if (err) handleException("Revendication du partage :", err);
        resolve(ok);
      })
    );
    if (!claimed) return ephemeral(interaction, "❌ Ce bilan a déjà été partagé.");

    const embed = buildSafariRecapEmbed(result.session, result.catches, getSafariConfig(), {
      author: {
        displayName: interaction.member?.displayName ?? interaction.user.username,
        avatarURL: interaction.user.displayAvatarURL(),
      },
    });

    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      handleException("Partage du bilan de safari :", error);
      // Attendu, pas tiré puis oublié : le message invite à réessayer, la base
      // doit donc être dans l'état annoncé avant qu'il ne s'affiche.
      await new Promise((resolve) => releaseShare(result.session.id, resolve));
      return ephemeral(interaction, `❌ L'envoi dans ${channel} a échoué. Tu peux réessayer.`);
    }

    log(`Partage de bilan safari #${result.session.id} par ${interaction.user.username}`);
    // On réécrit l'éphémère : le bouton disparaît, et la confirmation prend la
    // place de l'invitation à partager.
    interaction
      .update({
        content: `✅ Bilan partagé dans ${channel}.`,
        ...buildSafariView({ ...result.session, shared_at: Date.now() }, {
          catches: result.catches,
        }),
      })
      .catch(() => {});
  });
}

function handleSafariAction(interaction, action, sessionId, token) {
  playAction(interaction.user.id, Number(sessionId), token, action, (err, result) => {
    if (err) {
      handleException(err);
      return ephemeral(interaction, "❌ Erreur base de données.");
    }
    // Une action refusée ne touche pas au plateau : le message en place reste
    // valide, on se contente d'expliquer à part pourquoi le clic n'a rien fait.
    if (!result.ok) return ephemeral(interaction, `❌ ${result.reason}`);

    interaction
      .update(
        buildSafariView(result.session, {
          result,
          catches: result.catches ?? [],
          owned: result.owned,
        })
      )
      .catch(() => {});
  });
}

// ---------------------- Routeur ----------------------

export async function handlePokemonButton(interaction) {
  const [action, ...args] = interaction.customId.split("|");

  switch (action) {
    // Depuis l'annonce publique : on ouvre le panneau de relance.
    case "poke_throw":
      return throwBall(interaction, args[0], args[1]);

    case "poke_master":
      return askMasterBallConfirmation(interaction, args[0]);

    // Depuis le panneau : on le réécrit, au lieu d'empiler un message par jet.
    case "poke_rethrow":
      return throwBall(interaction, args[0], args[1], { panel: true });

    case "poke_remaster":
      return askMasterBallConfirmation(interaction, args[0], { panel: true });

    // Toujours cliqué depuis un éphémère (la confirmation), donc toujours une
    // réécriture.
    case "poke_master_ok":
      return throwBall(interaction, args[0], "master", { panel: true });

    case "poke_master_cancel":
      return interaction
        .update({
          content: "Annulé, tes points sont intacts.",
          components: args[0] ? [buildBallRow(args[0], { panel: true })] : [],
        })
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

    case "poke_safari_enter":
      return handleSafariEnter(interaction, args[0]);

    case "poke_safari_ball":
      return handleSafariAction(interaction, "BALL", args[0], args[1]);
    case "poke_safari_bait":
      return handleSafariAction(interaction, "BAIT", args[0], args[1]);
    case "poke_safari_flee":
      return handleSafariAction(interaction, "FLEE", args[0], args[1]);

    case "poke_safari_share":
      return handleSafariShare(interaction, args[0]);

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
