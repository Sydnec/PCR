import { MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import { generationOrdinal, getSpecies } from "../../modules/pokemon/data.js";
import { getPokemonConfig } from "../../modules/pokemon/config.js";
import { castLine, getFishingSpawn, getRodsOf } from "../../modules/pokemon/fishing.js";
import { ballPanelRow } from "../../modules/pokemon/capture.js";
import { buildSpawnEmbed, respondHint as hint } from "../../modules/pokemon/embeds.js";

const fr = (value) => value.toLocaleString("fr-FR");
const promisify = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (err, value) => (err ? reject(err) : resolve(value))));

// La touche, telle que son pêcheur la voit : l'embed d'une apparition et la rangée de
// balls du panneau de relance — les mêmes boutons que dans le salon, qui réécrivent ce
// message. Réponse privée : personne d'autre ne peut la lancer.
async function catchPayload(userId, spawn, intro) {
  const species = getSpecies(spawn.species_id);
  const seconds = Math.max(0, Math.ceil((spawn.flees_at - Date.now()) / 1000));
  return {
    content: `${intro}\n⏳ Il s'enfuit dans **${fr(seconds)} s**.`,
    embeds: [buildSpawnEmbed(spawn, species, [])],
    components: [await ballPanelRow(userId, spawn.id)],
  };
}

// Lancer sa ligne : une canne (qui fixe le prix et la table de pêche), un Pokémon réservé
// au pêcheur. Même fonction que sur le site (castLine). Sans option, ses cannes et sa
// touche en cours — celle qu'un éphémère fermé ferait perdre de vue.
export default {
  describe: (sub) =>
    sub
      .setName("pecher")
      .setDescription("Lance ta ligne : un Pokémon rien que pour toi")
      .addStringOption((option) =>
        option
          .setName("canne")
          .setDescription("Ta canne")
          .setRequired(false)
          .setAutocomplete(true)
      ),

  async autocomplete(interaction) {
    const query = String(interaction.options.getFocused() ?? "").toLowerCase();
    try {
      const rods = await promisify(getRodsOf, interaction.user.id);
      if (!rods.length) return hint(interaction, "La pêche n'est pas encore ouverte");
      const choices = rods
        .filter((rod) => rod.owned)
        .map((rod) => ({ name: `${rod.label} — ${fr(rod.price)} points`, value: rod.key }))
        .filter((choice) => choice.name.toLowerCase().includes(query));
      if (!choices.length) return hint(interaction, "Aucune canne ne correspond");
      await interaction.respond(choices).catch(() => {});
    } catch (error) {
      handleException("Autocomplétion de /pk pecher :", error);
      interaction.respond([]).catch(() => {});
    }
  },

  async execute(interaction) {
    const userId = interaction.user.id;
    const reply = (payload) =>
      interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
    try {
      const key = interaction.options.getString("canne");

      if (!key) {
        const rods = await promisify(getRodsOf, userId);
        if (!rods.length) {
          return reply({
            content: `La pêche n'est pas encore ouverte : elle arrive avec la ${generationOrdinal(
              Number(getPokemonConfig().fishing.generation)
            )} génération.`,
          });
        }
        const lines = rods.map(
          (rod) =>
            `${rod.emoji} **${rod.label}** — ${fr(rod.price)} points · ` +
            (rod.owned ? "✅ tu l'as" : "🔒 à trouver ou gagner à la loterie")
        );
        const current = await promisify(getFishingSpawn, userId);
        const pending = current
          ? `\n\n🎣 Une touche t'attend : relance \`/pk pecher canne:<nom>\` pour la retrouver.`
          : "";
        return reply({
          content:
            `${lines.join("\n")}\n\n\`/pk pecher canne:<nom>\` : le Pokémon qui mord est pour toi seul, ` +
            `et les balls se paient comme sur une apparition.${pending}`,
        });
      }

      const result = await promisify(castLine, userId, key);
      if (result.ok) {
        const intro = `🎣 Ça mord ! (**-${fr(result.price)}** points, ${result.rod.label})`;
        // Les points sont partis et la touche existe : si l'affichage échoue, on le dit tel
        // quel — le catch-all ci-dessous prétendrait que rien n'a été débité.
        try {
          return reply(await catchPayload(userId, result.spawn, intro));
        } catch (error) {
          handleException("Affichage d'une touche :", error);
          return reply({
            content: `🎣 Ça mord ! (**-${fr(result.price)}** points) mais l'affichage a échoué : relance \`/pk pecher\` pour retrouver ta touche.`,
          });
        }
      }
      // Une touche déjà là : on la remet sous les yeux plutôt que de la laisser se perdre.
      if (result.existing) {
        return reply(
          await catchPayload(userId, result.existing, `❌ ${result.reason}`)
        );
      }
      return reply({ content: `❌ ${result.reason}` });
    } catch (error) {
      handleException("Pêche :", error);
      reply({ content: "❌ Erreur base de données : rien n'a été débité." });
    }
  },
};

