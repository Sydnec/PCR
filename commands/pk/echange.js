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

// Ce qu'une option de côté (`je_donne`, `je_recois`) peut valoir : une espèce, un
// objet, des points ou rien. Le préfixe dit de quoi il s'agit, pour que l'autocomplétion
// mêle les trois sans qu'une clé d'objet se prenne pour un numéro d'espèce.
const POINTS = "pts";
const NOTHING = "rien";
const speciesValue = (id) => `pk:${id}`;
const itemValue = (key) => `item:${key}`;
function parseChoice(value) {
  if (value === POINTS || value === NOTHING) return { kind: value };
  const [kind, ...rest] = String(value ?? "").split(":");
  const id = rest.join(":");
  return id && (kind === "pk" || kind === "item") ? { kind, id } : null;
}

// Premier temps : les espèces dont `userId` a des Pokémon en trop, shiny ou
// non — jamais le dernier de l'espèce, jamais un verrouillé.
function speciesChoices(userId, needle) {
  return promisify(getIndividuals, userId).then((rows) =>
    [...countBySpecies(rows)]
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
          value: speciesValue(speciesId),
        };
      })
      .filter((choice) => choice && choice.name.toLowerCase().includes(needle))
  );
}

// Les objets de `userId` qui s'échangent. Tous le sont, sauf les charmes
// (isTradable).
function itemChoices(userId, needle) {
  return promisify(getInventory, userId).then((rows) =>
    rows
      .map((row) => ({ row, item: getItem(row.item_key) }))
      .filter(({ item }) => item && isTradable(item))
      .map(({ row, item }) => ({
        // Pas d'emoji : ceux du serveur ne se rendent pas dans une proposition.
        name: `${item.label} ×${row.count.toLocaleString("fr-FR")} (objet)`,
        value: itemValue(item.key),
      }))
      .filter((choice) => choice.name.toLowerCase().includes(needle))
  );
}

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

// Les choix d'un côté : ce que `userId` peut donner, plus les points. `giving` dit si c'est
// le côté de celui qui propose : « rien » n'y vaut pas la même chose qu'une demande.
async function respondWithSide(interaction, userId, query, { giving, emptyLabel }) {
  const needle = query.toLowerCase();
  try {
    const [species, items] = await Promise.all([speciesChoices(userId, needle), itemChoices(userId, needle)]);
    const specials = [
      { name: "Des points (indique le nombre)", value: POINTS },
      { name: giving ? "Rien (0 point)" : "Rien (0 point : un cadeau)", value: NOTHING },
    ].filter((choice) => choice.name.toLowerCase().includes(needle));
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
// qu'on fait un cadeau. Le nombre est celui des points ou la quantité de l'objet,
// selon ce que le côté contient.
const OPTIONS = {
  give: { choice: "je_donne", individual: "mon_individu", amount: "mon_nombre" },
  get: { choice: "je_recois", individual: null, amount: "son_nombre" },
};

// Un côté lu dans les options : `{ side }`, ou `{ error }` rédigé pour celui qui a
// tapé la commande. `owner` est le dresseur chez qui le côté se retire, `own` dit
// si c'est celui qui propose : « tu » ou « <@id> ». Chaque valeur s'est
// peut-être tapée à la main ou a vieilli depuis l'autocomplétion : tout se relit.
async function readSide(interaction, names, owner, own) {
  const who = own ? "Tu" : `<@${owner}>`;
  const raw = interaction.options.getString(names.choice);
  const individual = names.individual ? interaction.options.getString(names.individual) : null;
  const amount = interaction.options.getInteger(names.amount);

  if (raw === null || raw === undefined) {
    return {
      error:
        `Dis ${own ? "ce que tu donnes" : "ce que tu demandes"} (\`${names.choice}\`) : un Pokémon, ` +
        `des points ou un objet. « Rien » pour ne rien ${own ? "donner" : "demander"}.`,
    };
  }
  const choice = parseChoice(raw);
  if (!choice) return { error: "Choisis dans la liste d'autocomplétion." };

  // Une option qui ne va pas avec le côté choisi est refusée, pas ignorée : on
  // publierait une offre différente de celle qu'on croit avoir tapée.
  if (individual && choice.kind !== "pk") {
    return { error: `\`${names.individual}\` ne va qu'avec un Pokémon (\`${names.choice}\`).` };
  }
  if (amount !== null && (choice.kind === "pk" || choice.kind === NOTHING)) {
    return {
      error: `\`${names.amount}\` ne va qu'avec des points ou un objet (\`${names.choice}\`).`,
    };
  }

  if (choice.kind === NOTHING) return { side: { points: 0 } };

  if (choice.kind === POINTS) {
    if (amount === null) return { error: `Indique le nombre de points dans \`${names.amount}\`.` };
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

  if (choice.kind === "item") {
    const key = choice.id;
    const item = getItem(key);
    if (!item) return { error: "Objet inconnu : choisis-le dans la liste d'autocomplétion." };
    if (!isTradable(item)) {
      return { error: `**${item.label}** ne s'échange pas : un charme se gagne, il ne se transmet pas.` };
    }
    const quantity = amount ?? 1;
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
  const { species: found, error } = resolveSpecies(choice.id);
  if (error) return { error };
  if (own && individual) {
    const selector = await promisify(resolveIndividual, owner, choice.id, individual);
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

// Les descriptions des options sont volontairement courtes : /pk s'approche de la limite
// de 8 000 caractères que Discord impose à une commande entière, et en dépasser un seul
// fait refuser TOUTES les commandes au démarrage (voir test/commands-pk.test.js). Pour la
// même raison, chaque côté tient en deux options : ce qu'il contient (espèce, objet ou
// points, dans une seule autocomplétion) et un nombre.
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
          .setDescription("Ce que tu donnes")
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
      .addIntegerOption((option) =>
        option
          .setName("mon_nombre")
          .setDescription("Points ou quantité")
          .setRequired(false)
          .setMinValue(0)
      )
      .addStringOption((option) =>
        option
          .setName("je_recois")
          .setDescription("Ce que tu demandes (il choisit lequel)")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addIntegerOption((option) =>
        option
          .setName("son_nombre")
          .setDescription("Points ou quantité")
          .setRequired(false)
          .setMinValue(0)
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
