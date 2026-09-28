import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import { getPokemonConfig } from "../../modules/pokemon/config.js";
import {
  countBySpecies,
  getIndividuals,
  parseIndividual,
  resolveIndividual,
} from "../../modules/pokemon/collection.js";
import { getSpecies } from "../../modules/pokemon/data.js";
import {
  buildShowcaseMessage,
  displayName,
  individualChoices,
  ownedSpeciesChoices,
  respondHint as hint,
} from "../../modules/pokemon/embeds.js";
import {
  addToShowcase,
  getShowcase,
  moveInShowcase,
  removeFromShowcase,
  showcaseSlots,
} from "../../modules/pokemon/showcase.js";
import { renderShowcaseImage } from "../../modules/pokemon/showcase-image.js";

// La vitrine : jusqu'à six Pokémon qu'un dresseur expose aux autres, pour
// frimer. Du décor, qui ne change rien au jeu (pokemon/showcase.js). Sa propre
// vitrine porte un bouton qui la montre dans le salon.
const nameOf = (row) => {
  const species = getSpecies(row.species_id);
  return `#${row.id} ${species ? displayName(species, row.is_shiny, row.sex, row.form) : "?"}`;
};

// « de Sacha », « d'Ondine ».
const ofName = (name) => (/^[aeiouyàâäéèêëîïôöûüù]/i.test(name) ? `d'${name}` : `de ${name}`);

const ephemeral = (interaction, payload) =>
  interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});

// Répond avec la vitrine d'un dresseur, telle que /pk vitrine voir la montre.
// `intro` précède la vitrine, pour dire ce qui vient de changer. Dessiner son
// image demande de télécharger les illustrations : la réponse est différée
// d'abord, Discord ne laissant que trois secondes pour répondre.
async function replyShowcase(interaction, rows, { mine, name, intro = null }) {
  const slots = showcaseSlots();
  if (!rows.length) {
    return ephemeral(interaction, {
      content:
        (intro ? `${intro}\n` : "") +
        (mine
          ? `🏆 Ta vitrine est vide : expose jusqu'à ${slots} Pokémon avec \`/pk vitrine ajouter\`.`
          : `🏆 **${name}** n'expose encore aucun Pokémon.`),
    });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
  const image = await renderShowcaseImage(rows);
  await interaction
    .editReply(
      buildShowcaseMessage(rows, {
        title: mine ? `Ta vitrine · ${rows.length}/${slots}` : `Vitrine ${ofName(name)}`,
        intro,
        shareable: mine,
        image,
      })
    )
    .catch(() => {});
}

export default {
  group: true,
  describe: (group) =>
    group
      .setName("vitrine")
      .setDescription("Expose tes plus beaux Pokémon aux autres dresseurs")
      .addSubcommand((sub) =>
        sub
          .setName("voir")
          .setDescription("Ta vitrine, ou celle d'un autre dresseur")
          .addUserOption((option) =>
            option.setName("membre").setDescription("La vitrine d'un autre dresseur")
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("ajouter")
          .setDescription("Expose un de tes Pokémon dans ta vitrine, ou change sa place")
          .addStringOption((option) =>
            option
              .setName("espece")
              .setDescription("L'espèce du Pokémon")
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addStringOption((option) =>
            option
              .setName("individu")
              .setDescription("Le Pokémon précis à exposer")
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addIntegerOption((option) =>
            option
              .setName("place")
              .setDescription("Sa place dans la vitrine (1 = la première) ; au bout sans elle")
              .setMinValue(1)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName("retirer")
          .setDescription("Retire un Pokémon de ta vitrine")
          .addStringOption((option) =>
            option
              .setName("pokemon")
              .setDescription("Le Pokémon exposé à retirer")
              .setRequired(true)
              .setAutocomplete(true)
          )
      ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const query = String(focused.value ?? "");

    if (focused.name === "pokemon") {
      return getShowcase(interaction.user.id, (err, rows) => {
        if (err) {
          handleException("Autocomplétion de /pk vitrine :", err);
          return interaction.respond([]).catch(() => {});
        }
        if (!rows.length) return hint(interaction, "Ta vitrine est vide");
        const digits = query.replace(/\D/g, "");
        const choices = rows
          .filter((row) => String(row.id).startsWith(digits))
          .map((row) => ({ name: nameOf(row), value: `#${row.id}` }));
        if (!choices.length) return hint(interaction, "Aucun Pokémon de ta vitrine ne correspond");
        interaction.respond(choices).catch(() => {});
      });
    }

    getIndividuals(interaction.user.id, (err, rows) => {
      if (err) {
        handleException("Autocomplétion de /pk vitrine :", err);
        return interaction.respond([]).catch(() => {});
      }
      if (focused.name === "individu") {
        const species = getSpecies(Number(interaction.options.get("espece")?.value));
        if (!species)
          return hint(interaction, "⚠️ Choisis d'abord l'espèce dans l'option « espece »");
        const choices = individualChoices(
          rows.filter((row) => row.species_id === species.id),
          query
        );
        if (!choices.length) return hint(interaction, `Tu n'as plus de ${species.name}`);
        return interaction.respond(choices).catch(() => {});
      }
      const choices = ownedSpeciesChoices(countBySpecies(rows), query);
      if (!choices.length) return hint(interaction, "Aucun Pokémon de ta boîte ne correspond");
      interaction.respond(choices).catch(() => {});
    });
  },

  async execute(interaction) {
    try {
      if (!getPokemonConfig().enabled) {
        return ephemeral(interaction, { content: "❌ Le jeu Pokémon est désactivé." });
      }
      const action = interaction.options.getSubcommand();
      const fail = (err) => {
        handleException("/pk vitrine :", err);
        ephemeral(interaction, { content: "❌ Erreur base de données." });
      };
      // Relue après chaque changement : la réponse montre la vitrine telle
      // que la base la voit, pas telle qu'on croit l'avoir laissée.
      const showMine = (intro) =>
        getShowcase(interaction.user.id, (err, rows) =>
          err ? fail(err) : replyShowcase(interaction, rows, { mine: true, intro })
        );

      if (action === "voir") {
        const user = interaction.options.getUser("membre") ?? interaction.user;
        if (user.bot) {
          return ephemeral(interaction, { content: "❌ Les bots n'exposent pas de Pokémon." });
        }
        const member = interaction.options.getMember("membre");
        const name = member?.displayName ?? user.globalName ?? user.username;
        return getShowcase(user.id, (err, rows) =>
          err
            ? fail(err)
            : replyShowcase(interaction, rows, { mine: user.id === interaction.user.id, name })
        );
      }

      if (action === "retirer") {
        const pokemonId = parseIndividual(interaction.options.getString("pokemon"));
        if (!pokemonId) {
          return ephemeral(interaction, {
            content: "❌ Choisis le Pokémon dans la liste d'autocomplétion.",
          });
        }
        return removeFromShowcase(interaction.user.id, pokemonId, (err, removed) => {
          if (err) return fail(err);
          if (!removed) {
            return ephemeral(interaction, {
              content: `❌ Le Pokémon #${pokemonId} n'est pas dans ta vitrine.`,
            });
          }
          showMine(`↩️ Le Pokémon #${pokemonId} quitte ta vitrine.`);
        });
      }

      // ajouter : l'espèce et l'individu se revalident, tapés à la main ou
      // périmés ; l'écriture revérifie qu'il est à lui et qu'il reste une place.
      const selector = await new Promise((resolve, reject) =>
        resolveIndividual(
          interaction.user.id,
          interaction.options.getString("espece"),
          interaction.options.getString("individu"),
          (err, s) => (err ? reject(err) : resolve(s))
        )
      );
      if (selector.error) return ephemeral(interaction, { content: `❌ ${selector.error}` });
      const { pokemonId, row } = selector;
      const place = interaction.options.getInteger("place");
      const name = nameOf(row);

      const placeAt = (intro) =>
        place
          ? moveInShowcase(interaction.user.id, pokemonId, place, (err) =>
              err ? fail(err) : showMine(intro)
            )
          : showMine(intro);

      if (row.showcase_pos !== null && row.showcase_pos !== undefined) {
        if (!place) {
          return ephemeral(interaction, {
            content:
              `❌ **${name}** est déjà dans ta vitrine. Pour le changer de place, précise ` +
              `l'option « place ».`,
          });
        }
        return placeAt(`🏆 **${name}** change de place dans ta vitrine.`);
      }
      addToShowcase(interaction.user.id, pokemonId, (err, result) => {
        if (err) return fail(err);
        if (!result.ok) return ephemeral(interaction, { content: `❌ ${result.reason}` });
        placeAt(`🏆 **${name}** rejoint ta vitrine.`);
      });
    } catch (error) {
      handleException(error);
    }
  },
};
