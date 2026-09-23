import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException } from "../modules/utils.js";
import {
  countGroup,
  createTrade,
  decodeEntry,
  getIndividuals,
  groupIndividuals,
  setTradeMessage,
} from "../modules/pokemon/collection.js";
import { getSpecies, tradeEvolutionTarget } from "../modules/pokemon/data.js";
import { buildTradeEmbed, buildTradeRow, describeGroup } from "../modules/pokemon/embeds.js";

// Discord n'autorise pas de liste vide accompagnée d'un message : une
// proposition inerte est le seul moyen d'expliquer pourquoi il n'y a rien à
// choisir. Sa valeur ne correspond à aucune espèce, donc execute() la refuse.
const HINT_VALUE = "0:0";
const hint = (interaction, name) =>
  interaction.respond([{ name, value: HINT_VALUE }]).catch(() => {});

// Le premier exemplaire de chaque entrée reste au Pokédex : on ne peut céder
// que ce qu'on a en plus. acceptTrade tient la règle ; ce chiffre ne sert qu'à
// ne proposer et n'accepter que des échanges qui ont une chance d'aboutir.
const spareIn = (userId, group) =>
  new Promise((resolve, reject) =>
    countGroup(userId, group, (err, { spare }) => (err ? reject(err) : resolve(spare)))
  );

// Propose les doublons réellement possédés par `userId`, par espèce, sexe et
// fertilité : c'est ce qu'on échange — qui reçoit une femelle fertile doit
// pouvoir compter dessus pour pondre.
function respondWithOwned(interaction, userId, query, emptyLabel) {
  getIndividuals(userId, async (err, rows) => {
    if (err) {
      handleException("Autocomplétion d'échange :", err);
      return interaction.respond([]).catch(() => {});
    }
    const needle = query.toLowerCase();
    const choices = groupIndividuals(rows, { bySex: true, byFertility: true })
      .map((group) => {
        const species = getSpecies(group.speciesId);
        const spare = group.spare;
        if (!species || spare === 0) return null;
        // Les quatre évolutions par échange se déclarent ici plutôt que dans un
        // message d'aide que personne ne lit : c'est l'instant exact où on
        // choisit ce qu'on donne. Le filtre portant sur le libellé, taper
        // « mackogneur » remonte le Machopeur qui y mène.
        const evolved = tradeEvolutionTarget(species);
        return {
          name:
            `${describeGroup(species, group)} ×${spare}` +
            (evolved ? ` — évolue en ${evolved.name}` : ""),
          value: group.key,
        };
      })
      .filter((choice) => choice && choice.name.toLowerCase().includes(needle))
      .slice(0, 25);

    // Une liste vide est indiscernable d'une commande cassée : on dit
    // explicitement que le dresseur n'a aucun doublon à échanger.
    if (choices.length === 0 && emptyLabel) return hint(interaction, emptyLabel);
    await interaction.respond(choices).catch(() => {});
  });
}

export default {
  data: new SlashCommandBuilder()
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
        .setDescription("Le Pokémon que tu proposes")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName("je_recois")
        .setDescription("Le Pokémon que tu demandes en échange")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    // Les autres options sont déjà lisibles pendant l'autocomplétion : on peut
    // donc proposer la collection du destinataire pour « je_recois ».
    if (focused.name === "je_recois") {
      // getUser() renvoie TOUJOURS null ici : Discord n'envoie pas le bloc
      // `resolved` avec une interaction d'autocomplétion, et discord.js
      // construit donc les options sans objet utilisateur (voir
      // AutocompleteInteraction, qui passe les options brutes au resolver).
      // Seule la valeur brute de l'option — l'identifiant du membre — est
      // disponible. Avec getUser(), la liste était systématiquement vide.
      const targetId = interaction.options.get("membre")?.value;
      if (!targetId) {
        return hint(
          interaction,
          "⚠️ Choisis d'abord le dresseur dans l'option « membre »"
        );
      }
      return respondWithOwned(
        interaction,
        String(targetId),
        focused.value,
        "Ce dresseur n'a aucun doublon à échanger"
      );
    }
    return respondWithOwned(
      interaction,
      interaction.user.id,
      focused.value,
      "Tu n'as aucun doublon à échanger : ton premier exemplaire reste au Pokédex"
    );
  },

  async execute(interaction) {
    try {
      const target = interaction.options.getUser("membre");
      const offer = decodeEntry(interaction.options.getString("je_donne"));
      const request = decodeEntry(interaction.options.getString("je_recois"));

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
        handleException("Lecture des collections pour /echange :", err);
        return interaction.reply({
          content: "❌ Erreur base de données.",
          flags: MessageFlags.Ephemeral,
        });
      }
      if (offerSpare === 0) {
        return interaction.reply({
          content:
            `❌ Tu n'as pas de doublon de **${describeGroup(offered, offer)}** : ` +
            `le premier exemplaire de chaque Pokémon reste dans ton Pokédex, seuls les ` +
            `doublons s'échangent.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (requestSpare === 0) {
        return interaction.reply({
          content:
            `❌ <@${target.id}> n'a pas de doublon de ` +
            `**${describeGroup(requested, request)}** à échanger : son premier ` +
            `exemplaire reste dans son Pokédex.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply();

      createTrade(
        {
          fromUserId: interaction.user.id,
          toUserId: target.id,
          offerSpeciesId: offer.speciesId,
          offerIsShiny: offer.isShiny,
          offerSex: offer.sex,
          offerFertile: offer.fertile,
          requestSpeciesId: request.speciesId,
          requestIsShiny: request.isShiny,
          requestSex: request.sex,
          requestFertile: request.fertile,
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
            offer_fertile: offer.fertile === null ? null : offer.fertile ? 1 : 0,
            request_species_id: request.speciesId,
            request_is_shiny: request.isShiny ? 1 : 0,
            request_sex: request.sex,
            request_fertile: request.fertile === null ? null : request.fertile ? 1 : 0,
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
