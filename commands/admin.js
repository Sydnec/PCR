import { PermissionFlagsBits, SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException, isAdmin } from "../modules/utils.js";

import points from "./admin/points.js";
import pointsTous from "./admin/points-tous.js";
import config from "./admin/config.js";
import configVoir from "./admin/config-voir.js";
import potcommun from "./admin/potcommun.js";
import purge from "./admin/purge.js";
import pokespawn from "./admin/pokespawn.js";
import safarispawn from "./admin/safarispawn.js";
import restart from "./admin/restart.js";

// Routeur des commandes d'administration. Chaque sous-commande garde son propre
// fichier dans commands/admin/ — un répertoire que le chargeur ignore, puisqu'il
// ne retient que les .js à la racine de commands/.
//
// Regrouper sert deux choses : la liste des commandes visible par tout le monde
// cesse d'être polluée, et la garde isAdmin, qui était recopiée dans chaque
// commande, n'existe plus qu'ici.
const SUBCOMMANDS = [
  points,
  pointsTous,
  config,
  configVoir,
  potcommun,
  purge,
  pokespawn,
  safarispawn,
  restart,
];

const byName = new Map(SUBCOMMANDS.map((sub) => [sub.name, sub]));

export default {
  data: SUBCOMMANDS.reduce(
    (builder, sub) => builder.addSubcommand(sub.describe),
    new SlashCommandBuilder()
      .setName("admin")
      .setDescription("Administration du bot")
      // Discord masque la commande aux non-administrateurs. C'est du confort,
      // pas une sécurité : un serveur peut rouvrir la permission, d'où la garde
      // isAdmin ci-dessous qui, elle, fait foi.
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  ),

  async autocomplete(interaction, bot) {
    const sub = byName.get(interaction.options.getSubcommand());
    if (!sub?.autocomplete) return;
    try {
      await sub.autocomplete(interaction, bot);
    } catch (error) {
      handleException(error);
    }
  },

  async execute(interaction, bot) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({
        content: "❌ Cette commande est réservée aux administrateurs.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = byName.get(interaction.options.getSubcommand());
    if (!sub) return;

    // Toutes répondent en éphémère et prennent le temps d'écrire en base ou
    // d'interroger Discord : on diffère ici, une fois pour toutes, plutôt que
    // dans chacune.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Filet unique. Les sous-commandes portaient chacune le leur, soit huit
    // copies du même try/catch : ici, une seule, et le message nomme la
    // coupable au lieu d'un « une erreur est survenue » anonyme.
    try {
      await sub.execute(interaction, bot);
    } catch (error) {
      handleException(`/admin ${sub.name} :`, error);
      await interaction
        .editReply({ content: `❌ Erreur pendant \`/admin ${sub.name}\`, voir les logs.` })
        .catch(() => {});
    }
  },
};
