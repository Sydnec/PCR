import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException } from "../modules/utils.js";
import { getPokemonConfig } from "../modules/pokemon/config.js";
import {
  decodeEntry,
  getIndividuals,
  groupIndividuals,
} from "../modules/pokemon/collection.js";
import { getSpecies } from "../modules/pokemon/data.js";
import { getInventory, getItem, itemSellValue } from "../modules/pokemon/items.js";
import { pokemonSellValue, sellItem, sellPokemon } from "../modules/pokemon/sell.js";
import { displayName } from "../modules/pokemon/embeds.js";

// Revendre ce qu'on a en trop. Deux sous-commandes parce que ce sont deux
// marchandises, mais un seul verbe : le dresseur n'a pas à savoir que les
// Pokémon et les objets vivent dans deux tables.
//
// Discord n'autorise pas de liste d'autocomplétion vide accompagnée d'un
// message : une proposition inerte est le seul moyen d'expliquer pourquoi il n'y
// a rien à vendre. Sa valeur ne correspond à rien, donc execute() la refuse.
const HINT_VALUE = "—";

const points = (value) => value.toLocaleString("fr-FR");

// Les doublons revendables, par espèce et par sexe : tout sauf l'individu
// qu'on garde de chaque entrée, puisque celui-là ne se vend jamais.
function listSellablePokemon(userId, cb) {
  getIndividuals(userId, (err, rows) => {
    if (err) return cb(err, []);
    const sellable = [];
    for (const group of groupIndividuals(rows, { bySex: true })) {
      const species = getSpecies(group.speciesId);
      if (!species || group.spare < 1) continue;
      const unit = pokemonSellValue(species, group.isShiny);
      if (unit > 0) sellable.push({ ...group, species, unit });
    }
    // Les plus chers d'abord : c'est ce qu'on cherche en ouvrant la liste.
    sellable.sort((a, b) => b.unit * b.spare - a.unit * a.spare);
    cb(null, sellable);
  });
}

function listSellableItems(userId, cb) {
  getInventory(userId, (err, rows) => {
    if (err) return cb(err, []);
    const sellable = [];
    for (const row of rows || []) {
      const item = getItem(row.item_key);
      const unit = itemSellValue(item);
      if (item && unit > 0) sellable.push({ ...row, item, unit });
    }
    cb(null, sellable);
  });
}

const respond = (interaction, choices) =>
  interaction
    .respond(
      choices.length
        ? choices.slice(0, 25)
        : [{ name: "Tu n'as rien à revendre pour le moment", value: HINT_VALUE }]
    )
    .catch(() => {});

export default {
  data: new SlashCommandBuilder()
    .setName("revendre")
    .setDescription("Revend ce que tu as en trop contre des points")
    .addSubcommand((sub) =>
      sub
        .setName("pokemon")
        .setDescription("Revend des doublons — un exemplaire est toujours conservé")
        .addStringOption((option) =>
          option
            .setName("pokemon")
            .setDescription("Le doublon à revendre")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("quantite")
            .setDescription("Combien en revendre (1 par défaut)")
            .setRequired(false)
            .setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("objet")
        .setDescription("Revend un objet de ton inventaire")
        .addStringOption((option) =>
          option
            .setName("objet")
            .setDescription("L'objet à revendre")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("quantite")
            .setDescription("Combien en revendre (1 par défaut)")
            .setRequired(false)
            .setMinValue(1)
        )
    ),

  async autocomplete(interaction) {
    const query = String(interaction.options.getFocused() || "").toLowerCase();

    if (interaction.options.getSubcommand() === "objet") {
      return listSellableItems(interaction.user.id, (err, rows) => {
        if (err) {
          handleException("Autocomplétion de revente d'objet :", err);
          return interaction.respond([]).catch(() => {});
        }
        respond(
          interaction,
          rows
            .map((row) => ({
              name: `${row.item.label} ×${row.count} — ${points(row.unit)} pts pièce`,
              value: row.item_key,
            }))
            .filter((choice) => choice.name.toLowerCase().includes(query))
        );
      });
    }

    listSellablePokemon(interaction.user.id, (err, rows) => {
      if (err) {
        handleException("Autocomplétion de revente :", err);
        return interaction.respond([]).catch(() => {});
      }
      respond(
        interaction,
        rows
          .map((row) => ({
            // Le nombre de doublons ET le prix unitaire : ce sont les deux
            // chiffres dont on a besoin pour choisir la quantité juste après.
            name:
              `${displayName(row.species, row.isShiny, row.sex)} — ` +
              `${row.spare} en trop, ${points(row.unit)} pts pièce`,
            value: row.key,
          }))
          .filter((choice) => choice.name.toLowerCase().includes(query))
      );
    });
  },

  async execute(interaction) {
    try {
      if (!getPokemonConfig().enabled) {
        return interaction.reply({
          content: "❌ Le système Pokémon est désactivé.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const quantity = interaction.options.getInteger("quantite") ?? 1;
      const isItem = interaction.options.getSubcommand() === "objet";
      const raw = interaction.options.getString(isItem ? "objet" : "pokemon");

      if (raw === HINT_VALUE) {
        return interaction.reply({
          content: "❌ Choisis une proposition dans la liste d'autocomplétion.",
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const done = (err, result) => {
        if (err) {
          handleException("Revente :", err);
          return interaction
            .editReply({ content: "❌ Erreur base de données, rien n'a été vendu." })
            .catch(() => {});
        }
        if (!result.ok) {
          return interaction.editReply({ content: `❌ ${result.reason}` }).catch(() => {});
        }

        // Le gras est posé UNE fois, autour de la quantité et du nom ensemble :
        // imbriquer deux paires de ** referme la première et laisse les
        // astérisques en clair dans le message.
        const what = isItem
          ? `${result.item.emoji} **${result.quantity}× ${result.item.label}**`
          : `**${result.quantity}× ${displayName(result.species, result.isShiny, result.sex)}**`;
        interaction
          .editReply({
            content: `✅ Tu revends ${what} pour **${points(result.points)}** points.`,
          })
          .catch(() => {});
      };

      if (isItem) return sellItem(interaction.user.id, raw, quantity, done);

      const { speciesId, isShiny, sex } = decodeEntry(raw);
      if (!getSpecies(speciesId)) {
        return interaction
          .editReply({ content: "❌ Choisis une proposition dans la liste d'autocomplétion." })
          .catch(() => {});
      }
      sellPokemon(interaction.user.id, { speciesId, isShiny, sex }, quantity, done);
    } catch (error) {
      handleException(error);
    }
  },
};
