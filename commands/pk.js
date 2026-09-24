import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { handleException } from "../modules/utils.js";

import pokedex from "./pk/pokedex.js";
import boite from "./pk/boite.js";
import doublons from "./pk/doublons.js";
import info from "./pk/info.js";
import classement from "./pk/classement.js";
import evolution from "./pk/evolution.js";
import echange from "./pk/echange.js";
import oeuf from "./pk/oeuf.js";
import revendre from "./pk/revendre.js";
import verrou from "./pk/verrou.js";
import inventaire from "./pk/inventaire.js";
import loterie from "./pk/loterie.js";
import safari from "./pk/safari.js";
import web from "./pk/web.js";

// Routeur du jeu Pokémon : toutes ses commandes vivent sous /pk, comme celles
// d'administration sous /admin. Chaque sous-commande garde son fichier dans
// commands/pk/ — un répertoire que le chargeur ignore, puisqu'il ne retient
// que les .js à la racine de commands/.
//
// Deux d'entre elles ont leurs propres sous-commandes (/pk revendre pokemon,
// /pk oeuf pondre) : elles déclarent `group: true` et deviennent des groupes.
const SUBCOMMANDS = [
  pokedex,
  boite,
  doublons,
  info,
  classement,
  evolution,
  echange,
  oeuf,
  revendre,
  verrou,
  inventaire,
  loterie,
  safari,
  web,
];

const data = SUBCOMMANDS.reduce(
  (builder, sub) =>
    sub.group ? builder.addSubcommandGroup(sub.describe) : builder.addSubcommand(sub.describe),
  new SlashCommandBuilder()
    .setName("pk")
    .setDescription("Le jeu Pokémon : Pokédex, boîte, évolutions, échanges, œufs…")
);

// Les noms viennent du descripteur construit, comme pour /admin : une seule
// source de vérité, et un renommage ne peut pas laisser le routeur derrière.
const byName = new Map(data.options.map((option, index) => [option.name, SUBCOMMANDS[index]]));

// Un groupe se reconnaît à son nom de groupe, une sous-commande simple au sien.
const route = (interaction) => {
  const name =
    interaction.options.getSubcommandGroup(false) ?? interaction.options.getSubcommand(false);
  return { name, sub: byName.get(name) };
};

export default {
  data,

  async autocomplete(interaction, bot) {
    const { sub } = route(interaction);
    if (!sub?.autocomplete) return interaction.respond([]).catch(() => {});
    try {
      await sub.autocomplete(interaction, bot);
    } catch (error) {
      handleException(error);
    }
  },

  async execute(interaction, bot) {
    const { name, sub } = route(interaction);
    if (!sub) {
      // Ne peut arriver qu'après un déploiement partiel. Répondre quand même,
      // plutôt que de laisser Discord dire que l'application n'a pas répondu.
      handleException(`/pk : sous-commande inconnue « ${name} »`);
      return interaction
        .reply({
          content: `❌ \`${name}\` est introuvable. Le bot n'est peut-être pas à jour.`,
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
    try {
      await sub.execute(interaction, bot);
    } catch (error) {
      handleException(`/pk ${name} :`, error);
    }
  },
};
