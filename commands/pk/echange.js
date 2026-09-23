import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import {
  countGroup,
  createTrade,
  getIndividuals,
  resolveIndividual,
  setTradeMessage,
} from "../../modules/pokemon/collection.js";
import { getSpecies, tradeEvolutionTarget } from "../../modules/pokemon/data.js";
import {
  buildTradeEmbed,
  buildTradeRow,
  describeGroup,
  individualChoices,
} from "../../modules/pokemon/embeds.js";

// Discord n'autorise pas de liste vide accompagnée d'un message : une
// proposition inerte est le seul moyen d'expliquer pourquoi il n'y a rien à
// choisir. Sa valeur ne désigne ni une espèce ni un individu, donc execute()
// la refuse.
const HINT_VALUE = "—";
const hint = (interaction, name) =>
  interaction.respond([{ name, value: HINT_VALUE }]).catch(() => {});

// Il reste toujours au moins un Pokémon de chaque espèce : on ne peut céder
// que ce qu'on a en plus. acceptTrade tient la règle ; ce chiffre ne sert qu'à
// ne proposer et n'accepter que des échanges qui ont une chance d'aboutir.
const spareIn = (userId, group) =>
  new Promise((resolve, reject) =>
    countGroup(userId, group, (err, { spare }) => (err ? reject(err) : resolve(spare)))
  );

// Premier temps : les espèces dont `userId` a des Pokémon en trop, shiny ou non.
function respondWithSpecies(interaction, userId, query, emptyLabel) {
  getIndividuals(userId, (err, rows) => {
    if (err) {
      handleException("Autocomplétion d'échange :", err);
      return interaction.respond([]).catch(() => {});
    }
    const counts = new Map();
    for (const row of rows) counts.set(row.species_id, (counts.get(row.species_id) ?? 0) + 1);
    const needle = query.toLowerCase();
    const choices = [...counts]
      .map(([speciesId, count]) => {
        const species = getSpecies(speciesId);
        if (!species || count < 2) return null;
        // Les quatre évolutions par échange se déclarent ici plutôt que dans un
        // message d'aide que personne ne lit : c'est l'instant exact où on
        // choisit ce qu'on donne. Le filtre portant sur le libellé, taper
        // « mackogneur » remonte le Machopeur qui y mène.
        const evolved = tradeEvolutionTarget(species);
        return {
          name:
            `${species.name} ×${count - 1} en trop` +
            (evolved ? ` — évolue en ${evolved.name}` : ""),
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

// Second temps : les individus de l'espèce choisie dans `speciesOption`,
// jamais le dernier de l'espèce. Qui reçoit sait ainsi exactement quel
// Pokémon il aura : sexe, variante, fertilité, ball.
function respondWithIndividuals(interaction, userId, speciesOption, query) {
  const species = getSpecies(Number(interaction.options.get(speciesOption)?.value));
  if (!species) {
    return hint(interaction, `⚠️ Choisis d'abord l'espèce dans l'option « ${speciesOption} »`);
  }
  getIndividuals(userId, (err, rows) => {
    if (err) return interaction.respond([]).catch(() => {});
    const choices = individualChoices(
      rows.filter((row) => row.species_id === species.id),
      query,
      (row) => !row.last
    );
    if (!choices.length) return hint(interaction, `Aucun ${species.name} à échanger`);
    interaction.respond(choices).catch(() => {});
  });
}

export default {
  describe: (sub) =>
    sub
      .setName("echange")
      .setDescription("Propose un échange de Pokémon à un autre dresseur")
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
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName("mon_individu")
          .setDescription("Le Pokémon précis que tu proposes")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName("je_recois")
          .setDescription("L'espèce que tu demandes")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName("son_individu")
          .setDescription("Le Pokémon précis que tu demandes")
          .setRequired(true)
          .setAutocomplete(true)
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
      return respondWithIndividuals(interaction, interaction.user.id, "je_donne", query);
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
    return respondWithIndividuals(interaction, String(targetId), "je_recois", query);
  },

  async execute(interaction) {
    try {
      const target = interaction.options.getUser("membre");
      // Chaque côté est un individu précis, qui se résout chez son propriétaire
      // — le sien pour ce qu'on donne, celui du destinataire pour ce qu'on
      // demande — et doit être de l'espèce choisie juste avant.
      const resolve = (ownerId, speciesOption, individualOption) =>
        new Promise((ok, fail) =>
          resolveIndividual(
            ownerId,
            interaction.options.getString(speciesOption),
            interaction.options.getString(individualOption),
            (err, selector) => (err ? fail(err) : ok(selector))
          )
        );
      let offer, request;
      try {
        [offer, request] = await Promise.all([
          resolve(interaction.user.id, "je_donne", "mon_individu"),
          resolve(target.id, "je_recois", "son_individu"),
        ]);
      } catch (err) {
        handleException("Lecture des Pokémon pour /pk echange :", err);
        return interaction.reply({
          content: "❌ Erreur base de données.",
          flags: MessageFlags.Ephemeral,
        });
      }
      const refus = offer.error ?? request.error;
      if (refus) {
        return interaction.reply({ content: `❌ ${refus}`, flags: MessageFlags.Ephemeral });
      }

      if (target.id === interaction.user.id) {
        return interaction.reply({
          content: "❌ Tu ne peux pas échanger avec toi-même.",
          flags: MessageFlags.Ephemeral,
        });
      }
      if (target.bot) {
        return interaction.reply({
          content: "❌ Les bots ne collectionnent pas les Pokémon.",
          flags: MessageFlags.Ephemeral,
        });
      }
      const offered = getSpecies(offer.speciesId);
      const requested = getSpecies(request.speciesId);
      if (!offered || !requested) {
        return interaction.reply({
          content:
            "❌ Pokémon inconnu : choisis une proposition dans la liste d'autocomplétion.",
          flags: MessageFlags.Ephemeral,
        });
      }

      // Une valeur tapée à la main contourne l'autocomplétion : sans ce
      // contrôle, on publierait une offre qu'acceptTrade refuserait au clic.
      // Le refus reste privé, avant que la proposition n'existe.
      let offerSpare, requestSpare;
      try {
        [offerSpare, requestSpare] = await Promise.all([
          spareIn(interaction.user.id, offer),
          spareIn(target.id, request),
        ]);
      } catch (err) {
        handleException("Lecture des collections pour /pk echange :", err);
        return interaction.reply({
          content: "❌ Erreur base de données.",
          flags: MessageFlags.Ephemeral,
        });
      }
      if (offerSpare === 0) {
        return interaction.reply({
          content:
            `❌ **${describeGroup(offered, offer)}** est ton dernier ${offered.name} : il reste ` +
            `toujours au moins un Pokémon de chaque espèce.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (requestSpare === 0) {
        return interaction.reply({
          content:
            `❌ **${describeGroup(requested, request)}** est le dernier ${requested.name} de ` +
            `<@${target.id}> : il lui en reste toujours un.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply();

      // La fertilité de chaque individu fait partie de l'offre : qui reçoit une
      // femelle fertile doit pouvoir compter dessus. Si elle pond entre-temps,
      // acceptTrade ne la trouve plus, et l'échange échoue plutôt que de livrer
      // autre chose que ce qui était promis.
      const fertility = (side) => !side.row.sterile;

      createTrade(
        {
          fromUserId: interaction.user.id,
          toUserId: target.id,
          offerSpeciesId: offer.speciesId,
          offerIsShiny: offer.isShiny,
          offerSex: offer.sex,
          offerFertile: fertility(offer),
          requestSpeciesId: request.speciesId,
          requestIsShiny: request.isShiny,
          requestSex: request.sex,
          requestFertile: fertility(request),
          offerPokemonId: offer.pokemonId,
          requestPokemonId: request.pokemonId,
          channelId: interaction.channelId,
        },
        async (err, tradeId) => {
          if (err || !tradeId) {
            handleException(err || new Error("Création d'échange impossible"));
            return interaction
              .editReply({ content: "❌ Impossible de créer l'échange." })
              .catch(() => {});
          }

          const trade = {
            from_user_id: interaction.user.id,
            to_user_id: target.id,
            offer_species_id: offer.speciesId,
            offer_is_shiny: offer.isShiny ? 1 : 0,
            offer_sex: offer.sex,
            offer_fertile: fertility(offer) ? 1 : 0,
            request_species_id: request.speciesId,
            request_is_shiny: request.isShiny ? 1 : 0,
            request_sex: request.sex,
            request_fertile: fertility(request) ? 1 : 0,
            offer_pokemon_id: offer.pokemonId,
            request_pokemon_id: request.pokemonId,
          };

          const message = await interaction.editReply({
            content: `<@${target.id}>`,
            embeds: [buildTradeEmbed(trade, "PENDING")],
            components: [buildTradeRow(tradeId)],
          });
          setTradeMessage(tradeId, message.id);
        }
      );
    } catch (error) {
      handleException(error);
    }
  },
};
