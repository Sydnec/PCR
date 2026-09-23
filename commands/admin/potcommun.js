import { log } from "../../modules/utils.js";
import { pseudoOf } from "../../modules/pseudo.js";
import {
  buildRedistributionEmbed,
  getNextRedistributionAt,
  runRedistribution,
} from "../../modules/redistribution.js";

// Déclenche un pot commun hors calendrier, ou montre ce que donnerait le
// prochain. L'échéance hebdomadaire n'est pas touchée : un pot forcé s'ajoute,
// il ne remplace pas.
//
// Le récapitulatif reste éphémère, comme tout /admin : le prélèvement est
// invisible pour les joueurs, l'afficher publiquement le trahirait.
export default {
  describe: (sub) =>
    sub
      .setName("potcommun")
      .setDescription("Déclenche un pot commun immédiatement, ou simule le prochain")
      .addBooleanOption((option) =>
        option
          .setName("simulation")
          .setDescription("Calcule et affiche le résultat sans toucher aux soldes")
          .setRequired(false)
      ),

  async execute(interaction) {
    const dryRun = interaction.options.getBoolean("simulation") ?? false;
    const result = await runRedistribution(interaction.guild, {
      triggeredBy: interaction.user.id,
      dryRun,
    });

    if (!result.ok) {
      return interaction.editReply({ content: `❌ ${result.reason}` });
    }

    const nextAt = await new Promise((resolve) =>
      getNextRedistributionAt((err, at) => resolve(err ? 0 : at))
    );
    const prochain = nextAt
      ? `\nProchain pot automatique : <t:${Math.floor(nextAt / 1000)}:R>.`
      : "\n⚠️ Aucune échéance automatique n'est encore posée.";

    const embed = buildRedistributionEmbed(result);
    if (dryRun) {
      return interaction.editReply({
        content: `🔎 Simulation — **aucun solde n'a bougé**.${prochain}`,
        embeds: [embed],
      });
    }

    log(`/admin potcommun par ${pseudoOf(interaction)} : ${result.plan.pot} points`);
    await interaction.editReply({
      content:
        `✅ Pot commun déclenché, sans un mot aux joueurs.` +
        `${result.failures ? ` ⚠️ ${result.failures} échec(s).` : ""}` +
        `\nL'échéance hebdomadaire n'a pas bougé.${prochain}`,
      embeds: [embed],
    });
  },
};
