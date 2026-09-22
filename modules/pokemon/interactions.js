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
import { buildBalanceEmbed, getBalance } from "../economy.js";
import { handleException, log } from "../utils.js";
import { getPokemonConfig } from "./config.js";
import { answerThrow, throwBall, trackPanel } from "./capture.js";
import { getSpawn } from "./spawn.js";
import { getBallItem, getBallStock, getItemCount } from "./items.js";
import { claimDrop } from "./drops.js";

import {
  claimShare,
  enterPark,
  playAction,
  prepareShare,
  refreshParkMessage,
  releaseShare,
} from "./safari.js";
import { evolutionChain, getSpecies } from "./data.js";
import {
  acceptTrade,
  describeEvolution,
  evolve,
  getCollection,
  getOwnedVariantsFor,
  getTrade,
  resolveTradeAs,
} from "./collection.js";
import {
  buildBallRow,
  buildDexEmbed,
  buildDexRow,
  buildDropEmbed,
  buildSafariRecapEmbed,
  buildSafariView,
  buildSpeciesInfoEmbed,
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

  const item = getBallItem("master");
  // Une Master Ball offerte se confirme aussi. Elle ne coûte rien, mais elle ne
  // se retrouve pas : un mésclic reste irrattrapable, ce pour quoi cette
  // confirmation existe.
  getItemCount(interaction.user.id, item?.key ?? "", (err, held) => {
    if (err) handleException("Lecture des Master Balls offertes :", err);
    const gratuite = held > 0;

    const suite = (balance) => {
      if (!gratuite && balance < ball.price) {
        return refuse(
          `❌ Une **${ball.label}** coûte **${ball.price}** points, tu en as **${balance}**.`
        );
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          // Le customId porte la promesse faite au dresseur : si la Master Ball
          // annoncée gratuite a disparu entre-temps, le lancer doit refuser, pas
          // se rabattre sur 22 500 points jamais mentionnés.
          .setCustomId(`poke_master_ok|${spawnId}${gratuite ? "|item" : ""}`)
          .setLabel(gratuite ? "Utiliser ma Master Ball" : `Confirmer (-${ball.price})`)
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
        content: gratuite
          ? `⚠️ Tu vas utiliser ta **${ball.label}** offerte : la capture est garantie, mais ` +
            `elle est perdue si quelqu'un t'attrape le Pokémon avant.\n` +
            `Il t'en reste **${held}**.`
          : `⚠️ La **${ball.label}** garantit la capture mais coûte **${ball.price}** points, ` +
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
    };

    // Le solde ne sert qu'à celui qui va payer : inutile d'aller le lire pour
    // annoncer une ball qui ne coûte rien.
    if (gratuite) return suite(0);
    getBalance(interaction.user.id, (err, balance) => {
      if (err) {
        handleException(err);
        return refuse("❌ Erreur base de données.");
      }
      suite(balance);
    });
  });
}

// ---------------------- Fiche du Pokémon ----------------------

// Répond en privé au cliqueur, ce qu'un embed public ne peut pas faire : un
// message Discord est identique pour tous ses lecteurs. La fiche est celle de
// /pokeinfo, à ceci près qu'elle épouse l'apparition d'où vient le clic — sa
// variante shiny et son taux de capture figé.
//
// Le solde suit dans un second embed : les deux questions qu'on se pose devant
// une apparition sont « est-ce que je l'ai déjà ? » et « est-ce que je peux me
// payer une ball ? », et le prix de chacune est déjà sur les boutons d'à côté.
// Les balls en poche y figurent aussi, puisqu'elles passent avant le solde.
function answerSpeciesInfo(interaction, spawnId) {
  getSpawn(spawnId, (err, spawn) => {
    if (err) {
      handleException(err);
      return ephemeral(interaction, "❌ Erreur base de données.");
    }
    if (!spawn) return ephemeral(interaction, "❌ Ce Pokémon est introuvable.");

    const species = getSpecies(spawn.species_id);
    if (!species) return ephemeral(interaction, "❌ Espèce inconnue.");

    const chain = evolutionChain(species);
    getOwnedVariantsFor(
      interaction.user.id,
      chain.map((link) => link.id),
      (err, owned) => {
        // Compteurs à zéro en cas d'erreur : mieux vaut la fiche sans les
        // pastilles de possession qu'un refus sec devant une apparition.
        if (err) handleException("Lecture de la collection pour la fiche :", err);

        const fiche = buildSpeciesInfoEmbed(species, {
          owned,
          isShiny: Boolean(spawn.is_shiny),
          catchRate: spawn.catch_rate,
        });

        getBalance(interaction.user.id, (err, balance) => {
          // getBalance rend 0 sur erreur, ce qui ici serait un mensonge : mieux
          // vaut ne pas montrer un solde illisible que d'en montrer un faux. La
          // fiche, elle, part quand même.
          if (err) handleException("Lecture du solde pour la fiche :", err);
          const soldeKo = Boolean(err);
          getBallStock(interaction.user.id, (err, balls) => {
            if (err) handleException("Lecture des balls pour la fiche :", err);
            interaction
              .reply({
                embeds: soldeKo
                  ? [fiche]
                  : [fiche, buildBalanceEmbed(balance, { balls: err ? null : balls })],
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => {});
          });
        });
      }
    );
  });
}

// ---------------------- Objet au sol ----------------------

// Le ramassage est une course à un seul vainqueur, exactement comme la capture :
// le verrou est en base, pas dans la disparition du bouton. Le gagnant réécrit
// le message public — ce qui fait tomber le bouton pour tout le monde — et les
// autres reçoivent un mot en privé, parce que rien ne prouve qu'ils ont vu
// passer le message entre-temps.
function handleDropClaim(interaction, dropId) {
  claimDrop(interaction.user.id, Number(dropId), (err, claimed) => {
    if (err) {
      handleException("Ramassage d'un objet au sol :", err);
      return ephemeral(interaction, "❌ Erreur base de données.");
    }
    if (!claimed) {
      return ephemeral(interaction, "💨 Trop tard, quelqu'un a été plus rapide !");
    }

    log(`Ramassage : ${interaction.user.username} prend ${claimed.item.label}`);
    interaction
      .update({
        embeds: [buildDropEmbed(claimed.item, { claimedBy: interaction.user.id })],
        components: [],
      })
      .catch(() => {});
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

function runEvolution(interaction, speciesId, isShiny, chosenTargetId, helperKey = null) {
  evolve(interaction.user.id, speciesId, isShiny, chosenTargetId, helperKey, (err, result) => {
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
    const aide = result.plan.helper;
    const paye = [
      `-${result.plan.duplicates} doublon${result.plan.duplicates > 1 ? "s" : ""}`,
      aide ? `-${aide.quantity} ${aide.item.label}` : null,
      result.plan.points > 0 ? `-${result.plan.points} points` : null,
    ].filter(Boolean);

    log(
      `Fusion : ${interaction.user.id} transforme ${source.name} en ${result.target.name}` +
        ` (${result.plan.duplicates} doublons, ${result.plan.points} pts` +
        `${aide ? `, ${aide.quantity}× ${aide.item.label}` : ""})`
    );
    interaction
      .update({
        content:
          `✨ Félicitations ! Ton **${displayName(source, isShiny)}** a évolué en ` +
          `**${displayName(result.target, isShiny)}** ! (${paye.join(", ")})`,
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
      const evolutions = (result.evolutions ?? [])
        .map((e) => `${getSpecies(e.from)?.name} → ${getSpecies(e.to)?.name}`)
        .join(", ");
      log(
        `Échange #${tradeId} accepté entre ${trade.from_user_id} et ${trade.to_user_id}` +
          (evolutions ? ` (${evolutions})` : "")
      );
      finishTrade(interaction, trade, "ACCEPTED");
    });
  });
}

// ---------------------- Parc safari ----------------------

// Le parc vit dans un message éphémère réécrit à chaque clic : chaque bouton est
// une nouvelle interaction, donc un nouveau token, et la visite survit largement
// aux 15 minutes de validité d'un token d'interaction.
//
// Cet éphémère reste néanmoins un message que son destinataire peut fermer, et
// personne ne peut le lui rouvrir : c'est le bouton du parc qui le refait, avec
// la visite là où elle en était.

function handleSafariEnter(interaction, parkId) {
  enterPark(interaction.user.id, Number(parkId), (err, result) => {
    if (err) {
      handleException(err);
      return ephemeral(interaction, "❌ Erreur base de données.");
    }
    if (!result.ok) return ephemeral(interaction, `❌ ${result.reason}`);

    // Une reprise n'est pas une entrée : le compteur du parc n'a pas bougé.
    if (!result.resumed) refreshParkMessage(interaction.client, Number(parkId));
    interaction
      .reply({
        ...buildSafariView(result.session, {
          owned: result.owned,
          resumed: result.resumed,
        }),
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  });
}

// Codes d'erreur Discord qui PROUVENT que rien n'a été publié. Une coupure
// réseau, un délai dépassé ou un 5xx n'en font pas partie : la requête a pu
// aboutir malgré l'exception, et rouvrir le partage republierait le bilan une
// seconde fois — exactement l'invariant que shared_at existe pour tenir.
const ENVOI_IMPOSSIBLE = new Set([
  50001, // Missing Access
  50013, // Missing Permissions
  10003, // Unknown Channel
  50083, // Thread is archived
]);

// Partage du bilan dans le salon courant.
//
// L'ordre est dicté par ce qui peut échouer : les autorisations d'abord, sinon
// un salon en lecture seule consommerait le droit de partager ; la revendication
// ensuite ; et l'acquittement de l'interaction avant l'envoi, parce qu'une
// limite de débit sur le salon peut faire dépasser les trois secondes que
// Discord laisse pour répondre — au retour, le jeton serait mort.
//
// Seules les permissions du BOT sont vérifiées : c'est lui qui publie. Exiger
// que le dresseur puisse écrire dans le salon revenait à lui refuser un bouton
// que le bot lui avait mis sous les yeux, dans le salon même où le parc s'était
// annoncé — et ce bouton ne poste rien d'autre que le bilan d'une visite que le
// bot a lui-même arbitrée.
function handleSafariShare(interaction, sessionId) {
  const channel = interaction.channel;
  if (!channel) return ephemeral(interaction, "❌ Salon introuvable.");

  prepareShare(interaction.user.id, Number(sessionId), async (dbError, result) => {
    // Ce corps est asynchrone et détaché : le try/catch du routeur a déjà rendu
    // la main quand il s'exécute. Sans filet ici, la moindre exception partirait
    // en rejet non capturé et le dresseur resterait devant « l'application n'a
    // pas répondu ».
    let acquitte = false;
    const dire = (content) =>
      (acquitte
        ? interaction.followUp({ content, flags: MessageFlags.Ephemeral })
        : interaction.reply({ content, flags: MessageFlags.Ephemeral })
      ).catch(() => {});

    try {
      if (dbError) {
        handleException("Préparation du partage :", dbError);
        return dire("❌ Erreur base de données.");
      }
      if (!result.ok) return dire(`❌ ${result.reason}`);

      const envoi = channel.isThread()
        ? PermissionFlagsBits.SendMessagesInThreads
        : PermissionFlagsBits.SendMessages;
      // EmbedLinks en plus de l'envoi : sans elle Discord refuse l'embed, et la
      // garde raterait la seule chose qu'elle est censée voir venir.
      const moi = channel.permissionsFor(interaction.guild?.members.me);
      if (!moi?.has([PermissionFlagsBits.ViewChannel, envoi, PermissionFlagsBits.EmbedLinks])) {
        return dire(`❌ Je ne peux pas publier d'embed dans ${channel}.`);
      }
      if (channel.isThread() && channel.locked) {
        return dire(`❌ ${channel} est verrouillé.`);
      }

      const claim = await new Promise((resolve) =>
        claimShare(result.session.id, (err, ok) => resolve({ err, ok }))
      );
      // Une erreur de base n'est pas un bilan déjà partagé : le dire ainsi
      // inventerait un état qui n'existe pas, et enverrait chercher le bug au
      // mauvais endroit.
      if (claim.err) {
        handleException("Revendication du partage :", claim.err);
        return dire("❌ Erreur base de données.");
      }
      if (!claim.ok) return dire("❌ Ce bilan a déjà été partagé.");

      await interaction.deferUpdate();
      acquitte = true;

      const embed = buildSafariRecapEmbed(result.session, result.catches, {
        author: {
          // Pseudo ET avatar du membre : mélanger le surnom du serveur avec
          // l'avatar global signerait le bilan de deux personnes différentes.
          displayName: interaction.member?.displayName ?? interaction.user.username,
          avatarURL:
            interaction.member?.displayAvatarURL?.() ?? interaction.user.displayAvatarURL(),
        },
      });

      try {
        await channel.send({ embeds: [embed] });
      } catch (error) {
        handleException("Partage du bilan de safari :", error);
        if (!ENVOI_IMPOSSIBLE.has(error?.code)) {
          return dire(
            "⚠️ L'envoi a échoué, mais il a peut-être abouti quand même. Je ne rouvre pas le " +
              "partage pour ne pas risquer de publier ton bilan deux fois — va voir le salon."
          );
        }
        const releaseError = await new Promise((resolve) =>
          releaseShare(result.session.id, resolve)
        );
        if (releaseError) {
          handleException("Restitution du droit de partage :", releaseError);
          return dire("❌ L'envoi a échoué et je n'ai pas pu rouvrir le partage. Voir les logs.");
        }
        return dire(`❌ Je n'ai pas pu publier dans ${channel}. Tu peux réessayer.`);
      }

      log(`Partage de bilan safari #${result.session.id} par ${interaction.user.username}`);
      // On ne réécrit QUE les composants : omettre `embeds` l'exclut du corps
      // envoyé à Discord, qui laisse donc l'embed en place — la ligne de
      // résultat du dernier lancer reste sous les yeux du dresseur.
      await interaction
        .editReply({ content: `✅ Bilan partagé dans ${channel}.`, components: [] })
        .catch(() => {});
    } catch (error) {
      handleException("Partage du bilan de safari :", error);
      await dire("❌ Erreur pendant le partage.");
    }
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
      return throwBall(interaction, args[0], "master", {
        panel: true,
        requireItem: args[1] === "item",
      });

    case "poke_master_cancel":
      return interaction
        .update({
          content: "Annulé, tes points sont intacts.",
          components: args[0] ? [buildBallRow(args[0], { panel: true })] : [],
        })
        .catch(() => {});

    // Le customId date du bouton « Je l'ai déjà ? », que la fiche a remplacé :
    // les apparitions déjà postées le portent encore.
    case "poke_owned":
      return answerSpeciesInfo(interaction, args[0]);

    case "poke_drop":
      return handleDropClaim(interaction, args[0]);

    case "poke_dex":
      return showDexPage(interaction, args[0], Number(args[1]));

    // Le cinquième segment, facultatif, est l'objet qui aide la fusion : une
    // pierre impose alors sa cible, un bonbon remplace un exemplaire manquant.
    case "poke_evo": {
      const [speciesId, shiny, mode, helper] = args;
      if (mode === "choose") {
        return showEvolutionChoices(interaction, Number(speciesId), shiny === "1");
      }
      return runEvolution(interaction, Number(speciesId), shiny === "1", null, helper ?? null);
    }

    // Pas d'aide ici, et ce n'est pas un oubli : choisir sa cible et utiliser un
    // objet sont deux chemins distincts. Une pierre impose déjà sa forme — c'est
    // précisément ce qui en fait le moyen de choisir son Évoli sans payer le
    // supplément — et un bonbon laisse le hasard trancher.
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
