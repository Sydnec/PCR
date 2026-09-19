// Membres porteurs du rôle par défaut.
//
// Trois appelants en ont besoin (/admin points-tous, le pot commun,
// randomizabaise) et tous tombaient dans le même piège : guild.members.cache
// n'est pas garanti complet. Sans le fetch préalable, la liste se limite aux
// membres que Discord a bien voulu envoyer — un tirage ou une distribution
// n'aurait alors porté que sur une partie du serveur, sans le dire.
//
// Les bots sont exclus. guildMemberAdd leur pose le rôle par défaut comme à
// tout le monde, alors que messageCreate leur refuse le moindre point : un bot
// ne cotise donc jamais et touchait pourtant sa part à chaque pot, sans pouvoir
// la dépenser. Trois bots sur quarante membres, c'est 7 % de la masse qui
// quittait la circulation chaque semaine, définitivement.
import dotenv from "dotenv";
dotenv.config(); // process.env.CONSTANT

// Rend { role, members }. En cas d'empêchement, rend { reason } : une phrase
// nue, sans préfixe ni décoration — c'est à l'appelant de la présenter, et les
// trois le faisaient chacun à leur façon, jusqu'à afficher « ❌ ❌ ».
export async function fetchRoleMembers(guild, roleId = process.env.DEFAULT_ROLE_ID) {
  if (!guild) return { reason: "Cette action doit se faire depuis un serveur." };

  const role = guild.roles.cache.get(roleId);
  if (!role) return { reason: "`DEFAULT_ROLE_ID` est introuvable sur ce serveur." };

  await guild.members.fetch();
  const members = [
    ...guild.members.cache
      .filter((member) => member.roles.cache.has(role.id) && !member.user?.bot)
      .values(),
  ];
  if (!members.length) return { role, reason: `Personne ne porte le rôle **${role.name}**.` };

  return { role, members };
}
