import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException } from "../modules/utils.js";
import { getPokemonConfig } from "../modules/pokemon/config.js";
import {
  decodeEntry,
  encodeEntry,
  getIndividuals,
  groupIndividuals,
} from "../modules/pokemon/collection.js";
import { getSpecies } from "../modules/pokemon/data.js";
import { displayName } from "../modules/pokemon/embeds.js";
import {
  babyFamilies,
  babyOf,
  buildEggEmbed,
  canBreed,
  describeEgg,
  getIncubatingEgg,
  isDitto,
  layEgg,
} from "../modules/pokemon/eggs.js";

// Discord n'autorise pas de liste vide accompagnée d'un message : une
// proposition inerte est le seul moyen d'expliquer pourquoi il n'y a rien à
// choisir. Sa valeur ne correspond à aucune espèce, donc execute() la refuse.
const HINT_VALUE = "0:0";
const hint = (interaction, name) =>
  interaction.respond([{ name, value: HINT_VALUE }]).catch(() => {});

// Les parents possibles : les individus fertiles d'une famille qui a un bébé,
// de n'importe quel sexe, et Métamorph. Groupés par espèce, variante et sexe —
// lequel pond importe peu, tant qu'il est fertile. Quand l'autre parent est
// déjà choisi, seuls ses partenaires possibles restent : un Pikachu ♂ ne se voit
// proposer que des femelles de sa famille et des Métamorph.
function respondWithParents(interaction, query, partnerValue) {
  if (!babyFamilies().length) {
    return hint(interaction, "Aucun bébé n'existe encore : les œufs arrivent avec la génération 2");
  }
  const partner = partnerValue ? decodeEntry(partnerValue) : null;
  const partnerSpecies = partner ? getSpecies(partner.speciesId) : null;

  getIndividuals(interaction.user.id, async (err, rows) => {
    if (err) {
      handleException("Autocomplétion de /oeuf :", err);
      return interaction.respond([]).catch(() => {});
    }
    const needle = query.toLowerCase();
    const choices = groupIndividuals(
      rows.filter((row) => !row.sterile),
      { bySex: true }
    )
      .map((group) => {
        const species = getSpecies(group.speciesId);
        if (!canBreed(species)) return null;
        if (
          partnerSpecies &&
          describeEgg(
            { species: partnerSpecies, sex: partner.sex },
            { species, sex: group.sex }
          ).error
        ) {
          return null;
        }
        return {
          name:
            `${displayName(species, group.isShiny, group.sex)} ×${group.count} — ` +
            (isDitto(species) ? "remplace n'importe quel parent" : `donne ${babyOf(species).name}`),
          value: encodeEntry(group.speciesId, group.isShiny, group.sex),
        };
      })
      .filter((choice) => choice && choice.name.toLowerCase().includes(needle))
      .slice(0, 25);
    if (!choices.length) {
      return hint(
        interaction,
        partnerSpecies
          ? "Aucun partenaire fertile pour ce parent"
          : "Tu n'as aucun Pokémon fertile qui puisse pondre"
      );
    }
    await interaction.respond(choices).catch(() => {});
  });
}

export default {
  data: new SlashCommandBuilder()
    .setName("oeuf")
    .setDescription("Fait pondre un couple de Pokémon pour obtenir un bébé")
    .addSubcommand((sub) =>
      sub
        .setName("pondre")
        .setDescription(
          "Un mâle et une femelle d'une famille à bébé — Métamorph remplace l'un des deux"
        )
        .addStringOption((option) =>
          option
            .setName("parent1")
            .setDescription("Un parent de la famille, ou un Métamorph")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName("parent2")
            .setDescription("Son partenaire : l'autre sexe de la même famille, ou un Métamorph")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) => sub.setName("voir").setDescription("Où en est ton œuf")),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const other = focused.name === "parent1" ? "parent2" : "parent1";
    return respondWithParents(
      interaction,
      String(focused.value || ""),
      interaction.options.getString(other) || null
    );
  },

  async execute(interaction) {
    try {
      if (!getPokemonConfig().enabled) {
        return interaction.reply({
          content: "❌ Le système Pokémon est désactivé.",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (interaction.options.getSubcommand() === "voir") {
        return getIncubatingEgg(interaction.user.id, (err, egg) => {
          if (err) {
            handleException("Lecture de l'œuf :", err);
            return interaction
              .reply({ content: "❌ Erreur base de données.", flags: MessageFlags.Ephemeral })
              .catch(() => {});
          }
          interaction
            .reply(
              egg
                ? { embeds: [buildEggEmbed(egg)], flags: MessageFlags.Ephemeral }
                : {
                    content:
                      "Tu ne couves aucun œuf. `/oeuf pondre` avec un mâle et une femelle " +
                      "fertiles d'une famille qui a un bébé, ou l'un des deux et un Métamorph.",
                    flags: MessageFlags.Ephemeral,
                  }
            )
            .catch(() => {});
        });
      }

      // Une valeur tapée à la main contourne l'autocomplétion : layEgg revalide
      // tout — famille, sexes, fertilité —, et c'est la base qui dit si un
      // individu du groupe demandé existe vraiment.
      const first = decodeEntry(interaction.options.getString("parent1"));
      const second = decodeEntry(interaction.options.getString("parent2"));
      if (!getSpecies(first.speciesId) || !getSpecies(second.speciesId)) {
        return interaction.reply({
          content: "❌ Choisis une proposition dans la liste d'autocomplétion.",
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      layEgg(interaction.user.id, first, second, (err, result) => {
        if (err) {
          handleException("Ponte d'un œuf :", err);
          return interaction
            .editReply({ content: "❌ Erreur base de données, aucun œuf n'a été pondu." })
            .catch(() => {});
        }
        if (!result.ok) {
          return interaction.editReply({ content: `❌ ${result.reason}` }).catch(() => {});
        }
        interaction
          .editReply({
            content: "🥚 Un œuf ! Les deux parents ne pourront plus pondre.",
            embeds: [buildEggEmbed(result.egg)],
          })
          .catch(() => {});
      });
    } catch (error) {
      handleException(error);
    }
  },
};
