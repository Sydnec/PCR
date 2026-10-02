import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import { getBalance } from "../../modules/economy.js";
import {
  countBySpecies,
  getIndividuals,
  proposeTrade,
  resolveIndividual,
  resolveSpecies,
  selectorOf,
  setTradeMessage,
  tradeCandidate,
} from "../../modules/pokemon/collection.js";
import { getSpecies, tradeEvolutionTarget } from "../../modules/pokemon/data.js";
import { getInventory, getItem, getItemCount, isTradable } from "../../modules/pokemon/items.js";
import {
  buildTradeEmbed,
  buildTradeRow,
  describeGroup,
  individualChoices,
  respondHint as hint,
} from "../../modules/pokemon/embeds.js";

const promisify = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (err, value) => (err ? reject(err) : resolve(value))));

// Premier temps : les espèces dont `userId` a des Pokémon en trop, shiny ou
// non — jamais le dernier de l'espèce, jamais un verrouillé.
function respondWithSpecies(interaction, userId, query, emptyLabel) {
  getIndividuals(userId, (err, rows) => {
    if (err) {
      handleException("Autocomplétion d'échange :", err);
      return interaction.respond([]).catch(() => {});
    }
    const needle = query.toLowerCase();
    const choices = [...countBySpecies(rows)]
      .map(([speciesId, { spare }]) => {
        const species = getSpecies(speciesId);
        if (!species || spare < 1) return null;
        // Les quatre évolutions par échange se disent ici plutôt que dans un
        // message d'aide que personne ne lit : c'est l'instant exact où on choisit
        // ce qu'on donne. Le filtre portant sur le libellé, taper « mackogneur »
        // remonte le Machopeur qui y mène.
        const evolved = tradeEvolutionTarget(species);
        return {
          name:
            `${species.name} ×${spare} en trop` +
            (evolved ? ` — évoluera gratuitement en ${evolved.name} chez l'autre` : ""),
          value: String(speciesId),
        };
      })
      .filter((choice) => choice && choice.name.toLowerCase().includes(needle))
      .slice(0, 25);

    // Une liste vide est indiscernable d'une commande cassée : on dit
    // explicitement qu'il n'y a aucun Pokémon à échanger.
    if (!choices.length) return hint(interaction, emptyLabel);
    interaction.respond(choices).catch(() => {});
  });
}

// Second temps, pour ce qu'on donne : les individus de l'espèce choisie dans
// `je_donne`, jamais le dernier de l'espèce ni un verrouillé. Qui reçoit sait ainsi
// exactement quel Pokémon il aura : sexe, variante, fertilité, ball. Ce qu'on
// demande ne se choisit pas ici : c'est le destinataire qui désigne le sien en
// acceptant.
function respondWithIndividuals(interaction, userId, query) {
  const species = getSpecies(Number(interaction.options.get("je_donne")?.value));
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

// Les objets de `userId` qui s'échangent, filtrés sur le libellé. Tous le sont,
// sauf les charmes (isTradable).
function respondWithItems(interaction, userId, query, emptyLabel) {
  getInventory(userId, (err, rows) => {
    if (err) {
      handleException("Autocomplétion d'échange :", err);
      return interaction.respond([]).catch(() => {});
    }
    const needle = query.toLowerCase();
    const choices = rows
      .map((row) => ({ row, item: getItem(row.item_key) }))
      .filter(({ item }) => item && isTradable(item))
      .map(({ row, item }) => ({
        // Pas d'emoji : ceux du serveur ne se rendent pas dans une proposition.
        name: `${item.label} ×${row.count.toLocaleString("fr-FR")}`,
        value: item.key,
      }))
      .filter((choice) => choice.name.toLowerCase().includes(needle))
      .slice(0, 25);
    if (!choices.length) return hint(interaction, emptyLabel);
    interaction.respond(choices).catch(() => {});
  });
}

// Les trois façons de remplir un côté de l'offre : un Pokémon (l'espèce, et pour
// ce qu'on donne l'individu), des points, ou un objet. Chaque côté en veut une
// seule : aucune évolution ne demande à la fois un échange et un objet, il n'y a
// donc rien à gagner à les mélanger. Zéro point est un côté valide : c'est ainsi
// qu'on fait un cadeau.
const OPTIONS = {
  give: { species: "je_donne", individual: "mon_individu", points: "mes_points", item: "mon_objet", quantity: "mon_objet_quantite" },
  get: { species: "je_recois", individual: null, points: "ses_points", item: "son_objet", quantity: "son_objet_quantite" },
};

// Un côté lu dans les options : `{ side }`, ou `{ error }` rédigé pour celui qui a
// tapé la commande. `owner` est le dresseur chez qui le côté se retire, `own` dit
// si c'est celui qui propose : « tu » ou « <@id> ». Chaque valeur s'est
// peut-être tapée à la main ou a vieilli depuis l'autocomplétion : tout se relit.
async function readSide(interaction, names, owner, own) {
  const who = own ? "Tu" : `<@${owner}>`;
  const species = interaction.options.getString(names.species);
  const individual = names.individual ? interaction.options.getString(names.individual) : null;
  const amount = interaction.options.getInteger(names.points);
  const key = interaction.options.getString(names.item);
  const filled = [species, amount, key].filter((value) => value !== null && value !== undefined);

  if (filled.length === 0) {
    return {
      error:
        `Dis ${own ? "ce que tu donnes" : "ce que tu demandes"} : un Pokémon ` +
        `(\`${names.species}\`), des points (\`${names.points}\`) ou un objet ` +
        `(\`${names.item}\`). \`${names.points}: 0\` pour ne rien ${own ? "donner" : "demander"}.`,
    };
  }
  if (filled.length > 1) {
    return {
      error:
        `Un seul à la fois ${own ? "de ton côté" : "de son côté"} : un Pokémon, des points ` +
        `ou un objet — pas un mélange.`,
    };
  }
  // Une option qui ne va pas avec le côté choisi est refusée, pas ignorée : on
  // publierait une offre différente de celle qu'on croit avoir tapée.
  if (individual && (amount !== null || key !== null)) {
    return { error: `\`${names.individual}\` ne va qu'avec un Pokémon (\`${names.species}\`).` };
  }
  if (interaction.options.getInteger(names.quantity) !== null && key === null) {
    return { error: `\`${names.quantity}\` ne va qu'avec un objet (\`${names.item}\`).` };
  }

  if (amount !== null && amount !== undefined) {
    if (!Number.isInteger(amount) || amount < 0) return { error: "Un montant de points ne peut pas être négatif." };
    const balance = await promisify(getBalance, owner);
    if (amount > balance) {
      return {
        error:
          `${who} ${own ? "n'as" : "n'a"} que **${balance.toLocaleString("fr-FR")}** points : ` +
          `${own ? "il t'en faut" : "il lui en faut"} **${amount.toLocaleString("fr-FR")}**.`,
      };
    }
    return { side: { points: amount } };
  }

  if (key !== null && key !== undefined) {
    const item = getItem(key);
    if (!item) return { error: "Objet inconnu : choisis-le dans la liste d'autocomplétion." };
    if (!isTradable(item)) {
      return { error: `**${item.label}** ne s'échange pas : un charme se gagne, il ne se transmet pas.` };
    }
    const quantity = interaction.options.getInteger(names.quantity) ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) return { error: "La quantité doit être d'au moins 1." };
    const held = await promisify(getItemCount, owner, key);
    if (quantity > held) {
      return {
        error:
          `${who} ${own ? "n'as" : "n'a"} que **${held.toLocaleString("fr-FR")}** ${item.label} : ` +
          `${own ? "il t'en faut" : "il lui en faut"} **${quantity.toLocaleString("fr-FR")}**.`,
      };
    }
    return { side: { item: key, quantity } };
  }

  // Un Pokémon. Celui qu'on donne se désigne (mon_individu), faute de quoi c'est le
  // moins précieux, le plus récent à égalité (tradeCandidate) ; celui qu'on demande
  // se choisit chez le destinataire, en acceptant : il faut seulement qu'il en ait un
  // libre.
  const { species: found, error } = resolveSpecies(species);
  if (error) return { error };
  if (own && individual) {
    const selector = await promisify(resolveIndividual, owner, species, individual);
    if (selector.error) return { error: selector.error };
    if (selector.row.locked) {
      return {
        error:
          `**${describeGroup(found, selector)}** est verrouillé 🛡️ : déverrouille-le avec ` +
          `/pk verrou pour l'échanger.`,
      };
    }
    if (selector.row.last) {
      return {
        error:
          `**${describeGroup(found, selector)}** est ton dernier ${found.name} : il reste ` +
          `toujours au moins un Pokémon de chaque espèce.`,
      };
    }
    return { side: selector };
  }
  const candidate = await promisify(tradeCandidate, owner, found.id);
  if (!candidate) {
    return {
      error:
        `${who} ${own ? "n'as" : "n'a"} aucun ${found.name} à donner : ` +
        `ils sont verrouillés, ou il ${own ? "ne t'en reste" : "ne lui en reste"} qu'un.`,
    };
  }
  return { side: own ? selectorOf(candidate) : { speciesId: found.id } };
}

export default {
  describe: (sub) =>
    sub
      .setName("echange")
      .setDescription("Propose un échange : Pokémon, points ou objets, de chaque côté")
      .addUserOption((option) =>
        option
          .setName("membre")
          .setDescription("Le dresseur à qui proposer l'échange")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("je_donne")
          .setDescription("L'espèce que tu proposes")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName("mon_individu")
          .setDescription("Le Pokémon précis que tu proposes (par défaut, le moins précieux)")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addIntegerOption((option) =>
        option
          .setName("mes_points")
          .setDescription("Des points que tu proposes (0 pour ne rien donner)")
          .setRequired(false)
          .setMinValue(0)
      )
      .addStringOption((option) =>
        option
          .setName("mon_objet")
          .setDescription("Un objet que tu proposes")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addIntegerOption((option) =>
        option
          .setName("mon_objet_quantite")
          .setDescription("Combien d'exemplaires de l'objet (1 par défaut)")
          .setRequired(false)
          .setMinValue(1)
      )
      .addStringOption((option) =>
        option
          .setName("je_recois")
          .setDescription("L'espèce que tu demandes : le dresseur choisit lequel")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addIntegerOption((option) =>
        option
          .setName("ses_points")
          .setDescription("Des points que tu demandes (0 pour ne rien demander)")
          .setRequired(false)
          .setMinValue(0)
      )
      .addStringOption((option) =>
        option
          .setName("son_objet")
          .setDescription("Un objet que tu demandes")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addIntegerOption((option) =>
        option
          .setName("son_objet_quantite")
          .setDescription("Combien d'exemplaires de l'objet (1 par défaut)")
          .setRequired(false)
          .setMinValue(1)
      ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const query = String(focused.value ?? "");
    if (focused.name === "je_donne") {
      return respondWithSpecies(
        interaction,
        interaction.user.id,
        query,
        "Tu n'as rien à échanger : il reste toujours un Pokémon de chaque espèce"
      );
    }
    if (focused.name === "mon_individu") {
      return respondWithIndividuals(interaction, interaction.user.id, query);
    }
    if (focused.name === "mon_objet") {
      return respondWithItems(interaction, interaction.user.id, query, "Tu n'as aucun objet à échanger");
    }

    // Les autres options sont déjà lisibles pendant l'autocomplétion : on peut
    // donc proposer la collection du destinataire.
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
      return respondWithSpecies(
        interaction,
        String(targetId),
        query,
        "Ce dresseur n'a rien à échanger"
      );
    }
    if (focused.name === "son_objet") {
      return respondWithItems(interaction, String(targetId), query, "Ce dresseur n'a aucun objet à échanger");
    }
    return interaction.respond([]).catch(() => {});
  },

  async execute(interaction) {
    try {
      const target = interaction.options.getUser("membre");
      const refuse = (content) =>
        interaction.reply({ content: `❌ ${content}`, flags: MessageFlags.Ephemeral });

      if (target.id === interaction.user.id) return refuse("Tu ne peux pas échanger avec toi-même.");
      if (target.bot) return refuse("Les bots ne collectionnent pas les Pokémon.");

      let offer, request;
      try {
        [offer, request] = await Promise.all([
          readSide(interaction, OPTIONS.give, interaction.user.id, true),
          readSide(interaction, OPTIONS.get, target.id, false),
        ]);
      } catch (err) {
        handleException("Lecture des côtés pour /pk echange :", err);
        return refuse("Erreur base de données.");
      }
      if (offer.error || request.error) return refuse(offer.error ?? request.error);
      if (offer.side.points === 0 && request.side.points === 0) {
        return refuse("Rien à échanger : les deux côtés sont à 0 point.");
      }

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

          const message = await interaction.editReply({
            content: `<@${target.id}>`,
            embeds: [buildTradeEmbed(trade, "PENDING")],
            components: [buildTradeRow(trade.id)],
          });
          setTradeMessage(trade.id, message.id);
        }
      );
    } catch (error) {
      handleException(error);
    }
  },
};
