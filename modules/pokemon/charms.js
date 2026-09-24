// Le Charme Chroma, un par génération. Il récompense le Pokédex complet d'une
// génération — hors légendaires et fabuleux, qu'on ne chasse pas — et son
// porteur voit plus de shiny parmi les Pokémon de cette génération
// (pokemon.shinyCharm.multiplier) : apparitions, parc safari, œufs.
//
// C'est un objet d'inventaire, donné une fois pour toutes : le dernier
// exemplaire d'une espèce ne part jamais, donc un Pokédex complété le reste, et
// l'objet évite de recompter la collection à chaque apparition. La
// vérification suit chaque arrivée d'une espèce dans une boîte (creditSpecies,
// restoreDuplicates), et le démarrage rattrape ce qui aurait pu lui échapper.
//
// Sur Discord, les porteurs qui ont le rôle Pokémon (POKEMON_ROLE_ID) reçoivent
// aussi le rôle du charme de leur génération (SHINY_CHARM_ROLE_ID_<génération>),
// mentionné quand une apparition brille pour eux : qui ne veut pas des pings du
// jeu n'a pas ceux du charme non plus. L'objet fait foi ; le rôle n'en est que
// le reflet, réparé au démarrage et quand l'un des rôles change.
import { RESTJSONErrorCodes } from "discord.js";
import db from "../points-db.js";
import { handleException, log } from "../utils.js";
import { pseudo } from "../pseudo.js";
import {
  activeGeneration,
  allSpeciesData,
  charmMultiplier,
  charmRoleId,
  isLegendary,
} from "./data.js";
import { getCharmItem, getItems, grantItemOnce } from "./items.js";
import { resolveChannel } from "./spawn.js";

// Le client se déclare au démarrage (clientReady) : les annonces et les rôles
// en ont besoin, et les modules du jeu qui donnent une espèce n'en ont pas
// toujours un sous la main.
let bot = null;
export function setCharmClient(client) {
  bot = client;
}

// Les espèces qu'il faut posséder pour le charme d'une génération.
export const charmSpecies = (generation) =>
  allSpeciesData().filter(
    (species) => species.generation === Number(generation) && !isLegendary(species)
  );

// « 1re », « 2e » : l'ordinal d'une génération, pour les messages.
export const generationOrdinal = (generation) =>
  Number(generation) === 1 ? "1re" : `${generation}e`;

// Les générations dont `userId` porte le charme.
export function getCharms(userId, cb) {
  const byKey = new Map(
    getItems()
      .filter((item) => item.charm)
      .map((item) => [item.key, Number(item.charm.generation)])
  );
  db.all(
    "SELECT item_key FROM pokemon_inventory WHERE user_id = ? AND count > 0",
    [String(userId)],
    (err, rows) => {
      if (err) return cb(err, []);
      cb(null, (rows ?? []).map((row) => byKey.get(row.item_key)).filter(Boolean));
    }
  );
}

// Donne à `userId` le charme des générations dont il possède désormais toutes
// les espèces requises. Sûr à appeler aussi souvent qu'on veut : le don est une
// écriture gardée (grantItemOnce), et seul celui qui le donne l'annonce.
export function checkCharms(userId, cb = () => {}) {
  db.all(
    "SELECT DISTINCT species_id FROM pokemon_owned WHERE user_id = ?",
    [String(userId)],
    (err, rows) => {
      if (err) {
        handleException("Vérification des Charmes Chroma :", err);
        return cb(err, []);
      }
      const owned = new Set((rows ?? []).map((row) => row.species_id));
      const earned = [];
      // Une génération fermée n'a pas de charme : ses espèces ne sont pas encore
      // dans le jeu.
      for (let generation = 1; generation <= activeGeneration(); generation++) {
        const item = getCharmItem(generation);
        const needed = charmSpecies(generation);
        if (item && needed.length && needed.every((species) => owned.has(species.id))) {
          earned.push({ generation, item, count: needed.length });
        }
      }
      if (!earned.length) return cb(null, []);

      const granted = [];
      let pending = earned.length;
      for (const charm of earned) {
        grantItemOnce(userId, charm.item.key, { source: `pokedex:${charm.generation}` }, (err, isNew) => {
          if (err) handleException("Don d'un Charme Chroma :", err);
          else if (isNew) {
            granted.push(charm);
            announceCharm(userId, charm);
          }
          if (--pending > 0) return;
          if (granted.length) syncCharmRoles(userId);
          cb(null, granted);
        });
      }
    }
  );
}

async function announceCharm(userId, { generation, item, count }) {
  pseudo(userId).then((name) =>
    log(`Charme Chroma : ${name} complète le Pokédex de la génération ${generation}`)
  );
  if (!bot) return;
  try {
    const channel = await resolveChannel(bot);
    if (!channel) return;
    await channel.send({
      content:
        `🎉 <@${userId}> complète le Pokédex de la ${generationOrdinal(generation)} génération ` +
        `— ${count.toLocaleString("fr-FR")} espèces, hors légendaires — et reçoit le ` +
        `${item.emoji} **${item.label}** : chances de shiny ×${charmMultiplier()} sur les ` +
        `Pokémon de cette génération !`,
      allowedMentions: { users: [String(userId)] },
    });
  } catch (error) {
    handleException("Annonce d'un Charme Chroma :", error);
  }
}

// Aligne les rôles de charme d'un membre sur ce qu'il porte : un rôle par
// charme, s'il a le rôle Pokémon, aucun sinon. `member` évite de le relire
// quand l'appelant l'a déjà (guildMemberUpdate).
export function syncCharmRoles(userId, { member = null } = {}) {
  getCharms(userId, async (err, charms) => {
    // Une lecture ratée ne retire rien : mieux vaut un rôle de trop un moment
    // qu'un porteur privé de son ping.
    if (err) return handleException("Lecture des Charmes Chroma :", err);
    try {
      const target =
        member ?? (await (await bot?.guilds.fetch(process.env.GUILD_ID))?.members.fetch(userId));
      if (!target) return;
      const pokemonRole = process.env.POKEMON_ROLE_ID;
      const wantsPings = Boolean(pokemonRole) && target.roles.cache.has(pokemonRole);
      for (const item of getItems().filter((entry) => entry.charm)) {
        const generation = Number(item.charm.generation);
        const roleId = charmRoleId(generation);
        if (!roleId) continue;
        const should = wantsPings && charms.includes(generation);
        const has = target.roles.cache.has(roleId);
        if (should && !has) await target.roles.add(roleId, "Charme Chroma");
        if (!should && has) await target.roles.remove(roleId, "Plus de Charme Chroma ou de rôle Pokémon");
      }
    } catch (error) {
      // Parti du serveur : il n'y a plus de rôle à régler.
      if (error?.code === RESTJSONErrorCodes.UnknownMember) return;
      handleException("Rôles du Charme Chroma :", error);
    }
  });
}

// Au démarrage : les charmes que la vérification n'aurait pas encore donnés
// (dresseurs complets avant son arrivée), puis les rôles — ceux des porteurs,
// et ceux qu'un membre aurait sans y avoir droit.
export function repairCharms(client) {
  setCharmClient(client);
  db.all("SELECT DISTINCT user_id FROM pokemon_owned", [], async (err, rows) => {
    if (err) return handleException("Rattrapage des Charmes Chroma :", err);
    for (const { user_id: userId } of rows ?? []) {
      await new Promise((resolve) => checkCharms(userId, resolve));
    }

    const keys = getItems()
      .filter((item) => item.charm)
      .map((item) => item.key);
    if (!keys.length) return;
    db.all(
      `SELECT DISTINCT user_id FROM pokemon_inventory
        WHERE count > 0 AND item_key IN (${keys.map(() => "?").join(", ")})`,
      keys,
      async (err, holders) => {
        if (err) return handleException("Lecture des porteurs de Charme Chroma :", err);
        const ids = new Set((holders ?? []).map((row) => row.user_id));
        for (const userId of ids) syncCharmRoles(userId);
        try {
          const guild = await client.guilds.fetch(process.env.GUILD_ID);
          await guild.members.fetch();
          for (const item of getItems().filter((entry) => entry.charm)) {
            const roleId = charmRoleId(item.charm.generation);
            const role = roleId ? await guild.roles.fetch(roleId) : null;
            for (const member of role?.members.values() ?? []) {
              if (!ids.has(member.id)) syncCharmRoles(member.id, { member });
            }
          }
        } catch (error) {
          handleException("Réparation des rôles du Charme Chroma :", error);
        }
      }
    );
  });
}
