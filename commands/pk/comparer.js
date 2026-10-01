import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import {
  countBySpecies,
  getIndividuals,
  getSpeciesNeeders,
  getTradeMatches,
  getTradePartners,
  listDuplicates,
} from "../../modules/pokemon/collection.js";
import { getAvailableSpecies, getSpecies, searchByName } from "../../modules/pokemon/data.js";
import {
  buildCompareView,
  buildNeedersEmbed,
  buildNeedersRow,
  buildPartnersEmbed,
  buildPartnersRow,
  respondHint as hint,
} from "../../modules/pokemon/embeds.js";

const fr = (value) => value.toLocaleString("fr-FR");

// Les échanges qui servent aux deux : une espèce contre une espèce, chacune
// absente du Pokédex de celui qui la reçoit. Trois questions, selon l'option :
// ce que deux dresseurs peuvent s'échanger (membre), avec qui échanger
// (rien), à qui manque ce qu'on peut donner (pokemon). La première propose
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
          .setDescription("Un de tes doublons : les dresseurs à qui il manque")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addBooleanOption((option) =>
        option
          .setName("evolutions")
          .setDescription("Mettre de côté ce qu'il faut pour les évolutions qui manquent (oui par défaut)")
          .setRequired(false)
      ),

  // Ce qu'on peut donner, avec la réserve d'évolution demandée : une espèce
  // qu'on ne proposerait pas ne sert à rien d'autocompléter. Le choix de l'option
  // `evolutions` se lit tel que Discord l'envoie, valeur brute.
  async autocomplete(interaction) {
    const reserve = interaction.options.get("evolutions")?.value ?? true;
    getIndividuals(interaction.user.id, (err, rows) => {
      if (err) {
        handleException("Autocomplétion de /pk comparer :", err);
        return interaction.respond([]).catch(() => {});
      }
      const duplicates = listDuplicates(rows, { reserve });
      // Le « contient » de la recherche par nom, accents et casse compris : une
      // seule définition, celle de toutes les autres autocomplétions d'espèces.
      const query = String(interaction.options.getFocused() ?? "");
      const matching = new Set(searchByName(query, Infinity).map((species) => species.id));
      const choices = duplicates
        .filter((entry) => matching.has(entry.speciesId))
        .map((entry) => {
          const species = getSpecies(entry.speciesId);
          return species && { name: `${species.name} ×${fr(entry.spare)} en trop`, value: String(species.id) };
        })
        .filter(Boolean)
        .slice(0, 25);
      if (choices.length) return interaction.respond(choices).catch(() => {});
      // Une liste vide est indiscernable d'une commande cassée : on dit pourquoi, et
      // on ne prétend pas qu'il n'y a aucun doublon quand c'est la saisie qui ne
      // retient rien.
      hint(
        interaction,
        duplicates.length
          ? `Aucun de tes doublons ne correspond à « ${query} »`.slice(0, 100)
          : reserve
            ? "Aucun doublon à offrir : ils servent peut-être à tes évolutions"
            : "Tu n'as aucun doublon à offrir"
      );
    });
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
          if (!found.offer) return explainNoOffer(interaction, species, reserve);
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

// L'espèce choisie ne peut pas être proposée : le refus dit pourquoi, avec les
// chiffres, plutôt que de répondre par une liste vide qu'on prendrait pour « tout
// le monde l'a déjà ».
function explainNoOffer(interaction, species, reserve) {
  getIndividuals(interaction.user.id, (err, rows) => {
    if (err) {
      handleException("Lecture des doublons d'une espèce :", err);
      return interaction
        .editReply({ content: "❌ Impossible de lire tes doublons." })
        .catch(() => {});
    }
    const counts = countBySpecies(rows).get(species.id);
    const inDuplicates = (options) =>
      listDuplicates(rows, options).some((entry) => entry.speciesId === species.id);
    let content;
    if (!counts) {
      content = `❌ Tu n'as pas de **${species.name}** à donner.`;
    } else if (counts.total === 1) {
      content =
        `❌ Tu n'as qu'un **${species.name}** : il t'en faut au moins 2 pour en donner un, ` +
        "il reste toujours un Pokémon de chaque espèce.";
    } else if (counts.free === 0) {
      content =
        `❌ Tes **${fr(counts.total)}** ${species.name} sont verrouillés 🛡️ : déverrouille-en un avec ` +
        "/pk verrou pour le proposer.";
    } else if (reserve && inDuplicates({ reserve: false })) {
      content =
        `❌ Tes **${fr(counts.spare)}** ${species.name} en trop sont mis de côté 🧬 pour les évolutions ` +
        "qui manquent à ton Pokédex : ajoute `evolutions: False` pour les proposer quand même.";
    } else {
      content = `❌ **${species.name}** ne peut pas être proposé pour l'instant.`;
    }
    interaction.editReply({ content }).catch(() => {});
  });
}
