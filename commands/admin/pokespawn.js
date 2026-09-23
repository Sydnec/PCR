import { log } from "../../modules/utils.js";
import { claimForcedSpawn, doSpawn } from "../../modules/pokemon/spawn.js";
import {
  activeGeneration,
  getAvailableSpecies,
  getSpecies,
  searchByName,
} from "../../modules/pokemon/data.js";

export default {
  describe: (sub) =>
    sub
      .setName("pokespawn")
      .setDescription("Déclenche l'apparition d'un Pokémon (événements)")
      .addStringOption((option) =>
        option
          .setName("espece")
          .setDescription("Espèce à faire apparaître (aléatoire si absent)")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addBooleanOption((option) =>
        option
          .setName("shiny")
          .setDescription("Forcer la version shiny")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("annonce")
          .setDescription("Texte affiché en tête de l'embed (ex : 🎃 Événement d'Halloween !)")
          .setRequired(false)
      )
      .addBooleanOption((option) =>
        option
          .setName("ping")
          .setDescription("Forcer ou supprimer la mention du rôle Dresseur")
          .setRequired(false)
      ),

  async autocomplete(interaction) {
    const query = interaction.options.getFocused();
    // Un spawn forcé donne volontairement accès aux espèces hors pool naturel
    // (légendaires, évolutions par échange) : c'est tout l'intérêt d'un événement.
    await interaction
      .respond(
        searchByName(query, 25).map((species) => ({
          name:
            `#${String(species.id).padStart(3, "0")} ${species.name}` +
            (species.tradeEvolution ? " (hors pool)" : "") +
            (species.isLegendary || species.isMythical ? " ⭐" : ""),
          value: String(species.id),
        }))
      )
      .catch(() => {});
  },

  async execute(interaction, bot) {
    if (!process.env.POKEMON_CHANNEL_ID) {
      return interaction.editReply({
        content: "❌ `POKEMON_CHANNEL_ID` n'est pas configuré.",
      });
    }

    const speciesOption = interaction.options.getString("espece");
    // Une saisie tapée à la main peut viser une génération encore fermée : un
    // événement ne doit pas servir à l'ouvrir en douce.
    const species = speciesOption ? getAvailableSpecies(speciesOption) : null;
    if (speciesOption && !species) {
      const hidden = getSpecies(speciesOption);
      return interaction.editReply({
        content: hidden
          ? `❌ **${hidden.name}** est de génération ${hidden.generation}, et le jeu ` +
            `s'arrête pour l'instant à la génération ${activeGeneration()}.`
          : "❌ Espèce inconnue.",
      });
    }

    const forceShiny = interaction.options.getBoolean("shiny");
    const announcement = interaction.options.getString("annonce");
    const ping = interaction.options.getBoolean("ping");

    // Le créneau est revendiqué de la même façon que pour un spawn
    // automatique : compteur remis à zéro et horloge réarmée, sinon un spawn
    // naturel pourrait tomber juste après et faire fuir le Pokémon annoncé.
    //
    // La revendication est à callback ; on l'attend. Rendre la main avant elle
    // faisait sortir execute du try/catch du routeur : une erreur dans la suite
    // partait en rejet non capturé, et l'administrateur restait devant un
    // « le bot réfléchit… » sans fin.
    const acquired = await new Promise((resolve, reject) =>
      claimForcedSpawn((err, ok) => (err ? reject(err) : resolve(ok)))
    );
    if (!acquired) {
      return interaction
        .editReply({ content: "⏳ Un spawn est déjà en cours de création, réessaie." })
        .catch(() => {});
    }

    await doSpawn(bot ?? interaction.client, {
      speciesId: species ? species.id : null,
      forceShiny: forceShiny === null ? null : forceShiny,
      announcement,
      ping: ping === null ? null : ping,
    });

    log(
      `/admin pokespawn par ${interaction.user.username} : ${species ? species.name : "aléatoire"}${forceShiny ? " ✨" : ""}`
    );
    await interaction
      .editReply({
        content: `✅ Spawn déclenché : **${species ? species.name : "espèce aléatoire"}**${forceShiny ? " (shiny)" : ""}.`,
      })
      .catch(() => {});
  },
};
