import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException, isAdmin } from "../modules/utils.js";
import dotenv from "dotenv";
dotenv.config(); // process.env.CONSTANT

export default {
  data: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Supprime des messages (réservé aux administrateurs)")
    .addStringOption((option) =>
      option
        .setName("lien")
        .setDescription("Lien du message jusqu'auquel supprimer")
    )
    .addNumberOption((option) =>
      option.setName("nombre").setDescription("Nombre de messages à supprimer")
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });
      if (!isAdmin(interaction.member)) {
        await interaction.editReply({
          content:
            "Vous n'avez pas les autorisations nécessaires pour utiliser cette commande.",
        });
      } else {
        if (
          !(
            interaction.options.getNumber("nombre") > 0 ||
            interaction.options.getString("lien") != null
          )
        ) {
          await interaction.editReply({
            content: "Veuillez entrer un paramètre",
          });
          return;
        }
        await interaction.editReply({
          content: "Je m'en occupe chef !",
        });
        let numberMessages = interaction.options.getNumber("nombre");
        if (numberMessages > 0) {
          async function clear() {
            let fetched;
            fetched = await interaction.channel.messages.fetch({
              limit: numberMessages,
            });
            interaction.channel.bulkDelete(fetched);
          }
          clear();
        } else {
          const link = interaction.options.getString("lien");
          let linkedMessage = await interaction.channel.messages.fetch({
            limit: 1,
          });
          while (linkedMessage.last().url != link) {
            await linkedMessage.last().delete();
            linkedMessage = await interaction.channel.messages.fetch({
              limit: 1,
            });
          }
        }
      }
    } catch (err) {
      handleException(err);
    }
  },
};
