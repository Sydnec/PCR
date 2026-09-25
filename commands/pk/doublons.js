import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import {
  getIndividuals,
  getSpeciesDuplicates,
  listDuplicates,
} from "../../modules/pokemon/collection.js";
import { getAvailableSpecies, searchByName } from "../../modules/pokemon/data.js";
import {
  buildDuplicatesEmbed,
  buildDuplicatesRow,
  buildSpeciesDuplicatesEmbed,
  buildSpeciesDuplicatesRow,
  dexNumber,
  respondHint as hint,
} from "../../modules/pokemon/embeds.js";

// Les doublons, dans les deux sens : ce qu'un dresseur a en plusieurs
// exemplaires, ou, avec une espèce, qui l'a en double. Les deux questions
// qu'on se pose avant de proposer un échange, sans parcourir les boîtes
// individu par individu.
export default {
  describe: (sub) =>
    sub
      .setName("doublons")
      .setDescription("Les doublons d'un dresseur, ou qui a une espèce en double")
      .addUserOption((option) =>
        option
          .setName("membre")
          .setDescription("Le dresseur dont tu veux voir les doublons")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("pokemon")
          .setDescription("Une espèce : qui l'a en double")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addBooleanOption((option) =>
        option
          .setName("evolutions")
          .setDescription("Mettre de côté de quoi faire les évolutions qui manquent au Pokédex du dresseur")
          .setRequired(false)
      ),

  async autocomplete(interaction) {
    const matches = searchByName(interaction.options.getFocused(), 25);
    if (!matches.length) return hint(interaction, "Aucune espèce ne correspond");
    await interaction
      .respond(
        matches.map((species) => ({
          name: `${dexNumber(species)} ${species.name}`,
          value: String(species.id),
        }))
      )
      .catch(() => {});
  },

  async execute(interaction) {
    try {
      const member = interaction.options.getUser("membre");
      // Facultatif, et désactivé par défaut : la liste brute convient à qui
      // n'attend pas d'évoluer.
      const reserve = interaction.options.getBoolean("evolutions") ?? false;
      const user = member ?? interaction.user;
      const raw = interaction.options.getString("pokemon");
      // Tapée à la main, l'espèce peut viser une génération encore fermée.
      const species = raw ? getAvailableSpecies(raw) : null;
      if (raw && !species) {
        return interaction
          .reply({
            content: "❌ Choisis une espèce dans la liste d'autocomplétion.",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      }
      // Réponse privée, comme la boîte : elle ne concerne que celui qui la
      // consulte, et personne d'autre ne tourne ses pages.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Avec une espèce : qui l'a en double, ou seulement `membre` s'il est
      // précisé — sa boîte suffit alors, et sa liste tient en une ligne.
      if (species) {
        // Toute la boîte, et pas la seule espèce : la réserve dépend des
        // évolutions déjà possédées.
        const read = member
          ? (cb) =>
              getIndividuals(member.id, (err, rows) =>
                cb(
                  err,
                  listDuplicates(rows, { reserve })
                    .filter((entry) => entry.speciesId === species.id)
                    .map((entry) => ({ userId: member.id, ...entry }))
                )
              )
          : (cb) => getSpeciesDuplicates(species.id, { reserve }, cb);
        return read((err, list) => {
          if (err) {
            handleException("Lecture des doublons d'une espèce :", err);
            return interaction
              .editReply({ content: "❌ Impossible de lire les doublons." })
              .catch(() => {});
          }
          interaction
            .editReply({
              embeds: [buildSpeciesDuplicatesEmbed(species, list, { member, reserve })],
              components: [buildSpeciesDuplicatesRow(species.id, 0, list.length, { reserve })],
            })
            .catch(() => {});
        });
      }

      getIndividuals(user.id, (err, rows) => {
        if (err) {
          handleException("Lecture des doublons :", err);
          return interaction
            .editReply({ content: "❌ Impossible de lire les doublons." })
            .catch(() => {});
        }
        const list = listDuplicates(rows, { reserve });
        interaction
          .editReply({
            embeds: [buildDuplicatesEmbed(list, { user, page: 0, reserve })],
            components: [buildDuplicatesRow(user.id, 0, list.length, { reserve })],
          })
          .catch(() => {});
      });
    } catch (error) {
      handleException(error);
    }
  },
};
