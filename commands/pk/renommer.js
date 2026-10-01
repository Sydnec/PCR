import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import {
  countBySpecies,
  getIndividuals,
  resolveIndividual,
} from "../../modules/pokemon/collection.js";
import { renamePokemon, pcConfig } from "../../modules/pokemon/pc.js";
import { getSpecies } from "../../modules/pokemon/data.js";
import {
  displayName,
  individualChoices,
  ownedSpeciesChoices,
  respondHint as hint,
} from "../../modules/pokemon/embeds.js";

// Le surnom d'un Pokémon. Même fonction que sur le site (renamePokemon) : mêmes
// règles, même limite (`pokemon.pc.nicknameLength`), un surnom vide le retire. Il
// ne change rien au jeu, et suit le Pokémon quand il évolue ou change de dresseur.
export default {
  describe: (sub) =>
    sub
      .setName("renommer")
      .setDescription("Donne un surnom à un de tes Pokémon, ou retire-le")
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
          .setDescription("Le Pokémon précis à renommer")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName("surnom")
          .setDescription("Son nouveau surnom — vide, il le perd")
          .setRequired(false)
          .setMaxLength(24)
      ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const query = String(focused.value ?? "");
    getIndividuals(interaction.user.id, (err, rows) => {
      if (err) {
        handleException("Autocomplétion de /pk renommer :", err);
        return interaction.respond([]).catch(() => {});
      }
      if (focused.name === "individu") {
        const species = getSpecies(Number(interaction.options.get("espece")?.value));
        if (!species) return hint(interaction, "⚠️ Choisis d'abord l'espèce dans l'option « espece »");
        const own = rows.filter((row) => row.species_id === species.id);
        const nicknames = new Map(own.map((row) => [`#${row.id}`, row.nickname]));
        // Le surnom actuel dans le libellé : on retrouve « Pipou » parmi ses Roucool.
        const choices = individualChoices(own, query).map((choice) => ({
          ...choice,
          name: (nicknames.get(choice.value)
            ? `${choice.name} · « ${nicknames.get(choice.value)} »`
            : choice.name
          ).slice(0, 100),
        }));
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
      const refuse = (content) =>
        interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      const selector = await new Promise((resolve, reject) =>
        resolveIndividual(
          interaction.user.id,
          interaction.options.getString("espece"),
          interaction.options.getString("individu"),
          (err, found) => (err ? reject(err) : resolve(found))
        )
      );
      if (selector.error) return refuse(`❌ ${selector.error}`);
      const { pokemonId, row } = selector;
      const species = getSpecies(row.species_id);
      const name = `#${pokemonId} ${displayName(species, row.is_shiny, row.sex, row.form)}`;

      renamePokemon(
        interaction.user.id,
        pokemonId,
        interaction.options.getString("surnom"),
        (err, result) => {
          if (err) {
            handleException("/pk renommer :", err);
            return refuse("❌ Erreur base de données.");
          }
          if (!result.ok) return refuse(`❌ ${result.reason}`);
          // L'ancien surnom, pour pouvoir le remettre.
          const before = row.nickname ? ` (avant : **${row.nickname}**)` : "";
          const cut = result.cut
            ? ` ✂️ Rogné à ${pcConfig().nicknameLength} caractères.`
            : "";
          interaction
            .reply({
              content: result.nickname
                ? `✅ **${name}** s'appelle désormais **${result.nickname}**.${before}${cut}`
                : `✅ **${name}** n'a plus de surnom.${before}`,
              flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});
        }
      );
    } catch (error) {
      handleException(error);
    }
  },
};
