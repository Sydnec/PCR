import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import { getIndividuals } from "../../modules/pokemon/collection.js";
import { getSpecies } from "../../modules/pokemon/data.js";
import { buildBoxEmbed, buildBoxRow } from "../../modules/pokemon/embeds.js";

// La boîte : les Pokémon d'un dresseur un par un, avec ce qui les distingue —
// sexe, ball de capture, date d'arrivée, fertilité, et le verrou.
// Le Pokédex compte des espèces ; ici, on regarde des individus.
export default {
  describe: (sub) =>
    sub
      .setName("boite")
      .setDescription("Tes Pokémon un par un : sexe, ball, date, fertilité")
      .addStringOption((option) =>
        option
          .setName("pokemon")
          .setDescription("Seulement cette espèce (les plus récents sinon)")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addUserOption((option) =>
        option.setName("membre").setDescription("La boîte d'un autre dresseur").setRequired(false)
      ),

    // Les espèces présentes dans la boîte visée. getUser() ne marche pas pendant
    // l'autocomplétion — Discord n'envoie pas les objets résolus — d'où la
    // valeur brute de l'option, comme dans /echange.
  async autocomplete(interaction) {
    const targetId = interaction.options.get("membre")?.value ?? interaction.user.id;
    const needle = String(interaction.options.getFocused() || "").toLowerCase();
    getIndividuals(String(targetId), async (err, rows) => {
      if (err) {
        handleException("Autocomplétion de /pk boite :", err);
        return interaction.respond([]).catch(() => {});
      }
      const counts = new Map();
      for (const row of rows) counts.set(row.species_id, (counts.get(row.species_id) ?? 0) + 1);
      const choices = [...counts]
        .map(([id, count]) => ({ species: getSpecies(id), count }))
        .filter(({ species }) => species && species.name.toLowerCase().includes(needle))
        .slice(0, 25)
        .map(({ species, count }) => ({
          name: `${species.name} (×${count})`,
          value: String(species.id),
        }));
      await interaction.respond(choices).catch(() => {});
    });
  },

  async execute(interaction) {
    try {
      const user = interaction.options.getUser("membre") ?? interaction.user;
      const raw = interaction.options.getString("pokemon");
      const species = raw ? getSpecies(raw) : null;
      if (raw && !species) {
        return interaction.reply({
          content: "❌ Choisis une proposition dans la liste d'autocomplétion.",
          flags: MessageFlags.Ephemeral,
        });
      }

      getIndividuals(user.id, (err, rows) => {
        if (err) {
          handleException("Lecture de la boîte :", err);
          return interaction
            .reply({ content: "❌ Impossible de lire la boîte.", flags: MessageFlags.Ephemeral })
            .catch(() => {});
        }
        const shown = species ? rows.filter((row) => row.species_id === species.id) : rows;
        interaction
          .reply({
            embeds: [buildBoxEmbed(shown, { user, species, page: 0 })],
            components: [buildBoxRow(user.id, species?.id, 0, shown.length)],
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      });
    } catch (error) {
      handleException(error);
    }
  },
};
