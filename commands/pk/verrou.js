import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import {
  countBySpecies,
  getIndividuals,
  resolveIndividual,
  toggleLock,
} from "../../modules/pokemon/collection.js";
import { getSpecies } from "../../modules/pokemon/data.js";
import {
  displayName,
  individualChoices,
  respondHint as hint,
} from "../../modules/pokemon/embeds.js";

// Le verrou d'un Pokémon. Verrouillé, il ne part jamais — ni revente, ni
// échange, ni sacrifice —, mais il peut encore évoluer, après confirmation, et
// pondre. Les shiny et les légendaires arrivent verrouillés ; la commande
// bascule : un verrouillé s'ouvre, un ouvert se verrouille.
export default {
  describe: (sub) =>
    sub
      .setName("verrou")
      .setDescription("Verrouille ou déverrouille un de tes Pokémon : verrouillé, il ne part jamais")
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
          .setDescription("Le Pokémon précis à verrouiller ou déverrouiller")
          .setRequired(true)
          .setAutocomplete(true)
      ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const query = String(focused.value ?? "");
    getIndividuals(interaction.user.id, (err, rows) => {
      if (err) {
        handleException("Autocomplétion de /pk verrou :", err);
        return interaction.respond([]).catch(() => {});
      }
      // Second temps : tous les individus de l'espèce, le libellé dit lesquels
      // sont déjà verrouillés.
      if (focused.name === "individu") {
        const species = getSpecies(Number(interaction.options.get("espece")?.value));
        if (!species) return hint(interaction, "⚠️ Choisis d'abord l'espèce dans l'option « espece »");
        const choices = individualChoices(
          rows.filter((row) => row.species_id === species.id),
          query
        );
        if (!choices.length) return hint(interaction, `Tu n'as plus de ${species.name}`);
        return interaction.respond(choices).catch(() => {});
      }
      const needle = query.toLowerCase();
      const choices = [...countBySpecies(rows)]
        .map(([speciesId, { total, free }]) => {
          const species = getSpecies(speciesId);
          if (!species) return null;
          const locked = total - free;
          return {
            name:
              `${species.name} (×${total.toLocaleString("fr-FR")}` +
              `${locked ? `, dont ${locked.toLocaleString("fr-FR")} 🛡️` : ""})`,
            value: String(speciesId),
          };
        })
        .filter((choice) => choice && choice.name.toLowerCase().includes(needle))
        .slice(0, 25);
      if (!choices.length) return hint(interaction, "Aucun Pokémon de ta boîte ne correspond");
      interaction.respond(choices).catch(() => {});
    });
  },

  async execute(interaction) {
    try {
      const selector = await new Promise((resolve, reject) =>
        resolveIndividual(
          interaction.user.id,
          interaction.options.getString("espece"),
          interaction.options.getString("individu"),
          (err, s) => (err ? reject(err) : resolve(s))
        )
      );
      if (selector.error) {
        return interaction
          .reply({ content: `❌ ${selector.error}`, flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
      const { pokemonId, row } = selector;
      const name = `#${pokemonId} ${displayName(getSpecies(row.species_id), row.is_shiny, row.sex)}`;
      toggleLock(interaction.user.id, pokemonId, (err, locked) => {
        if (err) {
          handleException("/pk verrou :", err);
          return interaction
            .reply({ content: "❌ Erreur base de données.", flags: MessageFlags.Ephemeral })
            .catch(() => {});
        }
        interaction
          .reply({
            content:
              locked === null
              ? `❌ Le Pokémon #${pokemonId} n'est plus dans ta boîte.`
              : locked
              ? `🛡️ **${name}** est verrouillé : il ne sera ni revendu, ni échangé, ni ` +
                `sacrifié. Il peut encore évoluer, après confirmation, et pondre.`
              : `🔓 **${name}** est déverrouillé : il peut être revendu, échangé ou sacrifié.`,
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      });
    } catch (error) {
      handleException(error);
    }
  },
};
