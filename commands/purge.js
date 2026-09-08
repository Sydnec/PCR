import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException, isAdmin, log } from "../modules/utils.js";
import dotenv from "dotenv";
dotenv.config(); // process.env.CONSTANT

// Discord refuse un bulkDelete de plus de 100 messages à la fois.
const MAX_MESSAGES = 100;

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
      option
        .setName("nombre")
        .setDescription(`Nombre de messages à supprimer (1 à ${MAX_MESSAGES})`)
        .setMinValue(1)
        .setMaxValue(MAX_MESSAGES)
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (!isAdmin(interaction.member)) {
        await interaction.editReply({
          content:
            "Vous n'avez pas les autorisations nécessaires pour utiliser cette commande.",
        });
        return;
      }

      const link = interaction.options.getString("lien");
      const numberMessages = interaction.options.getNumber("nombre");

      if (!(numberMessages > 0 || link != null)) {
        await interaction.editReply({
          content: "Veuillez entrer un paramètre",
        });
        return;
      }

      if (numberMessages > 0) {
        const fetched = await interaction.channel.messages.fetch({
          limit: Math.min(Math.floor(numberMessages), MAX_MESSAGES),
        });
        // Les messages de plus de 14 jours sont refusés par l'API : `true`
        // demande à discord.js de les ignorer au lieu de tout faire échouer.
        const deleted = await interaction.channel.bulkDelete(fetched, true);
        await interaction.editReply({
          content: `${deleted.size} message(s) supprimé(s).`,
        });
        log(`/purge : ${deleted.size} message(s) par ${interaction.user.tag}`);
        return;
      }

      // Suppression jusqu'à un message donné.
      //
      // La borne DOIT être vérifiée avant de supprimer quoi que ce soit : la
      // version précédente supprimait message par message jusqu'à tomber sur le
      // lien, donc un lien mal collé ou pointant vers un autre salon vidait le
      // salon entier sans jamais s'arrêter.
      const target = parseMessageLink(link);
      if (!target || target.channelId !== interaction.channelId) {
        await interaction.editReply({
          content:
            "❌ Lien invalide : indiquez le lien d'un message de **ce** salon.",
        });
        return;
      }

      const boundary = await interaction.channel.messages
        .fetch(target.messageId)
        .catch(() => null);
      if (!boundary) {
        await interaction.editReply({
          content: "❌ Ce message est introuvable dans ce salon.",
        });
        return;
      }

      // `after` borne la requête au message cible : jamais plus de 100
      // messages, et jamais rien au-delà de la borne demandée.
      const toDelete = await interaction.channel.messages.fetch({
        after: boundary.id,
        limit: MAX_MESSAGES,
      });
      if (toDelete.size === 0) {
        await interaction.editReply({
          content: "Aucun message à supprimer après ce lien.",
        });
        return;
      }

      const deleted = await interaction.channel.bulkDelete(toDelete, true);
      await interaction.editReply({
        content:
          `${deleted.size} message(s) supprimé(s) jusqu'au lien indiqué.` +
          (toDelete.size === MAX_MESSAGES
            ? `\n⚠️ Limite de ${MAX_MESSAGES} messages atteinte, relancez la commande pour continuer.`
            : ""),
      });
      log(`/purge (lien) : ${deleted.size} message(s) par ${interaction.user.tag}`);
    } catch (err) {
      handleException(err);
      await interaction
        .editReply({ content: "❌ Une erreur est survenue pendant la purge." })
        .catch(() => {});
    }
  },
};

// Extrait guilde/salon/message d'un lien Discord, ou null si ce n'en est pas un.
function parseMessageLink(link) {
  const match = String(link).match(
    /^https?:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)\/?$/
  );
  if (!match) return null;
  return { guildId: match[1], channelId: match[2], messageId: match[3] };
}
