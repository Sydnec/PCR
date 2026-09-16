import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException, isAdmin, log } from "../modules/utils.js";
import { openPark } from "../modules/pokemon/safari.js";

// Ouverture manuelle d'un parc safari, pour organiser un événement ou dédommager
// un dresseur. Sans `joueur`, c'est l'événement public : tout le monde peut
// entrer et les apparitions sont suspendues. Avec `joueur`, le parc lui est
// réservé et le salon continue sa vie normale.
export default {
  data: new SlashCommandBuilder()
    .setName("safarispawn")
    .setDescription("[Admin] Ouvre un parc safari (événement public, ou offert à un dresseur)")
    .addUserOption((option) =>
      option
        .setName("joueur")
        .setDescription("Réserve le parc à ce dresseur (les apparitions ne sont pas suspendues)")
        .setRequired(false)
    )
    .addBooleanOption((option) =>
      option
        .setName("pause")
        .setDescription("Suspendre les apparitions (false les relance, même si un parc les avait gelées)")
        .setRequired(false)
    ),

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

      const target = interaction.options.getUser("joueur");
      const pause = interaction.options.getBoolean("pause");

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Le délai entre deux parcs est délibérément ignoré : c'est tout l'intérêt
      // d'une ouverture manuelle. Le verrou « un seul parc public à la fois »,
      // lui, reste en vigueur.
      const result = await openPark(bot ?? interaction.client, {
        openedBy: interaction.user.id,
        reservedFor: target ? target.id : null,
        pauseSpawns: pause === null ? null : pause,
        ignoreCooldown: true,
      });

      if (!result.ok) {
        return interaction.editReply({ content: `❌ ${result.reason}` }).catch(() => {});
      }

      log(
        `/safarispawn par ${interaction.user.username} : parc #${result.parkId}` +
          `${target ? ` réservé à ${target.username}` : " public"}`
      );
      await interaction
        .editReply({
          content:
            `✅ Parc safari **#${result.parkId}** ouvert${target ? ` pour **${target.username}**` : ""}.` +
            (result.paused
              ? " Les apparitions sont suspendues."
              : pause === false
                ? " Les apparitions reprennent immédiatement."
                : ""),
        })
        .catch(() => {});
    } catch (error) {
      handleException(error);
    }
  },
};
