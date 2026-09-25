// L'ouverture d'une génération, annoncée dans le salon des apparitions.
//
// Ouvrir une génération n'est qu'un réglage relu à chaque usage (`generation`,
// ou une date de `generationOpenings`, voir activeGeneration) : au passage de
// l'heure, le Pokédex, les apparitions, les œufs et les objets de la nouvelle
// génération suivent d'eux-mêmes. Il ne reste qu'à le dire, une fois : le
// minuteur passe chaque minute, et la table pokemon_generations garde la trace
// de ce qui a déjà été annoncé.
import { EmbedBuilder } from "discord.js";
import db from "../points-db.js";
import { handleException, log } from "../utils.js";
import { getPokemonConfig, getSafariConfig } from "./config.js";
import { activeGeneration, allSpecies, generationOrdinal, isLegendary } from "./data.js";
import { getCharmItem, getItems } from "./items.js";
import { charmSpecies } from "./charms.js";
import { resolveChannel } from "./spawn.js";

const fr = (value) => value.toLocaleString("fr-FR");
const names = (list) =>
  list.length > 1 ? `${list.slice(0, -1).join(", ")} et ${list[list.length - 1]}` : list.join("");

// Ce qu'apporte une génération, lu dans le jeu de données et le catalogue :
// ses espèces, ses bébés, ses objets, son charme. Rien n'est écrit à la main,
// la génération 3 s'annoncera de la même façon.
export function buildGenerationEmbed(generation) {
  const species = allSpecies().filter((entry) => entry.generation === generation);
  const babies = species.filter((entry) => entry.isBaby).map((entry) => entry.name);
  const legendaries = species.filter(isLegendary).map((entry) => entry.name);
  const items = getItems()
    .filter((item) => Number(item.generation) === generation)
    .map((item) => `${item.emoji} **${item.label}**`);
  const charm = getCharmItem(generation);
  const lines = [
    `**${fr(species.length)}** nouvelles espèces, de **${species[0]?.name}** à ` +
      `**${species[species.length - 1]?.name}**, rejoignent le Pokédex dès maintenant.`,
  ];
  if (legendaries.length) lines.push(`Parmi elles, des légendaires : ${names(legendaries)}.`);
  if (babies.length) {
    lines.push(
      `🥚 Les œufs s'ouvrent : ${names(babies)} ne naissent que d'un œuf. ` +
        "`/pk oeuf pondre` avec un couple de parents."
    );
  }
  if (items.length) {
    lines.push(`🎁 Nouveaux objets, à la loterie et sur les Pokémon : ${names(items)}.`);
  }
  if (getSafariConfig().enabled !== false) {
    lines.push("🌿 Au parc safari, choisis la ou les générations que tu vises.");
  }
  if (charm) {
    lines.push(
      `${charm.emoji} Le **${charm.label}** attend qui complétera ses ` +
        `${fr(charmSpecies(generation).length)} espèces, hors légendaires.`
    );
  }
  return new EmbedBuilder()
    .setTitle(`🎉 La ${generationOrdinal(generation)} génération est ouverte !`)
    .setColor(0xf1c40f)
    .setDescription(lines.join("\n\n"));
}

// Annonce les générations ouvertes qui ne l'ont pas encore été. La première ne
// s'annonce pas : elle était là dès le premier jour.
export async function announceOpenedGenerations(client) {
  if (!getPokemonConfig().enabled) return;
  const active = activeGeneration();
  for (let generation = 2; generation <= active; generation++) {
    const claimed = await new Promise((resolve) =>
      db.run(
        "INSERT OR IGNORE INTO pokemon_generations (generation, announced_at) VALUES (?, ?)",
        [generation, Date.now()],
        function (err) {
          if (err) handleException("Revendication de l'annonce d'une génération :", err);
          resolve(!err && this.changes === 1);
        }
      )
    );
    if (!claimed) continue;
    log(`Génération ${generation} ouverte`);
    try {
      const channel = await resolveChannel(client);
      if (!channel) continue;
      const roleId = process.env.POKEMON_ROLE_ID;
      await channel.send({
        content: roleId ? `<@&${roleId}>` : undefined,
        embeds: [buildGenerationEmbed(generation)],
        allowedMentions: { roles: roleId ? [roleId] : [] },
      });
    } catch (error) {
      // Revendiquée quand même : une annonce ratée ne se répète pas chaque
      // minute dans le salon.
      handleException(`Annonce de la génération ${generation} :`, error);
    }
  }
}
