import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException } from "../modules/utils.js";
import { createTrade, getCollection, setTradeMessage } from "../modules/pokemon/collection.js";
import { getSpecies } from "../modules/pokemon/data.js";
import { buildTradeEmbed, buildTradeRow } from "../modules/pokemon/embeds.js";
import { decode } from "./evolution.js";

// Discord n'autorise pas de liste vide accompagnée d'un message : une
// proposition inerte est le seul moyen d'expliquer pourquoi il n'y a rien à
// choisir. Sa valeur ne correspond à aucune espèce, donc execute() la refuse.
const HINT_VALUE = "0:0";
const hint = (interaction, name) =>
  interaction.respond([{ name, value: HINT_VALUE }]).catch(() => {});

// Propose les Pokémon réellement possédés par `userId`.
function respondWithOwned(interaction, userId, query, emptyLabel) {
  getCollection(userId, async (err, rows) => {
    if (err) {
      handleException("Autocomplétion d'échange :", err);
      return interaction.respond([]).catch(() => {});
    }
    const needle = query.toLowerCase();
    const choices = (rows || [])
      .map((row) => {
        const species = getSpecies(row.species_id);
        if (!species) return null;
        return {
          name: `${row.is_shiny ? "✨ " : ""}${species.name} (×${row.count})`,
          value: `${row.species_id}:${row.is_shiny}`,
        };
      })
      .filter((choice) => choice && choice.name.toLowerCase().includes(needle))
      .slice(0, 25);

    // Une liste vide est indiscernable d'une commande cassée : on dit
    // explicitement que le dresseur n'a rien à échanger.
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
        "Ce dresseur n'a aucun Pokémon à échanger"
      );
    }
    return respondWithOwned(
      interaction,
      interaction.user.id,
      focused.value,
      "Tu n'as aucun Pokémon à échanger"
    );
  },

  async execute(interaction) {
    try {
      const target = interaction.options.getUser("membre");
      const offer = decode(interaction.options.getString("je_donne"));
      const request = decode(interaction.options.getString("je_recois"));

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
      if (!getSpecies(offer.speciesId) || !getSpecies(request.speciesId)) {
        return interaction.reply({
          content:
            "❌ Pokémon inconnu : choisis une proposition dans la liste d'autocomplétion.",
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
          requestSpeciesId: request.speciesId,
          requestIsShiny: request.isShiny,
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
            request_species_id: request.speciesId,
            request_is_shiny: request.isShiny ? 1 : 0,
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
