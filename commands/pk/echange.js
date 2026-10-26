import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import { getIndividuals, proposeTrade, resolveTradeAs } from "../../modules/pokemon/collection.js";
import { linkTradeMessage } from "../../modules/pokemon/trade-message.js";
import { getSpecies } from "../../modules/pokemon/data.js";
import {
  buildTradeEmbed,
  buildTradeRow,
  HINT_VALUE,
  individualChoices,
  respondHint as hint,
} from "../../modules/pokemon/embeds.js";
import {
  checkSide,
  emptyTradeProblem,
  itemChoices,
  OPEN_VALUE,
  parseChoice,
  pointsValue,
  readNumberQuery,
  speciesChoices,
} from "../../modules/pokemon/trade-side.js";
import { openDraft } from "../../modules/pokemon/trade-draft.js";

// Une seule liste de 25 pour les trois sortes de choix : les entrées fixes d'abord, puis
// les espèces et les objets se partagent la place, sans que l'un chasse l'autre — taper
// quelques lettres suffit à tout retrouver.
const MAX_CHOICES = 25;
function mixedChoices(specials, species, items) {
  const room = MAX_CHOICES - specials.length;
  const itemsShown = Math.min(items.length, Math.max(10, room - species.length));
  const speciesShown = Math.min(species.length, room - itemsShown);
  return [...specials, ...species.slice(0, speciesShown), ...items.slice(0, itemsShown)];
}

// Les choix d'un côté : ce que `userId` peut donner, plus « Rien ». Une saisie qui
// commence par un nombre propose des points, ou une quantité d'un objet. `giving` dit si
// c'est le côté de celui qui propose : « rien » n'y vaut pas la même chose qu'une demande.
async function respondWithSide(interaction, userId, query, { giving, emptyLabel }) {
  const needle = query.toLowerCase();
  try {
    const typed = readNumberQuery(query);
    if (typed && !typed.rest) {
      if (!Number.isSafeInteger(typed.amount)) return hint(interaction, "Ce nombre est trop grand");
      const name = `${typed.amount.toLocaleString("fr-FR")} point${typed.amount > 1 ? "s" : ""}`;
      return interaction.respond([{ name, value: pointsValue(typed.amount) }]).catch(() => {});
    }
    if (typed) {
      const items = await itemChoices(userId, typed.rest.toLowerCase(), typed.amount);
      if (!items.length) return hint(interaction, `Aucun objet « ${typed.rest} » à échanger`);
      return interaction.respond(items.slice(0, MAX_CHOICES)).catch(() => {});
    }

    const [species, items] = await Promise.all([speciesChoices(userId, needle), itemChoices(userId, needle)]);
    const specials = [
      { name: "Pour des points, tape un nombre (ex. 3000)", value: HINT_VALUE },
      { name: giving ? "Rien (0 point)" : "Rien (0 point : un cadeau)", value: pointsValue(0) },
      // Au destinataire de dire ce qu'il donne en retour : sa réponse est une contre-offre.
      ...(giving ? [] : [{ name: "🎁 À son choix", value: OPEN_VALUE }]),
    ].filter((choice) => !needle || (choice.value !== HINT_VALUE && choice.name.toLowerCase().includes(needle)));
    const choices = mixedChoices(specials, species, items);
    // Une liste vide est indiscernable d'une commande cassée : on dit explicitement
    // qu'il n'y a rien à échanger.
    if (!choices.length) return hint(interaction, emptyLabel);
    return interaction.respond(choices).catch(() => {});
  } catch (err) {
    handleException("Autocomplétion d'échange :", err);
    return interaction.respond([]).catch(() => {});
  }
}

// Second temps, pour ce qu'on donne : les individus de l'espèce choisie dans
// `je_donne`, jamais le dernier de l'espèce ni un verrouillé. Qui reçoit sait ainsi
// exactement quel Pokémon il aura : sexe, variante, fertilité, ball. Ce qu'on
// demande ne se choisit pas ici : c'est le destinataire qui désigne le sien en
// acceptant.
function respondWithIndividuals(interaction, userId, query) {
  const choice = parseChoice(interaction.options.get("je_donne")?.value);
  const species = choice?.kind === "pk" ? getSpecies(Number(choice.id)) : null;
  if (!species) {
    return hint(interaction, "⚠️ Choisis d'abord l'espèce dans l'option « je_donne »");
  }
  getIndividuals(userId, (err, rows) => {
    if (err) {
      handleException("Autocomplétion d'échange :", err);
      return interaction.respond([]).catch(() => {});
    }
    const choices = individualChoices(
      rows.filter((row) => row.species_id === species.id),
      query,
      (row) => !row.last && !row.locked
    );
    if (!choices.length) {
      return hint(interaction, `Aucun ${species.name} à échanger : verrouillés, ou il n'en reste qu'un`);
    }
    interaction.respond(choices).catch(() => {});
  });
}

// Les trois façons de remplir un côté de l'offre : un Pokémon (l'espèce, et pour
// ce qu'on donne l'individu), des points, ou un objet. Chaque côté en veut une
// seule : aucune évolution ne demande à la fois un échange et un objet, il n'y a
// donc rien à gagner à les mélanger. Zéro point est un côté valide : c'est ainsi
// qu'on fait un cadeau.
const OPTIONS = {
  give: { choice: "je_donne", individual: "mon_individu" },
  get: { choice: "je_recois", individual: null },
};

// Un côté lu dans les options : `{ side }`, ou `{ error }` rédigé pour celui qui a
// tapé la commande. `owner` est le dresseur chez qui le côté se retire, `own` dit
// si c'est celui qui propose : « tu » ou « <@id> », `receiver` celui qui reçoit le
// côté. Chaque valeur s'est peut-être tapée à la main ou a vieilli depuis
// l'autocomplétion : tout se relit.
async function readSide(interaction, names, owner, own, receiver) {
  const raw = interaction.options.getString(names.choice);
  const individual = names.individual ? interaction.options.getString(names.individual) : null;

  if (raw === null || raw === undefined) {
    return {
      error:
        `Dis ${own ? "ce que tu donnes" : "ce que tu demandes"} (\`${names.choice}\`) : un Pokémon, ` +
        `un objet ou un nombre de points (0 pour ne rien ${own ? "donner" : "demander"}).`,
    };
  }
  const choice = parseChoice(raw);
  if (!choice) {
    return { error: "Choisis dans la liste d'autocomplétion, ou tape un nombre pour des points." };
  }

  // Une option qui ne va pas avec le côté choisi est refusée, pas ignorée : on
  // publierait une offre différente de celle qu'on croit avoir tapée.
  if (individual && choice.kind !== "pk") {
    return { error: `\`${names.individual}\` ne va qu'avec un Pokémon (\`${names.choice}\`).` };
  }

  return checkSide(choice, individual, owner, own, receiver);
}

// Les descriptions des options sont volontairement courtes : /pk s'approche de la limite
// de 8 000 caractères que Discord impose à une commande entière, et en dépasser un seul
// fait refuser TOUTES les commandes au démarrage (voir test/commands-pk.test.js). Pour la
// même raison, chaque côté tient en une seule option : espèce, objet ou points, dans la
// même autocomplétion — un nombre tapé vaut des points, « 3 bonbon » trois de cet objet.
export default {
  describe: (sub) =>
    sub
      .setName("echange")
      .setDescription("Propose un échange : Pokémon, points ou objets")
      .addUserOption((option) =>
        option
          .setName("membre")
          .setDescription("Le destinataire")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("je_donne")
          .setDescription("Ce que tu donnes (un nombre : des points)")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName("mon_individu")
          .setDescription("Individu précis (défaut : le moins précieux)")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName("je_recois")
          .setDescription("Ce que tu demandes (un nombre : des points)")
          .setRequired(false)
          .setAutocomplete(true)
      ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const query = String(focused.value ?? "");
    if (focused.name === "je_donne") {
      return respondWithSide(interaction, interaction.user.id, query, {
        giving: true,
        emptyLabel: "Tu n'as rien à échanger : il reste toujours un Pokémon de chaque espèce",
      });
    }
    if (focused.name === "mon_individu") {
      return respondWithIndividuals(interaction, interaction.user.id, query);
    }

    // L'autre option est déjà lisible pendant l'autocomplétion : on peut donc
    // proposer la collection du destinataire.
    //
    // getUser() renvoie TOUJOURS null ici : Discord n'envoie pas le bloc
    // `resolved` avec une interaction d'autocomplétion, et discord.js construit
    // donc les options sans objet utilisateur (voir AutocompleteInteraction, qui
    // passe les options brutes au resolver). Seule la valeur brute de l'option
    // — l'identifiant du membre — est disponible. Avec getUser(), la liste était
    // systématiquement vide.
    const targetId = interaction.options.get("membre")?.value;
    if (!targetId) return hint(interaction, "⚠️ Choisis d'abord le dresseur dans l'option « membre »");
    if (focused.name === "je_recois") {
      return respondWithSide(interaction, String(targetId), query, {
        giving: false,
        emptyLabel: "Ce dresseur n'a rien à échanger",
      });
    }
    return interaction.respond([]).catch(() => {});
  },

  async execute(interaction) {
    try {
      const target = interaction.options.getUser("membre");
      const refuse = (content) =>
        interaction.reply({ content: `❌ ${content}`, flags: MessageFlags.Ephemeral });

      if (target.bot) return refuse("Les bots ne collectionnent pas les Pokémon.");

      // Ni ce qu'on donne ni ce qu'on demande : le brouillon, un écran privé où l'on
      // choisit avec des menus. Une option seule reste une offre incomplète, refusée plus
      // bas avec ce qu'il manque.
      const empty = [OPTIONS.give.choice, OPTIONS.give.individual, OPTIONS.get.choice].every(
        (name) => interaction.options.getString(name) === null
      );
      if (empty) {
        try {
          return await openDraft(interaction, target);
        } catch (err) {
          handleException("Ouverture du brouillon d'échange :", err);
          return refuse("Erreur base de données.");
        }
      }

      let offer, request;
      try {
        [offer, request] = await Promise.all([
          readSide(interaction, OPTIONS.give, interaction.user.id, true, target.id),
          readSide(interaction, OPTIONS.get, target.id, false, interaction.user.id),
        ]);
      } catch (err) {
        handleException("Lecture des côtés pour /pk echange :", err);
        return refuse("Erreur base de données.");
      }
      if (offer.error || request.error) return refuse(offer.error ?? request.error);
      const pointless = emptyTradeProblem(offer.side, request.side);
      if (pointless) return refuse(pointless);

      await interaction.deferReply();

      // La fertilité de chaque individu fait partie de l'offre (proposeTrade) : qui
      // reçoit une femelle fertile doit pouvoir compter dessus. Si elle pond
      // entre-temps, acceptTrade ne la trouve plus, et l'échange échoue plutôt que
      // de livrer autre chose que ce qui était promis.
      proposeTrade(
        {
          fromUserId: interaction.user.id,
          toUserId: target.id,
          offer: offer.side,
          request: request.side,
          channelId: interaction.channelId,
        },
        async (err, trade) => {
          if (err || !trade) {
            handleException(err || new Error("Création d'échange impossible"));
            return interaction
              .editReply({ content: "❌ Impossible de créer l'échange." })
              .catch(() => {});
          }

          // Une offre que personne ne verra n'a pas à rester ouverte : sans message,
          // ses boutons n'existent pas.
          let message;
          try {
            message = await interaction.editReply({
              content: `<@${target.id}>`,
              embeds: [buildTradeEmbed(trade, "PENDING")],
              components: [buildTradeRow(trade.id, { open: Boolean(trade.request_open) })],
            });
          } catch (error) {
            handleException("Publication d'une offre d'échange :", error);
            return resolveTradeAs(trade.id, interaction.user.id, "CANCELLED", (err) => {
              if (err) handleException("Annulation d'une offre non publiée :", err);
            });
          }
          await linkTradeMessage(interaction.client, trade.id, message.id);
        }
      );
    } catch (error) {
      handleException(error);
    }
  },
};
