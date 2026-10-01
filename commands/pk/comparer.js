import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import {
  getSpeciesNeeders,
  getTradeMatches,
  getTradePartners,
} from "../../modules/pokemon/collection.js";
import { getAvailableSpecies, searchByName } from "../../modules/pokemon/data.js";
import {
  buildCompareView,
  buildNeedersEmbed,
  buildNeedersRow,
  buildPartnersEmbed,
  buildPartnersRow,
  dexNumber,
  respondHint as hint,
} from "../../modules/pokemon/embeds.js";

// Les échanges qui servent aux deux : une espèce contre une espèce, chacune
// absente du Pokédex de celui qui la reçoit. Trois questions, selon l'option :
// ce que deux dresseurs peuvent s'échanger (membre), avec qui échanger
// (rien), à qui manque une espèce, possédée ou non (pokemon). La première propose
// l'échange d'un bouton, par le même chemin que /pk echange. Réponse privée,
// comme les doublons : elle ne concerne que celui qui la consulte.
export default {
  describe: (sub) =>
    sub
      .setName("comparer")
      .setDescription("Les échanges qui complètent le Pokédex des deux dresseurs")
      .addUserOption((option) =>
        option
          .setName("membre")
          .setDescription("Le dresseur dont tu veux comparer les doublons et le Pokédex avec les tiens")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("pokemon")
          .setDescription("Une espèce : les dresseurs à qui elle manque")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addBooleanOption((option) =>
        option
          .setName("evolutions")
          .setDescription("Mettre de côté ce qu'il faut pour les évolutions qui manquent (oui par défaut)")
          .setRequired(false)
      ),

  // L'option `pokemon` s'autocomplète sur toutes les espèces ouvertes, comme
  // /pk doublons : on cherche à qui manque n'importe quel Pokémon, qu'on le possède
  // ou non. Une seule définition du « contient », celle de la recherche par nom.
  async autocomplete(interaction) {
    const matches = searchByName(interaction.options.getFocused(), 25);
    if (!matches.length) return hint(interaction, "Aucune espèce ne correspond");
    await interaction
      .respond(matches.map((species) => ({ name: `${dexNumber(species)} ${species.name}`, value: String(species.id) })))
      .catch(() => {});
  },

  async execute(interaction) {
    try {
      const member = interaction.options.getUser("membre");
      const raw = interaction.options.getString("pokemon");
      // Facultatif, et actif par défaut : proposer à quelqu'un ce qu'il garde pour
      // évoluer n'est pas un échange qui lui sert.
      const reserve = interaction.options.getBoolean("evolutions") ?? true;
      const refuse = (content) =>
        interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});

      if (member && raw) {
        return refuse(
          "❌ Choisis un dresseur **ou** une espèce, pas les deux : `membre` compare vos " +
            "collections, `pokemon` cherche qui a besoin d'un de tes doublons."
        );
      }
      if (member?.id === interaction.user.id) {
        return refuse("❌ Tu ne peux pas te comparer à toi-même.");
      }
      if (member?.bot) return refuse("❌ Les bots ne collectionnent pas les Pokémon.");
      // Tapée à la main, l'espèce peut viser une génération encore fermée.
      const species = raw ? getAvailableSpecies(raw) : null;
      if (raw && !species) {
        return refuse("❌ Choisis une espèce dans la liste d'autocomplétion.");
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const fail = (what, err) => {
        handleException(what, err);
        return interaction
          .editReply({ content: "❌ Impossible de lire les collections." })
          .catch(() => {});
      };

      if (member) {
        return getTradeMatches(interaction.user.id, member.id, { reserve }, (err, match) => {
          if (err) return fail("Comparaison de deux collections :", err);
          interaction.editReply(buildCompareView(match, { partner: member, reserve })).catch(() => {});
        });
      }

      if (species) {
        return getSpeciesNeeders(interaction.user.id, species.id, { reserve }, (err, found) => {
          if (err) return fail("Lecture de ceux qui ont besoin d'une espèce :", err);
          interaction
            .editReply({
              embeds: [buildNeedersEmbed(species, found.offer, found.list, { reserve })],
              components: [buildNeedersRow(species.id, found.list.length, 0, { reserve })],
            })
            .catch(() => {});
        });
      }

      getTradePartners(interaction.user.id, { reserve }, (err, list, summary) => {
        if (err) return fail("Lecture des partenaires d'échange :", err);
        interaction
          .editReply({
            embeds: [buildPartnersEmbed(list, { reserve, offers: summary.offers })],
            components: [buildPartnersRow(list.length, 0, { reserve })],
          })
          .catch(() => {});
      });
    } catch (error) {
      handleException(error);
    }
  },
};
