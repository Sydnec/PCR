// Le brouillon d'un échange : /pk echange sans options ouvre un écran privé où l'on
// choisit ce que chacun donne avec des menus, au lieu de remplir des options. Il ne
// remplace rien — les options restent —, il aboutit au même endroit : proposeTrade et le
// message d'offre public. Chaque côté se contrôle par checkSide, comme la commande.
//
// Tout vit en base (pokemon_trade_drafts) : les boutons répondent encore après un
// redémarrage, et un brouillon périmé le dit au lieu de se taire.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import db from "../points-db.js";
import { handleException } from "../utils.js";
import { getPokemonConfig } from "./config.js";
import {
  ANYONE,
  counterTrade,
  expireTrade,
  getIndividual,
  getIndividuals,
  getTrade as getTradeRow,
  proposeTrade,
  reopenCountered,
  resolveTradeAs,
  selectorOf,
} from "./collection.js";
import { getSpecies } from "./data.js";
import { getItem } from "./items.js";
import { buildTradeEmbed, buildTradeRow, describeGroup, individualChoices, tradeRowOptions } from "./embeds.js";
import {
  anyItemChoices,
  anySpeciesChoices,
  checkSide,
  choiceOfTradeSide,
  emptyTradeProblem,
  itemChoices,
  parseChoice,
  speciesChoices,
} from "./trade-side.js";
import { linkTradeMessage, syncTradeMessage } from "./trade-message.js";

const promisify = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (err, value) => (err ? reject(err) : resolve(value))));
const run = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
      err ? reject(err) : resolve(this);
    })
  );
const get = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));

const COLOR = 0x5865f2;
const MAX_OPTIONS = 25;

// « give » : ce que le dresseur donne, chez lui ; « get » : ce qu'il demande, chez le
// destinataire. Les colonnes portent les noms de l'offre.
const COLUMN = { give: "offer", get: "request" };
const isSide = (which) => which === "give" || which === "get";
// Un brouillon ouvert à tous a un destinataire vide : ce qu'il demande ne se lit chez
// personne (null, voir checkSide).
const targetOf = (draft) => draft.to_user_id || null;
const ownerOf = (draft, which) => (which === "give" ? draft.from_user_id : targetOf(draft));
// Celui qui reçoit le côté : l'autre partie.
const receiverOf = (draft, which) => (which === "give" ? targetOf(draft) : draft.from_user_id);

// ------------------------------- Base -------------------------------

const readSideJson = (text) => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

// Les brouillons périmés se purgent à la création du suivant : aucun cron n'est
// nécessaire, et un brouillon expiré est de toute façon refusé à la lecture.
//
// Le brouillon d'une contre-offre (`counterOf`) naît prérempli des côtés de l'offre
// contrée, inversés : il retient l'offre qu'il remplace, et « Proposer » passe alors par
// counterTrade.
export async function createDraft({ fromUserId, toUserId, channelId, counterOf = null, give = null, get = null }) {
  const now = Date.now();
  await run("DELETE FROM pokemon_trade_drafts WHERE expires_at < ?", [now]);
  const expiresAt = now + getPokemonConfig().trade.draftMinutes * 60 * 1000;
  const { lastID } = await run(
    `INSERT INTO pokemon_trade_drafts
       (from_user_id, to_user_id, channel_id, created_at, expires_at, counter_of, offer, request)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fromUserId,
      toUserId,
      channelId ?? null,
      now,
      expiresAt,
      counterOf,
      give ? JSON.stringify(give) : null,
      get ? JSON.stringify(get) : null,
    ]
  );
  return lastID;
}

// Le brouillon encore vivant, ses côtés lus, ou null.
export async function getDraft(draftId) {
  const row = await get("SELECT * FROM pokemon_trade_drafts WHERE id = ? AND expires_at >= ?", [
    Number(draftId) || 0,
    Date.now(),
  ]);
  return row ? { ...row, give: readSideJson(row.offer), get: readSideJson(row.request) } : null;
}

async function setSide(draftId, which, choice) {
  await run(`UPDATE pokemon_trade_drafts SET ${COLUMN[which]} = ? WHERE id = ?`, [
    choice ? JSON.stringify(choice) : null,
    draftId,
  ]);
}

const deleteDraft = (draftId) => run("DELETE FROM pokemon_trade_drafts WHERE id = ?", [draftId]);

// ------------------------------- Affichage -------------------------------

// Ce qu'un côté promet, en une phrase. Un Pokémon qu'on donne et qu'on n'a pas désigné
// est « le moins précieux » ; celui qu'on demande, le destinataire le choisira.
async function describeChoice(choice, which) {
  if (!choice) return "*à choisir*";
  if (choice.kind === "open") return "🎁 À son choix";
  if (choice.kind === "points") {
    return choice.amount === 0 ? "rien (0 point)" : `${choice.amount.toLocaleString("fr-FR")} points`;
  }
  if (choice.kind === "item") {
    const item = getItem(choice.id);
    return `${choice.quantity.toLocaleString("fr-FR")}× ${item?.label ?? choice.id}`;
  }
  const species = getSpecies(Number(choice.id));
  if (!species) return "*Pokémon inconnu*";
  if (which === "get" && !choice.individual) return `un ${species.name}, au choix de l'autre`;
  if (!choice.individual) return `un ${species.name} (le moins précieux)`;
  const row = await promisify(getIndividual, Number(choice.individual.replace("#", "")));
  return row ? `**${describeGroup(species, selectorOf(row))}** #${row.id}` : `un ${species.name}`;
}

const button = (customId, label, style, disabled = false) =>
  new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);

// L'écran du brouillon : les deux côtés, et les boutons pour les remplir ou proposer.
// `note` dit ce qui vient de se passer (un refus, une erreur) sans quitter l'écran.
export async function draftView(draft, note = null) {
  // Une offre ouverte à tous ne se ferme pas quand une contre-offre part : les autres
  // peuvent encore y répondre.
  const original = draft.counter_of
    ? await new Promise((resolve) => getTradeRow(draft.counter_of, (err, row) => resolve(err ? null : row)))
    : null;
  const embed = new EmbedBuilder()
    .setTitle(draft.counter_of ? "Préparer une contre-offre" : "Préparer un échange")
    .setColor(COLOR)
    .setDescription(
      draft.counter_of
        ? `Contre-offre à l'échange #${draft.counter_of} de <@${draft.to_user_id}> : les côtés sont ` +
            "inversés, change ce que tu veux avant de proposer. " +
            (original?.open_offer
              ? "Son offre reste ouverte aux autres ; rien ne bouge avant qu'il accepte la tienne."
              : "Son offre se ferme quand ta contre-offre part ; rien ne bouge avant qu'il accepte.")
        : targetOf(draft)
          ? `Échange avec <@${draft.to_user_id}>. Choisis ce que chacun donne, puis propose : ` +
            "rien ne bouge avant qu'il accepte."
          : "Échange ouvert à tous : le premier qui accepte l'emporte, et chacun peut " +
            "contre-proposer. « À son choix » laisse chacun faire sa proposition."
    )
    .addFields(
      { name: "Tu donnes", value: await describeChoice(draft.give, "give"), inline: true },
      { name: "Tu demandes", value: await describeChoice(draft.get, "get"), inline: true }
    );
  const ready = Boolean(draft.give && draft.get);
  return {
    content: note ?? "",
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        button(`poke_td_side|${draft.id}|give`, "Ce que je donne", ButtonStyle.Secondary),
        button(`poke_td_side|${draft.id}|get`, "Ce que je demande", ButtonStyle.Secondary),
        button(`poke_td_go|${draft.id}`, "Proposer", ButtonStyle.Success, !ready),
        button(`poke_td_cancel|${draft.id}`, "Annuler", ButtonStyle.Danger)
      ),
    ],
  };
}

const backRow = (draftId) =>
  new ActionRowBuilder().addComponents(
    button(`poke_td_back|${draftId}`, "Retour", ButtonStyle.Secondary)
  );

// Le menu des sortes de contenu d'un côté.
function kindView(draft, which, note = null) {
  const question =
    which === "give"
      ? "Que donnes-tu ?"
      : targetOf(draft)
        ? `Que demandes-tu à <@${draft.to_user_id}> ?`
        : "Que demandes-tu ?";
  return {
    content: [note, question].filter(Boolean).join("\n"),
    embeds: [],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`poke_td_kind|${draft.id}|${which}`)
          .setPlaceholder("Choisis une sorte")
          .addOptions(
            { label: "Un Pokémon", value: "pk" },
            { label: "Un objet", value: "item" },
            { label: "Des points", value: "points" },
            { label: "Rien (0 point)", value: "nothing" },
            // Ce qu'on demande peut rester ouvert : l'autre dira ce qu'il donne.
            ...(which === "get" ? [{ label: "🎁 À son choix", value: "open" }] : [])
          )
      ),
      backRow(draft.id),
    ],
  };
}

// Les fenêtres de saisie : un montant, ou une recherche (et une quantité pour un objet).
const input = (id, label, { required = true, placeholder = "" } = {}) =>
  new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(TextInputStyle.Short)
      .setRequired(required)
      .setPlaceholder(placeholder)
  );

const pointsModal = (draftId, which) =>
  new ModalBuilder()
    .setCustomId(`poke_td_pts|${draftId}|${which}`)
    .setTitle("Des points")
    .addComponents(input("amount", "Nombre de points", { placeholder: "3000" }));

const findModal = (draftId, which, kind) => {
  const modal = new ModalBuilder()
    .setCustomId(`poke_td_find|${draftId}|${which}|${kind}`)
    .setTitle(kind === "pk" ? "Chercher une espèce" : "Chercher un objet")
    .addComponents(
      input("query", kind === "pk" ? "Nom (vide : toutes)" : "Nom (vide : tous)", { required: false })
    );
  if (kind === "item") {
    modal.addComponents(input("quantity", "Quantité (1 par défaut)", { required: false, placeholder: "1" }));
  }
  return modal;
};

// Les résultats d'une recherche, en menu : 25 au plus, le reste se trouve en affinant.
function pickView(draft, which, kind, choices, { quantity = null, total = choices.length } = {}) {
  const shown = choices.slice(0, MAX_OPTIONS);
  const note = total > shown.length ? `${total} résultats, les ${shown.length} premiers : affine ta recherche.\n` : "";
  const customId = `poke_td_pick|${draft.id}|${which}|${kind}|${quantity ?? ""}`;
  return {
    content: `${note}Choisis dans la liste.`,
    embeds: [],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customId)
          .setPlaceholder(kind === "pk" ? "Une espèce" : "Un objet")
          .addOptions(shown.map(({ name, value }) => ({ label: name.slice(0, 100), value })))
      ),
      new ActionRowBuilder().addComponents(
        button(`poke_td_side|${draft.id}|${which}`, "Chercher autrement", ButtonStyle.Secondary),
        button(`poke_td_back|${draft.id}`, "Retour", ButtonStyle.Secondary)
      ),
    ],
  };
}

// ------------------------------- Réponses -------------------------------

// Un menu, un bouton ou une fenêtre de saisie réécrit le message du brouillon. Une
// fenêtre ouverte depuis ce message sait le réécrire (isFromMessage) ; sinon, on répond.
const show = (interaction, payload) => {
  const fromMessage = interaction.isFromMessage ? interaction.isFromMessage() : true;
  return (
    fromMessage
      ? interaction.update(payload)
      : interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
  ).catch(() => {});
};

const gone = (interaction) =>
  show(interaction, {
    content: "❌ Ce brouillon a expiré ou a été fermé : relance `/pk echange`, ou reclique sur " +
      "« Contre-offre » si l'offre est encore ouverte.",
    embeds: [],
    components: [],
  });

// Le brouillon que `interaction` a le droit de toucher, ou la réponse qui le dit.
async function loadDraft(interaction, draftId) {
  const draft = await getDraft(draftId);
  if (!draft) {
    await gone(interaction);
    return null;
  }
  if (draft.from_user_id !== interaction.user.id) {
    await interaction
      .reply({ content: "❌ Ce brouillon n'est pas à toi.", flags: MessageFlags.Ephemeral })
      .catch(() => {});
    return null;
  }
  return draft;
}

const showDraft = async (interaction, draft, note = null) =>
  show(interaction, await draftView(draft, note));

// Retient un choix après l'avoir contrôlé : un refus ne change rien et s'affiche sur
// l'écran du brouillon, avec ses chiffres.
async function chooseSide(interaction, draft, which, choice) {
  const checked = await checkSide(
    choice,
    choice.individual ?? null,
    ownerOf(draft, which),
    which === "give",
    receiverOf(draft, which)
  );
  if (checked.error) return showDraft(interaction, draft, `❌ ${checked.error}`);
  await setSide(draft.id, which, choice);
  return showDraft(interaction, await getDraft(draft.id));
}

// Ce que contient un champ de saisie, vide s'il n'a pas été rempli.
const field = (interaction, id) => {
  try {
    return String(interaction.fields.getTextInputValue(id) ?? "").trim();
  } catch {
    return "";
  }
};

// ------------------------------- Ouverture -------------------------------

// Ouvre le brouillon en réponse éphémère à /pk echange.
export async function openDraft(interaction, target) {
  // Ce qu'on demande part de 0 point, comme dans la commande : il reste à le changer.
  // Ouvert à tous (sans `target`), il part « à son choix ».
  const draftId = await createDraft({
    fromUserId: interaction.user.id,
    toUserId: target?.id ?? ANYONE,
    channelId: interaction.channelId,
    get: target ? { kind: "points", amount: 0 } : { kind: "open" },
  });
  const draft = await getDraft(draftId);
  return interaction.reply({ ...(await draftView(draft)), flags: MessageFlags.Ephemeral });
}

// ------------------------------- Contre-offre -------------------------------

// Ouvre le brouillon d'une contre-offre à `trade`, depuis le bouton de son message public.
// Côtés inversés : le destinataire donne ce qu'on lui demandait et demande ce qu'on lui
// offrait. Une offre « à son choix » ne lui a rien demandé de précis : ce qu'il donne
// est à choisir, et ce qu'on lui offrait est déjà rempli.
export async function openCounterDraft(interaction, trade) {
  const asked = choiceOfTradeSide(trade, "request");
  const draftId = await createDraft({
    // Celui qui clique : le destinataire, ou n'importe qui sur une offre ouverte à tous.
    fromUserId: interaction.user.id,
    toUserId: trade.from_user_id,
    channelId: interaction.channelId ?? trade.channel_id,
    counterOf: trade.id,
    give: asked.kind === "open" ? null : asked,
    get: choiceOfTradeSide(trade, "offer"),
  });
  const draft = await getDraft(draftId);
  return interaction.reply({ ...(await draftView(draft)), flags: MessageFlags.Ephemeral });
}

// ------------------------------- Proposer -------------------------------

// L'offre que `counterTrade` n'a pas trouvée ouverte : échue sans que personne ne l'ait
// fermée (elle expire ici, et son message le dit), ou déjà conclue par un autre clic.
async function counterIsStale(interaction, draft) {
  const original = await new Promise((resolve) => getTradeRow(draft.counter_of, (err, row) => resolve(err ? null : row)));
  if (original?.status === "PENDING" && original.expires_at <= Date.now()) {
    const expired = await new Promise((resolve) => expireTrade(original.id, (err, done) => resolve(!err && done)));
    if (expired) await syncTradeMessage(interaction.client, original.id);
  }
  // Deux clics rapprochés sur « Proposer » : le premier a contré l'offre, le second la
  // trouve fermée. Seul son destinataire — l'auteur de ce brouillon — peut la contrer :
  // COUNTERED veut donc dire que sa contre-offre part ou est partie. La ligne de la
  // contre-offre peut ne pas être écrite encore (le premier clic est en plein milieu) :
  // la chercher ferait annoncer une erreur à tort.
  if (original?.status === "COUNTERED") {
    await deleteDraft(draft.id);
    return show(interaction, {
      content: `✅ Ta contre-offre à <@${draft.to_user_id}> est déjà partie.`,
      embeds: [],
      components: [],
    });
  }
  await deleteDraft(draft.id);
  return show(interaction, {
    content: "❌ Cette offre a expiré ou a déjà été traitée : ta contre-offre n'est pas partie.",
    embeds: [],
    components: [],
  });
}

// « Proposer » : les deux côtés se contrôlent de nouveau (le solde ou le stock ont pu
// bouger), l'offre est créée par proposeTrade comme pour la commande — ou, pour une
// contre-offre, par counterTrade, qui ferme l'offre contrée dans le même geste —, puis
// publiée dans le salon. L'offre identique encore ouverte (unique) fait de deux clics
// rapprochés une seule offre.
async function propose(interaction, draft) {
  if (!draft.give || !draft.get) {
    return showDraft(interaction, draft, "❌ Il manque un côté : choisis ce que tu donnes et ce que tu demandes.");
  }
  const [offer, request] = await Promise.all([
    checkSide(draft.give, draft.give.individual ?? null, draft.from_user_id, true, targetOf(draft)),
    checkSide(draft.get, draft.get.individual ?? null, targetOf(draft), false, draft.from_user_id),
  ]);
  if (offer.error || request.error) {
    return showDraft(interaction, draft, `❌ ${offer.error ?? request.error}`);
  }
  const pointless = emptyTradeProblem(offer.side, request.side);
  if (pointless) return showDraft(interaction, draft, `❌ ${pointless}`);

  const channel = interaction.channel;
  if (!channel?.send) {
    return showDraft(interaction, draft, "❌ Je ne peux pas publier l'offre dans ce salon.");
  }

  const trade = await new Promise((resolve) => {
    const settle = (err, created, meta) => {
      if (err) handleException("Création d'échange depuis un brouillon :", err);
      resolve(
        err
          ? { error: true }
          : meta?.duplicate
            ? { duplicate: true }
            : meta?.stale
              ? { stale: true }
              : { trade: created }
      );
    };
    const sides = { offer: offer.side, request: request.side, channelId: draft.channel_id };
    if (draft.counter_of) {
      counterTrade({ tradeId: draft.counter_of, fromUserId: draft.from_user_id, ...sides }, settle);
    } else {
      proposeTrade(
        { fromUserId: draft.from_user_id, toUserId: draft.to_user_id, ...sides, unique: true },
        settle
      );
    }
  });
  if (trade.stale) return counterIsStale(interaction, draft);
  if (trade.duplicate) {
    return showDraft(
      interaction,
      draft,
      targetOf(draft)
        ? "❌ Une offre identique est déjà ouverte avec ce dresseur."
        : "❌ Une offre identique, ouverte à tous, est déjà en cours."
    );
  }
  if (trade.error) return showDraft(interaction, draft, "❌ Impossible de créer l'échange.");

  let message;
  try {
    // Ouverte à tous, l'offre ne mentionne personne.
    message = await channel.send({
      ...(targetOf(draft) ? { content: `<@${draft.to_user_id}>` } : {}),
      embeds: [buildTradeEmbed(trade.trade, "PENDING")],
      components: [buildTradeRow(trade.trade.id, tradeRowOptions(trade.trade))],
    });
  } catch (error) {
    // L'offre n'a pas de message, personne ne la verra : on la ferme, le brouillon reste.
    // Une contre-offre rouvre aussi l'offre qu'elle avait fermée : sans cela, les deux
    // disparaîtraient sans que personne ait rien décidé.
    handleException("Publication d'une offre d'échange :", error);
    await promisify(resolveTradeAs, trade.trade.id, draft.from_user_id, "CANCELLED").catch(() => {});
    if (draft.counter_of) {
      await promisify(reopenCountered, draft.counter_of).catch((reopenError) =>
        handleException("Réouverture d'une offre contrée :", reopenError)
      );
    }
    return showDraft(interaction, draft, "❌ Je ne peux pas publier l'offre dans ce salon.");
  }
  await linkTradeMessage(interaction.client, trade.trade.id, message.id);
  // Le message de l'offre contrée se réécrit d'après la base : « contre-offre », sans bouton.
  if (draft.counter_of) await syncTradeMessage(interaction.client, draft.counter_of);
  await deleteDraft(draft.id);
  return show(interaction, {
    content: targetOf(draft)
      ? `✅ ${draft.counter_of ? "Contre-offre" : "Offre"} envoyée à <@${draft.to_user_id}>.`
      : "✅ Offre publiée, ouverte à tous.",
    embeds: [],
    components: [],
  });
}

// ------------------------------- Routeurs -------------------------------

export async function handleDraftButton(interaction, action, args) {
  const [draftId, which] = args;
  const draft = await loadDraft(interaction, draftId);
  if (!draft) return;

  switch (action) {
    case "side":
      if (!isSide(which)) return;
      return show(interaction, kindView(draft, which));
    case "back":
      return showDraft(interaction, draft);
    case "go":
      return propose(interaction, draft);
    case "cancel":
      await deleteDraft(draft.id);
      return show(interaction, { content: "Échange annulé.", embeds: [], components: [] });
    default:
  }
}

export async function handleDraftSelect(interaction, action, args) {
  const [draftId, which, kind, quantity] = args;
  const draft = await loadDraft(interaction, draftId);
  if (!draft || !isSide(which)) return;
  const value = interaction.values?.[0];

  switch (action) {
    // La sorte de contenu : « Rien » se retient aussitôt, les autres demandent une saisie.
    case "kind":
      if (value === "nothing") {
        return chooseSide(interaction, draft, which, { kind: "points", amount: 0 });
      }
      if (value === "open" && which === "get") {
        return chooseSide(interaction, draft, which, { kind: "open" });
      }
      if (value === "points") return interaction.showModal(pointsModal(draft.id, which)).catch(() => {});
      if (value === "pk" || value === "item") {
        return interaction.showModal(findModal(draft.id, which, value)).catch(() => {});
      }
      return;

    // Une espèce ou un objet choisi dans les résultats. Pour ce qu'on donne, une espèce
    // mène au choix de l'individu, déjà retenu « le moins précieux » en attendant.
    case "pick": {
      const picked = parseChoice(value);
      if (!picked || picked.kind !== kind) return showDraft(interaction, draft, "❌ Choix invalide.");
      const choice =
        kind === "item"
          ? { kind: "item", id: picked.id, quantity: Number(quantity) || 1 }
          : { kind: "pk", id: picked.id, individual: null };
      if (kind === "pk" && which === "give") {
        const checked = await checkSide(choice, null, draft.from_user_id, true);
        if (checked.error) return showDraft(interaction, draft, `❌ ${checked.error}`);
        await setSide(draft.id, which, choice);
        return showIndividuals(interaction, await getDraft(draft.id), choice);
      }
      return chooseSide(interaction, draft, which, choice);
    }

    // L'individu qu'on donne, ou « le moins précieux » (le défaut).
    case "ind": {
      if (draft.give?.kind !== "pk") return showDraft(interaction, draft);
      const choice = { ...draft.give, individual: value === "auto" ? null : value };
      return chooseSide(interaction, draft, "give", choice);
    }
    default:
  }
}

// Le menu des individus de l'espèce qu'on donne : jamais le dernier ni un verrouillé.
async function showIndividuals(interaction, draft, choice) {
  const rows = await promisify(getIndividuals, draft.from_user_id);
  const choices = individualChoices(
    rows.filter((row) => row.species_id === Number(choice.id)),
    "",
    (row) => !row.last && !row.locked
  );
  const options = [{ name: "Le moins précieux (par défaut)", value: "auto" }, ...choices].slice(0, MAX_OPTIONS);
  return show(interaction, {
    content: "Quel individu donnes-tu ? Le moins précieux part si tu ne choisis pas.",
    embeds: [],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`poke_td_ind|${draft.id}|give`)
          .setPlaceholder("Un individu")
          .addOptions(options.map(({ name, value }) => ({ label: name.slice(0, 100), value })))
      ),
      backRow(draft.id),
    ],
  });
}

export async function handleDraftModal(interaction, action, args) {
  const [draftId, which, kind] = args;
  const draft = await loadDraft(interaction, draftId);
  if (!draft || !isSide(which)) return;

  switch (action) {
    // Un montant tapé : « 3000 », « 3 000 », « 3000 points ».
    case "pts": {
      const parsed = parseChoice(field(interaction, "amount"));
      if (parsed?.kind !== "points") {
        return showDraft(interaction, draft, "❌ Tape un nombre de points, par exemple 3000.");
      }
      return chooseSide(interaction, draft, which, parsed);
    }

    // Une recherche d'espèce ou d'objet chez le dresseur dont le côté se retire.
    case "find": {
      const needle = field(interaction, "query").toLowerCase();
      const owner = ownerOf(draft, which);
      if (kind === "pk") {
        const found = owner ? await speciesChoices(owner, needle) : anySpeciesChoices(needle);
        if (!found.length) {
          return show(interaction, kindView(draft, which, `❌ Aucune espèce « ${needle} » à échanger.`));
        }
        return show(interaction, pickView(draft, which, "pk", found.slice(0, MAX_OPTIONS), { total: found.length }));
      }
      const quantity = field(interaction, "quantity");
      const count = quantity ? Number(quantity.replace(/\s/g, "")) : 1;
      if (!Number.isSafeInteger(count) || count < 1) {
        return show(interaction, kindView(draft, which, "❌ La quantité doit être d'au moins 1."));
      }
      const found = owner ? await itemChoices(owner, needle, count) : anyItemChoices(needle, count);
      if (!found.length) {
        return show(interaction, kindView(draft, which, "❌ Aucun objet de ce nom à échanger."));
      }
      return show(interaction, pickView(draft, which, "item", found.slice(0, MAX_OPTIONS), { quantity: count, total: found.length }));
    }
    default:
  }
}
