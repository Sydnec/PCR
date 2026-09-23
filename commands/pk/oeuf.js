import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import { getPokemonConfig } from "../../modules/pokemon/config.js";
import {
  decodeEntry,
  encodeEntry,
  getIndividuals,
  groupIndividuals,
  resolveSelector,
} from "../../modules/pokemon/collection.js";
import { getSpecies, isDitto } from "../../modules/pokemon/data.js";
import {
  displayName,
  individualChoices,
  wantsIndividual,
} from "../../modules/pokemon/embeds.js";
import {
  babyFamilies,
  babyOf,
  buildEggEmbed,
  canBreed,
  describeEgg,
  getIncubatingEgg,
  layEgg,
} from "../../modules/pokemon/eggs.js";

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
  getIndividuals(interaction.user.id, async (err, rows) => {
    if (err) {
      handleException("Autocomplétion de /pk oeuf :", err);
      return interaction.respond([]).catch(() => {});
    }
    // L'autre parent peut être un groupe ou un individu (#123) : dans les deux
    // cas, seuls comptent son espèce et son sexe.
    const partnerEntry = partnerValue ? decodeEntry(partnerValue) : null;
    const partnerRow = partnerEntry?.pokemonId
      ? rows.find((row) => row.id === partnerEntry.pokemonId)
      : null;
    const partner = partnerRow
      ? { speciesId: partnerRow.species_id, sex: partnerRow.sex }
      : partnerEntry;
    const partnerSpecies = partner ? getSpecies(partner.speciesId) : null;
    const compatible = (species, sex) =>
      !partnerSpecies ||
      !describeEgg({ species: partnerSpecies, sex: partner.sex }, { species, sex }).error;

    // « #123 » : un individu précis, fertile et compatible.
    if (wantsIndividual(query)) {
      const individuals = individualChoices(rows, query, (row) => {
        const species = getSpecies(row.species_id);
        return !row.sterile && canBreed(species) && compatible(species, row.sex);
      });
      if (!individuals.length) return hint(interaction, "Aucun Pokémon fertile avec ce numéro");
      return interaction.respond(individuals).catch(() => {});
    }

    const needle = query.toLowerCase();
    const choices = groupIndividuals(
      rows.filter((row) => !row.sterile),
      { bySex: true }
    )
      .map((group) => {
        const species = getSpecies(group.speciesId);
        if (!canBreed(species) || !compatible(species, group.sex)) return null;
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
  group: true,
  describe: (group) =>
    group
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
              .setDescription("Un parent de la famille, ou un Métamorph (ou #numéro)")
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addStringOption((option) =>
            option
              .setName("parent2")
              .setDescription("Son partenaire : l'autre sexe de la famille, un Métamorph (ou #numéro)")
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
                      "Tu ne couves aucun œuf. `/pk oeuf pondre` avec un mâle et une femelle " +
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
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const resolve = (raw) =>
        new Promise((ok, fail) =>
          resolveSelector(interaction.user.id, raw, (err, selector) =>
            err ? fail(err) : ok(selector)
          )
        );
      let first, second;
      try {
        [first, second] = await Promise.all([
          resolve(interaction.options.getString("parent1")),
          resolve(interaction.options.getString("parent2")),
        ]);
      } catch (err) {
        handleException("Lecture des parents pour /pk oeuf :", err);
        return interaction.editReply({ content: "❌ Erreur base de données." }).catch(() => {});
      }
      const refus =
        first.error ??
        second.error ??
        (!getSpecies(first.speciesId) || !getSpecies(second.speciesId)
          ? "Choisis une proposition dans la liste d'autocomplétion."
          : null);
      if (refus) return interaction.editReply({ content: `❌ ${refus}` }).catch(() => {});

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
