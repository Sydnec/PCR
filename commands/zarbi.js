import { AttachmentBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { handleException } from "../modules/utils.js";
import { getOwnedForms } from "../modules/pokemon/collection.js";
import { getUnownTextConfig } from "../modules/pokemon/config.js";
import { formOf, isAvailable, unownSpecies } from "../modules/pokemon/data.js";
import { renderUnownText, unownLines, unownWords } from "../modules/pokemon/unown-text.js";

// Un message écrit en Zarbi, publié dans le salon : chaque lettre est le Zarbi
// de cette lettre, et il faut l'avoir dans sa collection pour l'écrire. Hors de
// /pk à la demande du mainteneur : c'est une façon d'écrire, pas une action du
// jeu, et /pk zarbis suit déjà les lettres réunies.
const UNOWN_IMAGE = "zarbi.png";

const ephemeral = (interaction, content) =>
  (interaction.deferred
    ? interaction.followUp({ content, flags: MessageFlags.Ephemeral })
    : interaction.reply({ content, flags: MessageFlags.Ephemeral })
  ).catch(() => {});

export default {
  data: new SlashCommandBuilder()
    .setName("zarbi")
    .setDescription("Écris un message en Zarbi, avec les lettres que tu as réunies")
    .addStringOption((option) =>
      option.setName("texte").setDescription("Le message à écrire").setRequired(true)
    ),

  async execute(interaction) {
    try {
      const species = unownSpecies();
      if (!isAvailable(species)) {
        return ephemeral(
          interaction,
          `❌ Zarbi n'est pas encore dans le Pokédex` +
            (species ? ` : il arrive avec la ${species.generation}ᵉ génération.` : ".")
        );
      }
      const words = unownWords(interaction.options.getString("texte"));
      const length = words.join("").length;
      if (!length) {
        return ephemeral(interaction, "❌ Ton message n'a aucune lettre à écrire en Zarbi.");
      }
      const { maxLetters, lettersPerLine } = getUnownTextConfig();
      if (length > maxLetters) {
        return ephemeral(
          interaction,
          `❌ Ton message a ${length.toLocaleString("fr-FR")} lettres : ` +
            `${maxLetters.toLocaleString("fr-FR")} au plus.`
        );
      }
      getOwnedForms(interaction.user.id, species.id, (err, owned) => {
        if (err) {
          handleException("Lecture des Zarbi pour /zarbi :", err);
          return ephemeral(interaction, "❌ Impossible de lire ta collection.");
        }
        const needed = [...new Set(words.join(""))].sort();
        const missing = needed.filter((key) => !owned.has(key));
        if (missing.length) {
          const names = missing.map(
            (key) => `**${formOf(species, key)?.name ?? key.toUpperCase()}**`
          );
          return ephemeral(
            interaction,
            `❌ Il te manque ${missing.length} lettre${missing.length > 1 ? "s" : ""} de Zarbi ` +
              `pour ce message : ${names.join(", ")} ` +
              `(tu en as ${needed.length - missing.length} sur ${needed.length}).`
          );
        }
        publish(interaction, species, unownLines(words, lettersPerLine)).catch((error) =>
          handleException("Publication de /zarbi :", error)
        );
      });
    } catch (error) {
      handleException(error);
    }
  },
};

// Dessiner l'image demande de télécharger les illustrations : la réponse,
// publique, est différée d'abord, Discord ne laissant que trois secondes pour
// répondre. Sans image, elle disparaît au profit d'un refus privé, plutôt que
// d'annoncer une panne à tout le salon.
async function publish(interaction, species, lines) {
  await interaction.deferReply();
  const image = await renderUnownText(species, lines);
  if (!image) {
    await interaction.deleteReply().catch(() => {});
    return ephemeral(interaction, "❌ Les Zarbi ne répondent pas, réessaie dans un instant.");
  }
  await interaction
    .editReply({ files: [new AttachmentBuilder(image, { name: UNOWN_IMAGE })] })
    .catch(() => {});
}
