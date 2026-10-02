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
import { pseudoOf, pseudos } from "../pseudo.js";
import { getBall, getPokemonConfig, getSafariConfig } from "./config.js";
import { answerThrow, ballPanelRow, getBallPrice, throwBall, trackPanel } from "./capture.js";
import { getSpawn } from "./spawn.js";
import { getBallItem, getBallStock, getItem, getItemCount } from "./items.js";
import { claimDrop } from "./drops.js";

import {
  ENVOI_IMPOSSIBLE,
  claimShare,
  enterPark,
  findFreeParkFor,
  playAction,
  prepareShare,
  refreshParkMessage,
  releaseShare,
  resumeSession,
  startPaidSession,
} from "./safari.js";
import { activeGeneration, getSpecies } from "./data.js";
import { claimShowcaseShare, getShowcase, releaseShowcaseShare } from "./showcase.js";
import { renderShowcaseImage } from "./showcase-image.js";
import {
  DITTO_HELPER,
  acceptTrade,
  describeEvolution,
  evolve,
  getCollection,
  getIndividuals,
  getSpeciesDuplicates,
  getSpeciesNeeders,
  getSpeciesOwnership,
  getTrade,
  getTradeMatches,
  getTradePartners,
  listDuplicates,
  proposeTrade,
  resolveTradeAs,
  selectorOf,
  parseIndividual,
  setTradeMessage,
  tradeCandidate,
} from "./collection.js";
import {
  buildDexEmbed,
  buildDexRow,
  buildBoxEmbed,
  buildBoxRow,
  buildCompareView,
  buildDropEmbed,
  buildDuplicatesEmbed,
  buildDuplicatesRow,
  buildSpeciesDuplicatesEmbed,
  buildSpeciesDuplicatesRow,
  buildNeedersEmbed,
  buildNeedersRow,
  buildPaidEntryReply,
  buildPartnersEmbed,
  buildPartnersRow,
  buildSafariGenerationPicker,
  buildSafariRecapEmbed,
  buildSafariView,
  buildSpeciesInfoEmbed,
  buildTradeEmbed,
  buildTradePicker,
  buildTradeRow,
  buildShowcaseMessage,
  displayName,
  freeParkNotice,
  individualChoices,
  safariPickerContent,
  showcaseNotice,
  tradeNeedsChoice,
} from "./embeds.js";

const ephemeral = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});

// ---------------------- Master Ball ----------------------

// Depuis le panneau de relance, la confirmation le TRANSFORME au lieu d'ouvrir
// un éphémère de plus : c'est tout l'intérêt du panneau.
//
// C'est ICI que le dresseur apprend ce que lui coûte la Master Ball : son prix
// monte à chaque achat, et le bouton de l'annonce, le même pour tous, ne peut
// pas le dire.
function askMasterBallConfirmation(interaction, spawnId, { panel = false } = {}) {
  const ball = getBall("master");

  // Un refus répond exactement comme un cooldown : même règle, même fonction.
  const refuse = (content) => answerThrow(interaction, spawnId, content, { panel });

  const item = getBallItem("master");
  // Une Master Ball offerte se confirme aussi. Elle ne coûte rien, mais elle ne
  // se retrouve pas : un mésclic reste irrattrapable, ce pour quoi cette
  // confirmation existe.
  getItemCount(interaction.user.id, item?.key ?? "", (err, held) => {
    if (err) handleException("Lecture des Master Balls offertes :", err);
    const gratuite = held > 0;

    const suite = (balance, price) => {
      if (!gratuite && balance < price) {
        return refuse(
          `❌ Une **${ball.label}** coûte **${price.toLocaleString("fr-FR")}** points, ` +
            `tu en as **${balance.toLocaleString("fr-FR")}**.`
        );
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          // Le customId porte la promesse faite au dresseur : si la Master Ball
          // annoncée gratuite a disparu entre-temps, le lancer doit refuser, pas
          // se rabattre sur 22 500 points jamais mentionnés. Payante, il porte
          // le prix affiché : un achat fait entre-temps l'a fait monter, et le
          // lancer refuse plutôt que de prendre plus.
          .setCustomId(`poke_master_ok|${spawnId}|${gratuite ? "item" : price}`)
          .setLabel(
            gratuite ? "Utiliser ma Master Ball" : `Confirmer (-${price.toLocaleString("fr-FR")})`
          )
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
          : `⚠️ La **${ball.label}** garantit la capture mais coûte **${price.toLocaleString("fr-FR")}** points, ` +
            `et ils sont perdus si quelqu'un t'attrape le Pokémon avant.\n` +
            `Ton solde : **${balance.toLocaleString("fr-FR")}** points.`,
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

    // Le solde et le prix ne servent qu'à celui qui va payer : inutile d'aller
    // les lire pour annoncer une ball qui ne coûte rien.
    if (gratuite) return suite(0, 0);
    getBallPrice(interaction.user.id, ball, (err, price) => {
      if (err) {
        handleException("Lecture du prix de la Master Ball :", err);
        return refuse("❌ Erreur base de données.");
      }
      getBalance(interaction.user.id, (err, balance) => {
        if (err) {
          handleException(err);
          return refuse("❌ Erreur base de données.");
        }
        suite(balance, price);
      });
    });
  });
}

// ---------------------- Fiche du Pokémon ----------------------

// Répond en privé au cliqueur, ce qu'un embed public ne peut pas faire : un
// message Discord est identique pour tous ses lecteurs. La fiche est celle de
// /pk info, à ceci près qu'elle épouse l'apparition d'où vient le clic — sa
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

    // Compteurs à zéro en cas d'erreur : mieux vaut la fiche sans les
    // pastilles de possession qu'un refus sec devant une apparition.
    getSpeciesOwnership(interaction.user.id, species, (err, { owned, forms }) => {
      const fiche = buildSpeciesInfoEmbed(species, {
        owned,
        forms,
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
    });
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
    if (!claimed.ok) return ephemeral(interaction, claimed.reason);

    log(`Ramassage : ${pseudoOf(interaction)} prend ${claimed.item.label}`);
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

// ---------------------- Boîte ----------------------

// La page demandée de la boîte, relue en base à chaque clic : ce qui a été
// capturé, vendu ou échangé entre-temps apparaît tel quel.
function showBoxPage(interaction, ownerId, speciesId, page) {
  getIndividuals(ownerId, async (err, rows) => {
    if (err) {
      handleException("Lecture de la boîte :", err);
      return ephemeral(interaction, "❌ Impossible de lire la boîte.");
    }
    let owner = { username: "Dresseur inconnu", id: ownerId };
    try {
      owner = await interaction.client.users.fetch(ownerId);
    } catch (error) {
      // Dresseur parti du serveur : on affiche quand même sa boîte.
    }
    const species = speciesId ? getSpecies(speciesId) : null;
    const shown = species ? rows.filter((row) => row.species_id === species.id) : rows;
    await interaction
      .update({
        embeds: [buildBoxEmbed(shown, { user: owner, species, page })],
        components: [buildBoxRow(ownerId, species?.id, page, shown.length)],
      })
      .catch(() => {});
  });
}

// ---------------------- Doublons ----------------------

// La page demandée des doublons, relue en base à chaque clic, comme la boîte.
function showDuplicatesPage(interaction, ownerId, page, { reserve = false } = {}) {
  getIndividuals(ownerId, async (err, rows) => {
    if (err) {
      handleException("Lecture des doublons :", err);
      return ephemeral(interaction, "❌ Impossible de lire les doublons.");
    }
    let owner = { username: "Dresseur inconnu", id: ownerId };
    try {
      owner = await interaction.client.users.fetch(ownerId);
    } catch (error) {
      // Dresseur parti du serveur : on affiche quand même ses doublons.
    }
    const list = listDuplicates(rows, { reserve });
    await interaction
      .update({
        embeds: [buildDuplicatesEmbed(list, { user: owner, page, reserve })],
        components: [buildDuplicatesRow(ownerId, page, list.length, { reserve })],
      })
      .catch(() => {});
  });
}

// L'inverse, qui a cette espèce en double : relu à chaque clic lui aussi.
function showSpeciesDuplicatesPage(interaction, speciesId, page, { reserve = false } = {}) {
  const species = getSpecies(speciesId);
  if (!species) return ephemeral(interaction, "❌ Espèce inconnue.");
  getSpeciesDuplicates(species.id, { reserve }, (err, list) => {
    if (err) {
      handleException("Lecture des doublons d'une espèce :", err);
      return ephemeral(interaction, "❌ Impossible de lire les doublons.");
    }
    interaction
      .update({
        embeds: [buildSpeciesDuplicatesEmbed(species, list, { page, reserve })],
        components: [buildSpeciesDuplicatesRow(species.id, page, list.length, { reserve })],
      })
      .catch(() => {});
  });
}

// ---------------------- Comparer ----------------------

// L'état d'une comparaison, tel que les customId le portent : le dresseur
// comparé, ce que chaque côté a choisi (0 : rien), la réserve d'évolution et la
// page. Rien n'est gardé en mémoire : le clic suivant relit tout en base.
const compareState = ([partnerId, give, get, reserve, page]) => ({
  partnerId: String(partnerId),
  give: Number(give) || 0,
  get: Number(get) || 0,
  reserve: reserve === "1",
  page: Number(page) || 0,
});

// Le dresseur comparé, avec son nom. Parti du serveur, il reste comparable : sa
// collection est toujours là.
async function fetchPartner(interaction, partnerId) {
  try {
    return await interaction.client.users.fetch(partnerId);
  } catch (error) {
    return { id: partnerId, username: "Dresseur inconnu" };
  }
}

// Réécrit le message avec la comparaison, relue en base. `notice` dit pourquoi un
// choix a disparu, quand c'est le cas ; sans lui le texte est effacé. `write`
// vaut `update` pour un clic direct, `editReply` une fois le clic acquitté.
async function renderComparison(interaction, state, match, { notice = null, write = "update" } = {}) {
  const partner = await fetchPartner(interaction, state.partnerId);
  await interaction[write]({ content: notice, ...buildCompareView(match, { ...state, partner }) }).catch(
    () => {}
  );
}

function showComparison(interaction, state) {
  getTradeMatches(interaction.user.id, state.partnerId, { reserve: state.reserve }, (err, match) => {
    if (err) {
      handleException("Lecture de la comparaison :", err);
      return ephemeral(interaction, "❌ Impossible de lire les collections.");
    }
    renderComparison(interaction, state, match).catch((error) =>
      handleException("Affichage de la comparaison :", error)
    );
  });
}

// « Avec qui échanger » et « qui a besoin d'une espèce » se relisent à chaque
// page, comme les doublons : ce qui a été donné entre-temps apparaît tel quel.
function showPartnersPage(interaction, reserve, page) {
  getTradePartners(interaction.user.id, { reserve }, (err, list, summary) => {
    if (err) {
      handleException("Lecture des partenaires d'échange :", err);
      return ephemeral(interaction, "❌ Impossible de lire les collections.");
    }
    interaction
      .update({
        embeds: [buildPartnersEmbed(list, { page, reserve, offers: summary.offers })],
        components: [buildPartnersRow(list.length, page, { reserve })],
      })
      .catch(() => {});
  });
}

function showNeedersPage(interaction, speciesId, reserve, page) {
  const species = getSpecies(speciesId);
  if (!species) return ephemeral(interaction, "❌ Espèce inconnue.");
  getSpeciesNeeders(interaction.user.id, species.id, { reserve }, (err, found) => {
    if (err) {
      handleException("Lecture de ceux qui ont besoin d'une espèce :", err);
      return ephemeral(interaction, "❌ Impossible de lire les collections.");
    }
    interaction
      .update({
        embeds: [buildNeedersEmbed(species, found.offer, found.list, { page, reserve })],
        components: [buildNeedersRow(species.id, found.list.length, page, { reserve })],
      })
      .catch(() => {});
  });
}

// Le bouton « Proposer cet échange » : l'offre naît par le même chemin que
// /pk echange (proposeTrade). Ce qu'on donne est l'individu que reserveDuplicates
// retirerait en premier — le moins précieux, jamais un verrouillé ni le dernier de
// l'espèce ; ce qu'on demande ne désigne que l'espèce, comme sur /pk echange. Tout se relit au clic : le choix a pu
// cesser d'être proposé depuis la comparaison. Comme le partage d'un bilan, c'est
// le bot qui publie dans le salon : ses permissions se vérifient avant de créer
// quoi que ce soit, et une offre que le salon n'a pas publiée est annulée plutôt
// que laissée dans la base sans que personne ne la voie.
//
// Le clic est acquitté d'abord : la lecture, la création et la publication peuvent
// dépasser les trois secondes que Discord laisse pour répondre.
async function proposeFromComparison(interaction, state) {
  const userId = interaction.user.id;
  const channel = interaction.channel;
  if (!channel) return ephemeral(interaction, "❌ Salon introuvable.");
  await interaction.deferUpdate().catch(() => {});
  const refuse = (content) =>
    interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});

  const match = await new Promise((resolve) =>
    getTradeMatches(userId, state.partnerId, { reserve: state.reserve }, (err, found) =>
      resolve(err ? { err } : { found })
    )
  );
  if (match.err) {
    handleException("Lecture de la comparaison :", match.err);
    return refuse("❌ Impossible de lire les collections.");
  }
  const mine = match.found.give.find((entry) => entry.speciesId === state.give);
  const theirs = match.found.get.find((entry) => entry.speciesId === state.get);
  const stale = (what) =>
    renderComparison(
      interaction,
      { ...state, give: mine ? state.give : 0, get: theirs ? state.get : 0 },
      match.found,
      { notice: `⚠️ ${what}. Choisis ton échange à nouveau.`, write: "editReply" }
    );
  if (!mine || !theirs) {
    return stale(
      !mine && !theirs
        ? "Ces deux Pokémon ne sont plus proposés"
        : mine
          ? `<@${state.partnerId}> n'a plus ce Pokémon à donner`
          : "Tu n'as plus ce Pokémon à donner"
    );
  }

  const candidate = (owner, speciesId) =>
    new Promise((resolve) =>
      tradeCandidate(owner, speciesId, (err, row) => resolve(err ? { err } : { row }))
    );
  const [giving, receiving] = await Promise.all([
    candidate(userId, mine.speciesId),
    candidate(state.partnerId, theirs.speciesId),
  ]);
  const failed = giving.err ?? receiving.err;
  if (failed) {
    handleException("Choix des Pokémon de l'offre :", failed);
    return refuse("❌ Erreur base de données.");
  }
  // Entre la comparaison et ici, le dernier exemplaire a pu partir.
  if (!giving.row || !receiving.row) return stale("Un des deux Pokémon n'est plus disponible");

  const problem = postingProblem(interaction, channel);
  if (problem) return refuse(problem);

  const created = await new Promise((resolve) =>
    proposeTrade(
      {
        fromUserId: userId,
        toUserId: state.partnerId,
        offer: selectorOf(giving.row),
        // Le destinataire choisit lui-même le Pokémon qu'il donne, en acceptant.
        request: { speciesId: theirs.speciesId },
        channelId: channel.id,
        unique: true,
      },
      (err, trade, info) => resolve({ err, trade, duplicate: Boolean(info?.duplicate) })
    )
  );
  if (created.err) {
    handleException("Création d'une offre depuis /pk comparer :", created.err);
    return refuse("❌ Impossible de créer l'échange.");
  }
  // Deux clics rapprochés, ou une offre identique encore ouverte : proposeTrade a
  // retiré la nouvelle, la plus ancienne reste.
  if (created.duplicate) {
    return refuse(`⏳ Tu as déjà proposé cet échange à <@${state.partnerId}> : il attend sa réponse.`);
  }
  const offerId = created.trade.id;

  let message;
  try {
    message = await channel.send({
      content: `<@${state.partnerId}>`,
      embeds: [buildTradeEmbed(created.trade, "PENDING")],
      components: [buildTradeRow(offerId)],
      allowedMentions: { users: [state.partnerId] },
    });
  } catch (error) {
    handleException("Publication d'une offre d'échange :", error);
    // Une offre sans message n'a plus de raison d'exister, et ouverte elle
    // bloquerait tout nouvel essai : on l'annule dans tous les cas. Seul l'avis
    // change. Un code d'ENVOI_IMPOSSIBLE prouve que rien n'a été publié ; sur une
    // coupure ou un délai, le message est peut-être parti, et ses boutons
    // répondront alors que l'offre a déjà été traitée.
    resolveTradeAs(offerId, userId, "CANCELLED", (err) => {
      if (err) handleException("Annulation d'une offre non publiée :", err);
    });
    return refuse(
      ENVOI_IMPOSSIBLE.has(error?.code)
        ? `❌ Je n'ai pas pu publier l'offre dans ${channel}. Tu peux réessayer.`
        : "⚠️ L'envoi a échoué, mais il a peut-être abouti : va voir le salon avant de réessayer."
    );
  }
  setTradeMessage(offerId, message.id);
  await interaction
    .editReply({
      content: `✅ Offre envoyée à <@${state.partnerId}> dans ${channel}.`,
      embeds: [],
      components: [],
    })
    .catch(() => {});
}

// ---------------------- Évolution ----------------------

// Le deuxième segment des boutons d'évolution désigne l'individu qui évolue :
// « #123 » un individu précis, « * » celui que le bot choisira au clic, shiny ou
// non. « 1F » pour une femelle shiny, « 0 » pour n'importe quel sexe, c'est le
// format d'avant, que les anciens boutons portent encore.
const parseVariant = (raw) => {
  const value = String(raw);
  if (value.startsWith("#")) return { pokemonId: Number(value.slice(1)) || null };
  if (value === "*") return { isShiny: null, sex: null };
  return {
    isShiny: value.startsWith("1"),
    sex: ["M", "F"].includes(value.slice(1)) ? value.slice(1) : null,
  };
};

// `confirmed` : le dresseur a confirmé l'évolution d'un Pokémon verrouillé.
// Sans elle, evolve n'y touche pas et répond `locked` ; le message propose
// alors `confirmId`, le même bouton avec « ok » en dernier segment.
function runEvolution(
  interaction,
  speciesId,
  variant,
  chosenTargetId,
  helperKey,
  { confirmed = false, confirmId = null } = {}
) {
  // L'espèce du bouton voyage avec l'individu : la réservation ne le prend que
  // s'il est encore de cette espèce, et à celui qui clique. Un second clic sur
  // un Pokémon qui vient d'évoluer est donc refusé, au lieu de le faire
  // évoluer une seconde fois à un tarif qu'on ne lui a pas montré.
  const group = variant.pokemonId
    ? { pokemonId: variant.pokemonId, speciesId, confirmLocked: confirmed }
    : { speciesId, isShiny: variant.isShiny, sex: variant.sex, confirmLocked: confirmed };
  evolve(interaction.user.id, group, chosenTargetId, helperKey, (err, result) => {
    if (err) {
      handleException(err);
      return interaction
        .update({ content: "❌ Erreur base de données.", embeds: [], components: [] })
        .catch(() => {});
    }
    if (!result.ok && result.locked && confirmId) {
      return interaction
        .update({
          content: result.reason,
          embeds: [],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(confirmId)
                .setLabel("Faire évoluer quand même")
                .setStyle(ButtonStyle.Danger),
              new ButtonBuilder()
                .setCustomId("poke_evo_cancel")
                .setLabel("Annuler")
                .setStyle(ButtonStyle.Secondary)
            ),
          ],
        })
        .catch(() => {});
    }
    if (!result.ok) {
      return interaction
        .update({ content: `❌ ${result.reason}`, embeds: [], components: [] })
        .catch(() => {});
    }

    const source = getSpecies(speciesId);
    const aide = result.plan.helper;
    // Ce qui a été sacrifié : des exemplaires de l'espèce, et les Métamorph qui
    // ont comblé le reste, comptés à part.
    const { sacrifices, dittos: metamorphs, shinies } = result.spent;
    const paye = [
      sacrifices ? `-${sacrifices} ${source.name}` : null,
      metamorphs ? `-${metamorphs} Métamorph` : null,
      shinies ? `dont ${shinies} ✨` : null,
      aide ? `-${aide.quantity} ${aide.item.label}` : null,
      result.plan.points > 0 ? `-${result.plan.points} points` : null,
    ].filter(Boolean);

    log(
      `Évolution : ${pseudoOf(interaction)} fait évoluer #${result.evolved.id} ${source.name} en ` +
        `${result.target.name} (${sacrifices} sacrifiés, ${result.plan.points} pts` +
        `${metamorphs ? `, ${metamorphs}× Métamorph` : ""}` +
        `${aide ? `, ${aide.quantity}× ${aide.item.label}` : ""})`
    );
    interaction
      .update({
        content:
          `✨ Félicitations ! Ton #${result.evolved.id} ` +
          `**${displayName(source, result.isShiny, result.evolved.sex)}** a évolué en ` +
          `**${displayName(result.target, result.isShiny, result.evolved.sex, result.evolved.form)}** ! ` +
          (paye.length ? `(${paye.join(", ")})` : ""),
        embeds: [],
        components: [],
      })
      .catch(() => {});
  });
}

// L'aide qui accompagne un choix de forme : Métamorph, qui ne fait que combler
// des sacrifices, ou un objet qui laisse choisir (l'Évolyte). Tout autre
// segment est ignoré : il a pu être tapé, ou venir d'un vieux bouton.
function choiceHelper(helper) {
  if (helper === DITTO_HELPER) return helper;
  return helper && getItem(helper)?.evolution?.choose ? helper : null;
}

// `variant` est le segment brut du bouton : il passe tel quel aux boutons des
// cibles, qui désignent le même individu — ou laissent le même choix au bot.
function showEvolutionChoices(interaction, speciesId, variant, helperKey = null) {
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
        .setCustomId(
          `poke_evo_pick|${speciesId}|${variant}|${target.id}` +
            (helperKey ? `|${helperKey}` : "")
        )
        .setLabel(target.name)
        .setStyle(ButtonStyle.Primary)
    );
  }

  // Avec l'Évolyte, le choix se paie au tarif du stade et l'objet tient lieu
  // d'un sacrifice : le prix affiché est le sien.
  const item = helperKey && helperKey !== DITTO_HELPER ? getItem(helperKey) : null;
  const priced = describeEvolution(speciesId, plan.targets[0].id, item ? helperKey : null);
  const renfort = item ? `, ${item.emoji} ${item.label}` : helperKey ? ", Métamorph en renfort" : "";
  interaction
    .update({
      content:
        `🎯 Choisis l'évolution (` +
        (priced.points > 0 ? `**${priced.points.toLocaleString("fr-FR")}** points, ` : "gratuit, ") +
        `${priced.sacrifices} sacrifice${priced.sacrifices > 1 ? "s" : ""}${renfort}) :`,
      embeds: [],
      components: [row],
    })
    .catch(() => {});
}

// ---------------------- Échanges ----------------------

// Le message d'une offre, tel qu'il se réécrit à la fin : l'embed du résultat, et
// plus aucun bouton actif.
const tradeOutcome = (trade, status, note) => ({
  content: note ?? null,
  embeds: [buildTradeEmbed(trade, status)],
  components: [buildTradeRow(trade.id, { disabled: true })],
});

function finishTrade(interaction, trade, status, note) {
  interaction.update(tradeOutcome(trade, status, note)).catch(() => {});
}

// Accepte l'offre et en écrit le résultat avec `write(trade, status, note, { stale })`. Le
// bouton écrit sur son propre message ; le menu du destinataire, lui, vit dans un
// éphémère et réécrit le message public.
function acceptAndSettle(interaction, trade, options, write) {
  acceptTrade(trade.id, options, (err, result) => {
    if (err) {
      handleException(err);
      return ephemeral(interaction, "❌ Erreur base de données.");
    }
    if (!result.ok) return write(trade, "FAILED", `❌ ${result.reason}`, { stale: result.stale });
    pseudos(trade.from_user_id, trade.to_user_id).then(([from, to]) =>
      log(`Échange #${trade.id} accepté entre ${from} et ${to}`)
    );
    // La ligne rendue porte l'individu que le destinataire a choisi.
    write(result.trade, "ACCEPTED");
  });
}

// L'offre demande un Pokémon sans le désigner : le destinataire le choisit parmi
// ceux qu'il peut donner — de l'espèce demandée, jamais le dernier ni un verrouillé,
// comme sur /pk echange. Le menu est privé : sa boîte ne regarde que lui.
function askTradePick(interaction, trade) {
  const species = getSpecies(trade.request_species_id);
  getIndividuals(trade.to_user_id, (err, rows) => {
    if (err) {
      handleException("Lecture des Pokémon à échanger :", err);
      return ephemeral(interaction, "❌ Erreur base de données.");
    }
    const choices = individualChoices(
      rows.filter((row) => row.species_id === trade.request_species_id),
      "",
      (row) => !row.last && !row.locked
    );
    if (!species || !choices.length) {
      return ephemeral(
        interaction,
        `❌ Tu n'as aucun ${species?.name ?? "Pokémon"} à donner : ils sont verrouillés, ` +
          "ou il ne t'en reste qu'un."
      );
    }
    interaction
      .reply({
        content: `🎯 Quel **${species.name}** donnes-tu ?`,
        components: [buildTradePicker(trade.id, choices, species)],
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  });
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

    // Une offre expirée n'a rien à faire choisir : acceptTrade le dit.
    if (tradeNeedsChoice(trade) && trade.expires_at > Date.now()) {
      return askTradePick(interaction, trade);
    }
    acceptAndSettle(interaction, trade, {}, (settled, status, note) =>
      finishTrade(interaction, settled, status, note)
    );
  });
}

// Le Pokémon choisi par le destinataire : l'offre s'accepte avec lui. Le menu étant
// un éphémère, il se referme, et c'est le message public de l'offre qui annonce le
// résultat. Le choix se revalide à l'acceptation (acceptTrade) : le menu a pu
// rester ouvert, le Pokémon a pu partir.
function handleTradePick(interaction, tradeId) {
  getTrade(tradeId, (err, trade) => {
    if (err || !trade) return ephemeral(interaction, "❌ Échange introuvable.");
    if (trade.status !== "PENDING") {
      return ephemeral(interaction, "❌ Cet échange a déjà été traité.");
    }
    if (interaction.user.id !== trade.to_user_id) {
      return ephemeral(interaction, "❌ Cet échange ne t'est pas destiné.");
    }
    const requestPokemonId = parseIndividual(interaction.values?.[0]);
    if (!requestPokemonId) return ephemeral(interaction, "❌ Choisis un Pokémon dans la liste.");

    acceptAndSettle(interaction, trade, { requestPokemonId }, (settled, status, note, meta) => {
      interaction
        .update({
          content: status === "ACCEPTED" ? "✅ Échange effectué." : note,
          components: [],
        })
        .catch(() => {});
      // Le message public n'existe pas toujours (offre dont l'envoi a échoué) :
      // sans lui, l'éphémère a déjà dit le résultat. Une offre expirée ou déjà
      // traitée, elle, n'a pas échoué faute de Pokémon : son message dit déjà vrai, ou
      // le dira à son tour — on ne le réécrit pas en « Échange impossible ».
      if (!trade.message_id || meta?.stale) return;
      interaction.channel?.messages
        ?.edit(trade.message_id, tradeOutcome(settled, status, note))
        .catch(() => {});
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

// Le bouton du message de parc. Plusieurs générations ouvertes : une visite en
// cours se rouvre, sinon on choisit d'abord les générations visées
// (poke_safari_go entre ensuite).
function handleSafariEnter(interaction, parkId) {
  if (activeGeneration() > 1) {
    return resumeSession(interaction.user.id, (err, ongoing) => {
      if (err) {
        handleException(err);
        return ephemeral(interaction, "❌ Erreur base de données.");
      }
      interaction
        .reply({
          ...(ongoing
            ? buildSafariView(ongoing.session, {
                owned: ongoing.owned,
                lineage: ongoing.lineage,
                resumed: true,
              })
            : {
                content: safariPickerContent("park"),
                components: buildSafariGenerationPicker("park", Number(parkId)),
              }),
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    });
  }
  enterPark(interaction.user.id, Number(parkId), {}, (err, result) => {
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
          lineage: result.lineage,
          resumed: result.resumed,
        }),
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  });
}

// Le bouton qui entre, une fois les générations choisies : l'entrée offerte
// d'un parc, ou l'entrée payante de /pk safari. Il réécrit le message du choix.
// Le choix se revalide (safariGenerations) : le customId a pu vieillir.
function handleSafariGo(interaction, mode, parkId, generations) {
  const chosen = String(generations ?? "").split(",");
  const answer = (payload) =>
    interaction.update({ embeds: [], components: [], ...payload }).catch(() => {});
  const fail = (err) => {
    handleException(err);
    answer({ content: "❌ Erreur base de données." });
  };
  // L'entrée payante se revérifie au clic, comme /pk safari avant de débiter :
  // le menu a pu rester ouvert pendant qu'un parc offert s'ouvrait ou que le
  // safari fermait.
  if (mode === "paid") {
    if (!getPokemonConfig().enabled || !getSafariConfig().enabled) {
      return answer({ content: "❌ Le parc safari est fermé pour le moment." });
    }
    return findFreeParkFor(interaction.user.id, (err, freePark) => {
      if (err) return fail(err);
      if (freePark) return answer({ content: freeParkNotice() });
      startPaidSession(interaction.user.id, { generations: chosen }, (err, result) =>
        err ? fail(err) : answer(buildPaidEntryReply(result))
      );
    });
  }
  enterPark(interaction.user.id, Number(parkId), { generations: chosen }, (err, result) => {
    if (err) return fail(err);
    if (!result.ok) return answer({ content: `❌ ${result.reason}` });
    if (!result.resumed) refreshParkMessage(interaction.client, Number(parkId));
    answer(
      buildSafariView(result.session, {
        owned: result.owned,
        lineage: result.lineage,
        resumed: result.resumed,
      })
    );
  });
}

// Les menus du jeu : le choix des générations du parc, qui réécrit son message
// avec le choix porté par le bouton d'entrée, les côtés d'une comparaison, et le
// Pokémon que le destinataire d'un échange donne.
export async function handlePokemonSelect(interaction) {
  const [action, ...args] = interaction.customId.split("|");
  switch (action) {
    case "poke_safari_gens": {
      const [mode, parkId] = args;
      const chosen = interaction.values.map(Number).filter((value) => value >= 1);
      return interaction
        .update({ components: buildSafariGenerationPicker(mode, Number(parkId) || 0, chosen) })
        .catch(() => {});
    }

    // Un côté de l'échange choisi : le message se réécrit avec ce choix, l'autre
    // côté tel que le customId le portait. Une espèce qui n'est plus proposée est
    // écartée par la comparaison elle-même.
    case "poke_cmpg": {
      const [partnerId, get, reserve, page] = args;
      return showComparison(
        interaction,
        compareState([partnerId, interaction.values?.[0], get, reserve, page])
      );
    }
    case "poke_cmpr": {
      const [partnerId, give, reserve, page] = args;
      return showComparison(
        interaction,
        compareState([partnerId, give, interaction.values?.[0], reserve, page])
      );
    }

    case "poke_trade_pick":
      return handleTradePick(interaction, args[0]);

    default:
  }
}

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
// Ce qui empêcherait le bot de publier un embed dans ce salon, ou null : le
// partage du bilan du parc et celui de la vitrine le vérifient avant de rien
// revendiquer.
function postingProblem(interaction, channel) {
  const envoi = channel.isThread()
    ? PermissionFlagsBits.SendMessagesInThreads
    : PermissionFlagsBits.SendMessages;
  // EmbedLinks en plus de l'envoi : sans elle Discord refuse l'embed, et la
  // garde raterait la seule chose qu'elle est censée voir venir.
  const moi = channel.permissionsFor(interaction.guild?.members.me);
  if (!moi?.has([PermissionFlagsBits.ViewChannel, envoi, PermissionFlagsBits.EmbedLinks])) {
    return `❌ Je ne peux pas publier d'embed dans ${channel}.`;
  }
  if (channel.isThread() && channel.locked) return `❌ ${channel} est verrouillé.`;
  return null;
}

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

      const probleme = postingProblem(interaction, channel);
      if (probleme) return dire(probleme);

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

      log(`Partage de bilan safari #${result.session.id} par ${pseudoOf(interaction)}`);
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

// Montrer sa vitrine dans le salon. Un envoi par dresseur toutes les
// `shareCooldownMinutes`, revendiqué en base avant l'envoi et rendu s'il n'a
// pas pu partir — comme le partage du bilan du parc. La vitrine se relit au
// moment d'envoyer : c'est celle d'aujourd'hui qui part, pas celle de l'écran.
async function handleShowcaseShare(interaction) {
  const channel = interaction.channel;
  if (!channel) return ephemeral(interaction, "❌ Salon introuvable.");
  const probleme = postingProblem(interaction, channel);
  if (probleme) return ephemeral(interaction, probleme);

  const userId = interaction.user.id;
  const rows = await new Promise((resolve) =>
    getShowcase(userId, (err, list) => {
      if (err) handleException("Lecture de la vitrine :", err);
      resolve(err ? null : list);
    })
  );
  if (!rows) return ephemeral(interaction, "❌ Erreur base de données.");
  if (!rows.length) return ephemeral(interaction, "❌ Ta vitrine est vide.");

  const claim = await new Promise((resolve) =>
    claimShowcaseShare(userId, (err, result) => resolve({ err, result }))
  );
  if (claim.err) {
    handleException("Revendication de l'envoi de la vitrine :", claim.err);
    return ephemeral(interaction, "❌ Erreur base de données.");
  }
  if (!claim.result.ok) {
    return ephemeral(
      interaction,
      `⏳ Ta vitrine a déjà été montrée il y a peu : prochain envoi possible ` +
        `<t:${Math.ceil(claim.result.retryAt / 1000)}:R>.`
    );
  }

  await interaction.deferUpdate().catch(() => {});
  const image = await renderShowcaseImage(rows);
  try {
    await channel.send({
      ...buildShowcaseMessage(rows, { title: `Vitrine de <@${userId}>`, image }),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    handleException("Envoi de la vitrine :", error);
    if (ENVOI_IMPOSSIBLE.has(error?.code)) {
      releaseShowcaseShare(userId, claim.result.sharedAt, (err) => {
        if (err) handleException("Restitution de l'envoi de la vitrine :", err);
      });
    }
    return interaction
      .followUp({
        content: ENVOI_IMPOSSIBLE.has(error?.code)
          ? `❌ Je n'ai pas pu publier dans ${channel}. Tu peux réessayer.`
          : "⚠️ L'envoi a échoué, mais il a peut-être abouti quand même : va voir le salon.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  }
  log(`Vitrine de ${pseudoOf(interaction)} montrée dans #${channel.name ?? channel.id}`);
  await interaction
    .editReply(showcaseNotice(`✅ Ta vitrine est montrée dans ${channel}.`))
    .catch(() => {});
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
          lineage: result.lineage,
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
    // `item` : annoncée offerte, la ball ne se paie jamais en points.
    case "poke_rethrow":
      return throwBall(interaction, args[0], args[1], {
        panel: true,
        requireItem: args[2] === "item",
      });

    case "poke_remaster":
      return askMasterBallConfirmation(interaction, args[0], { panel: true });

    // Toujours cliqué depuis un éphémère (la confirmation), donc toujours une
    // réécriture.
    // `args[1]` : « item » (annoncée offerte) ou le prix affiché. Un bouton posté
    // avant ce prix n'en porte pas, et part sans garde.
    case "poke_master_ok":
      return throwBall(interaction, args[0], "master", {
        panel: true,
        requireItem: args[1] === "item",
        expectedPrice: /^\d+$/.test(args[1] ?? "") ? Number(args[1]) : null,
      });

    case "poke_master_cancel":
      return (args[0] ? ballPanelRow(interaction.user.id, args[0]) : Promise.resolve(null))
        .then((row) =>
          interaction.update({
            content: "Annulé, tes points sont intacts.",
            components: row ? [row] : [],
          })
        )
        .catch(() => {});

    // Le customId date du bouton « Je l'ai déjà ? », que la fiche a remplacé :
    // les apparitions déjà postées le portent encore.
    case "poke_owned":
      return answerSpeciesInfo(interaction, args[0]);

    case "poke_drop":
      return handleDropClaim(interaction, args[0]);

    case "poke_dex":
      return showDexPage(interaction, args[0], Number(args[1]));

    case "poke_box":
      return showBoxPage(interaction, args[0], Number(args[1]) || null, Number(args[2]) || 0);

    case "poke_dup":
    case "poke_dupr":
      return showDuplicatesPage(interaction, args[0], Number(args[1]) || 0, {
        reserve: action === "poke_dupr",
      });

    case "poke_dupsp":
    case "poke_dupspr":
      return showSpeciesDuplicatesPage(interaction, Number(args[0]), Number(args[1]) || 0, {
        reserve: action === "poke_dupspr",
      });

    // La comparaison de /pk comparer : ses pages, puis « avec qui échanger », « qui a
    // besoin d'une espèce », et le bouton qui propose l'échange choisi.
    case "poke_cmp":
      return showComparison(interaction, compareState(args));

    case "poke_cmpt":
      return showPartnersPage(interaction, args[0] === "1", Number(args[1]) || 0);

    case "poke_cmpn":
      return showNeedersPage(interaction, Number(args[0]), args[1] === "1", Number(args[2]) || 0);

    case "poke_cmpgo":
      return proposeFromComparison(interaction, compareState(args)).catch((error) =>
        handleException("Proposition d'un échange :", error)
      );

    // Le cinquième segment, facultatif, est l'objet qui aide l'évolution : une
    // pierre impose alors sa cible, un bonbon remplace un sacrifice manquant.
    case "poke_evo": {
      const [speciesId, variant, mode, helper, confirm] = args;
      if (mode === "choose") {
        return showEvolutionChoices(interaction, Number(speciesId), variant, choiceHelper(helper));
      }
      return runEvolution(
        interaction,
        Number(speciesId),
        parseVariant(variant),
        null,
        helper || null,
        {
          confirmed: confirm === "ok",
          confirmId: ["poke_evo", speciesId, variant, mode, helper ?? "", "ok"].join("|"),
        }
      );
    }

    case "poke_evo_cancel":
      return interaction
        .update({ content: "Évolution annulée : il reste tel quel.", embeds: [], components: [] })
        .catch(() => {});

    // Seuls Métamorph et l'Évolyte vont avec un choix de forme : un objet à
    // forme impose la sienne, et un bonbon laisse le hasard trancher.
    case "poke_evo_pick": {
      const [speciesId, variant, targetId, helper, confirm] = args;
      return runEvolution(
        interaction,
        Number(speciesId),
        parseVariant(variant),
        Number(targetId),
        choiceHelper(helper),
        {
          confirmed: confirm === "ok",
          confirmId: ["poke_evo_pick", speciesId, variant, targetId, helper ?? "", "ok"].join("|"),
        }
      );
    }

    case "poke_safari_enter":
      return handleSafariEnter(interaction, args[0]);

    case "poke_safari_go":
      return handleSafariGo(interaction, args[0], args[1], args[2]);

    case "poke_safari_ball":
      return handleSafariAction(interaction, "BALL", args[0], args[1]);
    case "poke_safari_bait":
      return handleSafariAction(interaction, "BAIT", args[0], args[1]);
    case "poke_safari_flee":
      return handleSafariAction(interaction, "FLEE", args[0], args[1]);

    case "poke_safari_share":
      return handleSafariShare(interaction, args[0]);

    case "poke_showcase_share":
      // Asynchrone et détaché du routeur : une exception ne doit pas partir en
      // rejet non capturé.
      return handleShowcaseShare(interaction).catch((error) =>
        handleException("Envoi de la vitrine :", error)
      );

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
