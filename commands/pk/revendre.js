import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import { getPokemonConfig } from "../../modules/pokemon/config.js";
import {
  countBySpecies,
  getIndividuals,
  resolveIndividual,
} from "../../modules/pokemon/collection.js";
import { getSpecies } from "../../modules/pokemon/data.js";
import { getInventory, getItem, itemSellValue } from "../../modules/pokemon/items.js";
import { pokemonSellValue, sellItem, sellPokemon } from "../../modules/pokemon/sell.js";
import {
  HINT_VALUE,
  displayName,
  individualChoices,
  respondHint,
} from "../../modules/pokemon/embeds.js";

// Revendre ce qu'on a en trop. Deux sous-commandes parce que ce sont deux
// marchandises, mais un seul verbe : le dresseur n'a pas à savoir que les
// Pokémon et les objets vivent dans deux tables.

const points = (value) => value.toLocaleString("fr-FR");

// Un individu qui se revend : son espèce et sa variante ont un prix.
const sellable = (row) => pokemonSellValue(getSpecies(row.species_id), row.is_shiny) > 0;

// Les espèces dont on a des Pokémon à revendre : tout sauf un individu de
// chaque espèce, shiny ou non, puisque le dernier ne se vend jamais. `spare`
// compte ce que vend la commande sans individu — des normaux seulement — et
// `shinies` les shiny revendables, qui se choisissent un par un.
function listSellableSpecies(userId, cb) {
  getIndividuals(userId, (err, rows) => {
    if (err) return cb(err, []);
    const list = [];
    for (const [speciesId, { total, normal, shiny }] of countBySpecies(rows)) {
      const species = getSpecies(speciesId);
      if (!species || total < 2) continue;
      const unit = pokemonSellValue(species, false);
      const shinyUnit = pokemonSellValue(species, true);
      const spare = unit > 0 ? Math.min(normal, total - 1) : 0;
      const shinies = shinyUnit > 0 ? shiny : 0;
      if (spare > 0 || shinies > 0) list.push({ species, spare, unit, shinies, shinyUnit });
    }
    // Les plus chers d'abord : c'est ce qu'on cherche en ouvrant la liste.
    list.sort((a, b) => b.unit * b.spare - a.unit * a.spare);
    cb(null, list);
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
  group: true,
  describe: (group) =>
    group
      .setName("revendre")
      .setDescription("Revend ce que tu as en trop contre des points")
      .addSubcommand((sub) =>
        sub
          .setName("pokemon")
          .setDescription("Revend des Pokémon — un de chaque espèce est toujours conservé")
          .addStringOption((option) =>
            option
              .setName("espece")
              .setDescription("L'espèce à revendre")
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addStringOption((option) =>
            option
              .setName("individu")
              .setDescription("Un Pokémon précis — sans lui, les normaux les moins précieux partent")
              .setRequired(false)
              .setAutocomplete(true)
          )
          .addIntegerOption((option) =>
            option
              .setName("quantite")
              .setDescription("Combien en revendre, sans individu précis (1 par défaut)")
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

    // Second temps : un individu de l'espèce choisie, pourvu qu'il se revende
    // et ne soit pas le dernier de son espèce.
    if (interaction.options.getFocused(true).name === "individu") {
      const species = getSpecies(Number(interaction.options.get("espece")?.value));
      if (!species) {
        return respondHint(interaction, "⚠️ Choisis d'abord l'espèce dans l'option « espece »");
      }
      return getIndividuals(interaction.user.id, (err, rows) => {
        if (err) {
          handleException("Autocomplétion de revente :", err);
          return interaction.respond([]).catch(() => {});
        }
        respond(
          interaction,
          individualChoices(
            rows.filter((row) => row.species_id === species.id),
            query,
            (row) => !row.last && sellable(row)
          )
        );
      });
    }

    listSellableSpecies(interaction.user.id, (err, rows) => {
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
              row.spare > 0
                ? `${row.species.name} — ${row.spare} en trop, ${points(row.unit)} pts pièce` +
                  (row.shinies ? ", ✨ au choix" : "")
                : `${row.species.name} — ✨ au choix, ${points(row.shinyUnit)} pts pièce`,
            value: String(row.species.id),
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
      const raw = interaction.options.getString(isItem ? "objet" : "espece");
      const individual = isItem ? null : interaction.options.getString("individu");

      if (raw === HINT_VALUE || individual === HINT_VALUE) {
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

      // Sans individu précis, les normaux de l'espèce, les moins précieux
      // d'abord : un shiny se choisit, il ne part jamais dans le lot.
      if (!individual) {
        const species = getSpecies(Number(raw));
        if (!species) {
          return interaction
            .editReply({ content: "❌ Choisis une proposition dans la liste d'autocomplétion." })
            .catch(() => {});
        }
        return sellPokemon(interaction.user.id, { speciesId: species.id, isShiny: false }, quantity, done);
      }
      resolveIndividual(interaction.user.id, raw, individual, (err, selector) => {
        if (err) return done(err);
        if (selector.error) return done(null, { ok: false, reason: selector.error });
        sellPokemon(interaction.user.id, selector, quantity, done);
      });
    } catch (error) {
      handleException(error);
    }
  },
};
