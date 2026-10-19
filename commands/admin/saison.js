import { previewSeason } from "../../modules/pokemon/season.js";

// L'aperçu du bilan de la saison en cours, de son ouverture à maintenant. C'est le bilan que le
// bot publiera à l'ouverture de la génération suivante, calculé tel quel : de quoi vérifier ce
// qu'il dira, ou régler ses seuils (`pokemon.seasonRecap`), avant l'heure.
//
// Ne publie rien et n'enregistre rien (le bilan définitif se fige à l'ouverture, jamais ici) : la
// réponse est éphémère comme tout /admin, et les mentions des podiums n'y réveillent personne.
export default {
  describe: (sub) =>
    sub
      .setName("saison")
      .setDescription("Aperçu du bilan de la saison en cours (rien n'est publié ni enregistré)"),

  async execute(interaction) {
    const preview = await previewSeason();
    if (!preview.ok) {
      return interaction.editReply({ content: `❌ ${preview.reason}` }).catch(() => {});
    }
    await interaction
      .editReply({
        content: preview.content,
        embeds: preview.embeds,
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
  },
};
