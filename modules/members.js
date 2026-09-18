// Membres porteurs du rôle par défaut.
//
// Trois appelants en ont besoin (/admin points-tous, le pot commun,
// randomizabaise) et tous tombaient dans le même piège : guild.members.cache
// n'est pas garanti complet. Sans le fetch préalable, la liste se limite aux
// membres que Discord a bien voulu envoyer — un tirage ou une distribution
// n'aurait alors porté que sur une partie du serveur, sans le dire.
import dotenv from "dotenv";
dotenv.config(); // process.env.CONSTANT

// Rend { role, members } — members est un tableau, jamais vide si role existe
// et que quelqu'un le porte. Rend { error } sinon, à afficher tel quel.
export async function fetchRoleMembers(guild, roleId = process.env.DEFAULT_ROLE_ID) {
  if (!guild) return { error: "❌ Cette action doit se faire depuis un serveur." };

  const role = guild.roles.cache.get(roleId);
  if (!role) return { error: "❌ `DEFAULT_ROLE_ID` est introuvable sur ce serveur." };

  await guild.members.fetch();
  const members = [...guild.members.cache.filter((m) => m.roles.cache.has(role.id)).values()];
  if (!members.length) return { role, error: `❌ Personne ne porte le rôle **${role.name}**.` };

  return { role, members };
}
