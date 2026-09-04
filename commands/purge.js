import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException, isAdmin, log } from "../modules/utils.js";
import { parseMessageLink } from "../modules/message-expiry.js";
import dotenv from "dotenv";
dotenv.config(); // process.env.CONSTANT

// Discord n'autorise bulkDelete que sur 2 à 100 messages, et refuse ceux de
// plus de 14 jours.
const MAX_BULK = 100;

// Borne de sécurité pour la suppression « jusqu'au lien ». Sans elle, un lien
// qui ne correspondait à aucun message du salon faisait tourner la boucle
// jusqu'à VIDER LE SALON, puis levait sur un salon vide.
const MAX_UNTIL_LINK = 500;

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
        .setDescription(`Nombre de messages à supprimer (1-${MAX_BULK})`)
        .setMinValue(1)
        .setMaxValue(MAX_BULK)
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

      const requested = interaction.options.getNumber("nombre");
      const link = interaction.options.getString("lien");

      if (!(requested > 0) && link == null) {
        await interaction.editReply({ content: "Veuillez entrer un paramètre" });
        return;
      }

      if (requested > 0) {
        const count = Math.min(MAX_BULK, Math.floor(requested));
        const fetched = await interaction.channel.messages.fetch({
          limit: count,
        });
        // `filterOld` : bulkDelete rejette tout le lot dès qu'un message
        // dépasse 14 jours ; on ignore ceux-là au lieu de tout perdre.
        const deleted = await interaction.channel.bulkDelete(fetched, true);
        const skipped = fetched.size - deleted.size;
        await interaction.editReply({
          content:
            `🧹 ${deleted.size} message(s) supprimé(s).` +
            (skipped > 0
              ? ` ${skipped} ignoré(s) (plus de 14 jours, suppression groupée impossible).`
              : ""),
        });
        return;
      }

      // Suppression jusqu'à un message donné, ce dernier étant conservé.
      const target = parseMessageLink(link);
      if (!target || target.channelId !== interaction.channelId) {
        await interaction.editReply({
          content:
            "❌ Lien invalide, ou message situé dans un autre salon que celui-ci.",
        });
        return;
      }

      // On vérifie que la cible existe AVANT de supprimer quoi que ce soit :
      // sans ce contrôle, une faute de frappe dans le lien vidait le salon.
      const anchor = await interaction.channel.messages
        .fetch(target.messageId)
        .catch(() => null);
      if (!anchor) {
        await interaction.editReply({
          content: "❌ Message introuvable dans ce salon, aucune suppression effectuée.",
        });
        return;
      }

      let removed = 0;
      let reachedAnchor = false;
      while (removed < MAX_UNTIL_LINK && !reachedAnchor) {
        const batch = await interaction.channel.messages.fetch({
          limit: Math.min(MAX_BULK, MAX_UNTIL_LINK - removed),
        });
        if (batch.size === 0) break;

        const toDelete = [];
        for (const message of batch.values()) {
          if (message.id === target.messageId) {
            reachedAnchor = true;
            break;
          }
          toDelete.push(message);
        }
        if (toDelete.length === 0) break;

        const deleted = await interaction.channel.bulkDelete(toDelete, true);
        removed += deleted.size;
        // Plus rien de supprimable (messages trop anciens) : on s'arrête plutôt
        // que de boucler indéfiniment sur le même lot.
        if (deleted.size === 0) break;
      }

      log(`/purge par ${interaction.user.tag} : ${removed} message(s)`);
      await interaction.editReply({
        content: reachedAnchor
          ? `🧹 ${removed} message(s) supprimé(s) jusqu'au message ciblé.`
          : `🧹 ${removed} message(s) supprimé(s). Limite atteinte avant le message ciblé (${MAX_UNTIL_LINK} max, ou messages de plus de 14 jours).`,
      });
    } catch (err) {
      handleException(err);
      await interaction
        .editReply({ content: "❌ La purge a échoué." })
        .catch(() => {});
    }
  },
};
