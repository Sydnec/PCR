import { PermissionFlagsBits, SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException, isAdmin } from "../modules/utils.js";

import points from "./admin/points.js";
import pointsTous from "./admin/points-tous.js";
import item from "./admin/item.js";
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
  item,
  config,
  configVoir,
  potcommun,
  purge,
  pokespawn,
  safarispawn,
  restart,
];

const data = SUBCOMMANDS.reduce(
  (builder, sub) => builder.addSubcommand(sub.describe),
  new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Administration du bot")
    // Discord masque la commande aux non-administrateurs. C'est du confort,
    // pas une sécurité : un serveur peut rouvrir la permission, d'où la garde
    // isAdmin ci-dessous qui, elle, fait foi.
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
);

// Les noms viennent du descripteur construit, pas d'un champ recopié à côté :
// une seule source de vérité. Un `.setName()` renommé sans son jumeau donnait
// sinon une sous-commande que Discord accepte et que le routeur ne trouve pas —
// silence complet côté utilisateur.
const byName = new Map(data.options.map((option, index) => [option.name, SUBCOMMANDS[index]]));

export default {
  data,

  // La garde vaut pour LES DEUX portes. L'autocomplétion de /admin config
  // énumère la configuration vivante : la laisser ouverte pendant qu'execute
  // est gardée, c'est verrouiller la porte et laisser la fenêtre.
  async autocomplete(interaction, bot) {
    if (!isAdmin(interaction.member)) return interaction.respond([]).catch(() => {});
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

    const name = interaction.options.getSubcommand();
    const sub = byName.get(name);
    if (!sub) {
      // Ne peut arriver qu'après un déploiement partiel. Répondre quand même :
      // un `return` nu laissait Discord afficher « l'application n'a pas
      // répondu », sans la moindre trace côté bot.
      handleException(`/admin : sous-commande inconnue « ${name} »`);
      return interaction.reply({
        content: `❌ \`${name}\` est introuvable. Le bot n'est peut-être pas à jour.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Toutes répondent en éphémère et prennent le temps d'écrire en base ou
    // d'interroger Discord : on diffère ici, une fois pour toutes, plutôt que
    // dans chacune.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Filet unique. Les sous-commandes portaient chacune le leur, soit neuf
    // copies du même try/catch : ici, une seule, et le message nomme la
    // coupable au lieu d'un « une erreur est survenue » anonyme.
    try {
      await sub.execute(interaction, bot);
    } catch (error) {
      handleException(`/admin ${name} :`, error);
      await interaction
        .editReply({ content: `❌ Erreur pendant \`/admin ${name}\`, voir les logs.` })
        .catch(() => {});
    }
  },
};
