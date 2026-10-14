import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import { getPokemonConfig } from "../../modules/pokemon/config.js";
import { generationOrdinal, getSpecies } from "../../modules/pokemon/data.js";
import {
  generationOfStarter,
  getStarter,
  givenTiers,
  lineageAt,
  starterChoices,
  starterGenerations,
  starterProgress,
  starterTiers,
  tierReached,
} from "../../modules/pokemon/starters.js";
import { respondHint as hint } from "../../modules/pokemon/embeds.js";

const promisify = (fn, ...args) =>
  new Promise((resolve, reject) => fn(...args, (err, value) => (err ? reject(err) : resolve(value))));

// Les paliers d'une génération, tels qu'on les lit : celui déjà reçu, et ceux qui
// restent avec le pourcentage à atteindre.
async function tierLines(userId, generation, starter, progress) {
  const given = await promisify(givenTiers, userId, generation);
  return starterTiers()
    .map((tier) => {
      const target = lineageAt(starter, tier.stage);
      const name = target ? `${target.name}${tier.shiny ? " ✨" : ""}` : "?";
      const state = given.has(tier.percent)
        ? "✅"
        : tierReached(progress, tier.percent)
          ? "⏳"
          : "·";
      return `${state} **${tier.percent} %** : ${name}`;
    });
}

// Où en est le dresseur, génération par génération : son choix et ses paliers, ou
// les trois starters entre lesquels choisir.
async function statusText(userId) {
  const generations = starterGenerations();
  if (!generations.length) {
    const next = Object.keys(getPokemonConfig().starters?.choices ?? {}).map(Number).sort((a, b) => a - b)[0];
    return (
      "Aucune génération ouverte ne propose de starter pour l'instant" +
      (next ? ` : le choix arrive avec la ${generationOrdinal(next)} génération.` : ".")
    );
  }
  const blocks = [];
  for (const generation of generations) {
    const title = `**${generationOrdinal(generation)} génération**`;
    const chosen = await promisify(getStarter, userId, generation);
    if (!chosen) {
      blocks.push(
        `${title} — à choisir : ${starterChoices(generation).map((entry) => `**${entry.name}**`).join(", ")}.\n` +
          "`/pk starter pokemon:<nom>` — le choix est définitif."
      );
      continue;
    }
    const progress = await promisify(starterProgress, userId, generation);
    const percent = progress.total ? Math.floor((progress.have * 100) / progress.total) : 0;
    const lines = await tierLines(userId, generation, chosen, progress);
    blocks.push(
      `${title} — ton starter : **${chosen.name}**\n` +
        `Pokédex de la génération, hors légendaires : **${progress.have.toLocaleString("fr-FR")}** / ` +
        `${progress.total.toLocaleString("fr-FR")} (${percent} %)\n${lines.join("\n")}`
    );
  }
  return blocks.join("\n\n");
}

// Le starter de génération : choisir (une fois, définitivement) ou voir où l'on en
// est. La confirmation passe par un bouton, parce qu'un choix qu'on ne peut pas
// reprendre ne se joue pas sur une faute de frappe.
export default {
  describe: (sub) =>
    sub
      .setName("starter")
      .setDescription("Choisis ton starter de génération, ou vois où en sont tes récompenses")
      .addStringOption((option) =>
        option
          .setName("pokemon")
          .setDescription("Le starter que tu choisis — définitif")
          .setRequired(false)
          .setAutocomplete(true)
      ),

  async autocomplete(interaction) {
    const query = String(interaction.options.getFocused() ?? "").toLowerCase();
    try {
      const open = [];
      for (const generation of starterGenerations()) {
        const chosen = await promisify(getStarter, interaction.user.id, generation);
        if (chosen) continue;
        for (const species of starterChoices(generation)) {
          open.push({ name: `${species.name} — ${generationOrdinal(generation)} génération`, value: String(species.id) });
        }
      }
      // Rien à choisir et aucun nom qui corresponde ne se disent pas pareil.
      if (!open.length) {
        return hint(interaction, "Aucun starter à choisir : déjà choisi, ou pas encore ouvert");
      }
      const choices = open.filter((choice) => choice.name.toLowerCase().includes(query));
      if (!choices.length) return hint(interaction, "Aucun starter ne correspond");
      await interaction.respond(choices.slice(0, 25)).catch(() => {});
    } catch (error) {
      handleException("Autocomplétion de /pk starter :", error);
      interaction.respond([]).catch(() => {});
    }
  },

  async execute(interaction) {
    try {
      const raw = interaction.options.getString("pokemon");
      const reply = (content, components = []) =>
        interaction.reply({ content, components, flags: MessageFlags.Ephemeral }).catch(() => {});

      if (!raw) return reply(await statusText(interaction.user.id));

      // Une valeur tapée à la main, ou périmée : tout se revérifie ici.
      const species = getSpecies(Number(raw));
      const generation = species ? generationOfStarter(species.id) : null;
      if (!species || !generation) {
        return reply("❌ Choisis un starter dans la liste d'autocomplétion.");
      }
      const chosen = await promisify(getStarter, interaction.user.id, generation);
      if (chosen) {
        return reply(
          `❌ Tu as déjà choisi **${chosen.name}** pour la ${generationOrdinal(generation)} génération : ` +
            "le choix est définitif."
        );
      }
      return reply(
        `Tu choisis **${species.name}** comme starter de la ${generationOrdinal(generation)} génération ? ` +
          "Tu le reçois tout de suite, et **le choix est définitif**.",
        [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`poke_starter_ok|${species.id}`)
              .setLabel(`Choisir ${species.name}`)
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId("poke_starter_no")
              .setLabel("Annuler")
              .setStyle(ButtonStyle.Secondary)
          ),
        ]
      );
    } catch (error) {
      handleException(error);
      interaction
        .reply({ content: "❌ Erreur base de données.", flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  },
};
