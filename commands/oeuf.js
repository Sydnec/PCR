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

const ROLES = {
  male: { sex: "M", empty: "Tu n'as aucun mâle fertile qui puisse pondre" },
  femelle: { sex: "F", empty: "Tu n'as aucune femelle fertile qui puisse pondre" },
};

// Les parents possibles pour un rôle : les individus fertiles du bon sexe,
// d'une famille qui a un bébé, ou Métamorph. Groupés par espèce et variante —
// lequel pond importe peu, tant qu'il est fertile.
function respondWithParents(interaction, role, query) {
  if (!babyFamilies().length) {
    return hint(interaction, "Aucun bébé n'existe encore : les œufs arrivent avec la génération 2");
  }
  getIndividuals(interaction.user.id, async (err, rows) => {
    if (err) {
      handleException("Autocomplétion de /oeuf :", err);
      return interaction.respond([]).catch(() => {});
    }
    const needle = query.toLowerCase();
    const choices = groupIndividuals(
      rows.filter((row) => row.sex === role.sex && !row.sterile),
      { bySex: true }
    )
      .map((group) => {
        const species = getSpecies(group.speciesId);
        if (!canBreed(species)) return null;
        const baby = babyOf(species);
        return {
          name:
            `${displayName(species, group.isShiny, role.sex)} ×${group.count} — ` +
            (isDitto(species) ? "remplace n'importe quel parent" : `donne ${baby.name}`),
          value: encodeEntry(group.speciesId, group.isShiny, role.sex),
        };
      })
      .filter((choice) => choice && choice.name.toLowerCase().includes(needle))
      .slice(0, 25);
    if (!choices.length) return hint(interaction, role.empty);
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
          "Un mâle et une femelle de la même famille — Métamorph remplace l'un des deux"
        )
        .addStringOption((option) =>
          option
            .setName("male")
            .setDescription("Le père (ou un Métamorph mâle)")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((option) =>
          option
            .setName("femelle")
            .setDescription("La mère (ou un Métamorph femelle)")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) => sub.setName("voir").setDescription("Où en est ton œuf")),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const role = ROLES[focused.name];
    if (!role) return interaction.respond([]).catch(() => {});
    return respondWithParents(interaction, role, String(focused.value || ""));
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
                      "fertiles d'une famille qui a un bébé.",
                    flags: MessageFlags.Ephemeral,
                  }
            )
            .catch(() => {});
        });
      }

      // Une valeur tapée à la main contourne l'autocomplétion : layEgg revalide
      // tout — famille, fertilité, sexe du rôle —, le sexe venant du rôle et
      // jamais de la saisie.
      const father = decodeEntry(interaction.options.getString("male"));
      const mother = decodeEntry(interaction.options.getString("femelle"));
      if (!getSpecies(father.speciesId) || !getSpecies(mother.speciesId)) {
        return interaction.reply({
          content: "❌ Choisis une proposition dans la liste d'autocomplétion.",
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      layEgg(interaction.user.id, father, mother, (err, result) => {
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
