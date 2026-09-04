import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException, isAdmin, log } from "../modules/utils.js";
import { claimForcedSpawn, doSpawn } from "../modules/pokemon/spawn.js";
import { getSpecies, searchByName } from "../modules/pokemon/data.js";

export default {
  data: new SlashCommandBuilder()
    .setName("pokespawn")
    .setDescription("[Admin] Déclenche l'apparition d'un Pokémon (événements)")
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
    try {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({
          content: "❌ Cette commande est réservée aux administrateurs.",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (!process.env.POKEMON_CHANNEL_ID) {
        return interaction.reply({
          content: "❌ `POKEMON_CHANNEL_ID` n'est pas configuré.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const speciesOption = interaction.options.getString("espece");
      const species = speciesOption ? getSpecies(speciesOption) : null;
      if (speciesOption && !species) {
        return interaction.reply({
          content: "❌ Espèce inconnue.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const forceShiny = interaction.options.getBoolean("shiny");
      const announcement = interaction.options.getString("annonce");
      const ping = interaction.options.getBoolean("ping");

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Le créneau est revendiqué de la même façon que pour un spawn
      // automatique : compteur remis à zéro et horloge réarmée, sinon un spawn
      // naturel pourrait tomber juste après et faire fuir le Pokémon annoncé.
      claimForcedSpawn(async (err, acquired) => {
        if (err) {
          handleException(err);
          return interaction.editReply({ content: "❌ Erreur base de données." }).catch(() => {});
        }
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
          `/pokespawn par ${interaction.user.username} : ${species ? species.name : "aléatoire"}${forceShiny ? " ✨" : ""}`
        );
        await interaction
          .editReply({
            content: `✅ Spawn déclenché : **${species ? species.name : "espèce aléatoire"}**${forceShiny ? " (shiny)" : ""}.`,
          })
          .catch(() => {});
      });
    } catch (error) {
      handleException(error);
    }
  },
};
