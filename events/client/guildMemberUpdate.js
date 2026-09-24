import { charmRoleId } from '../../modules/pokemon/data.js';
import { syncCharmRoles } from '../../modules/pokemon/charms.js';
import { getItems } from '../../modules/pokemon/items.js';
import { handleException } from '../../modules/utils.js';

const name = 'guildMemberUpdate';
const once = false;

// Les rôles du Charme Chroma suivent les changements du rôle Pokémon : qui le
// retire ne veut plus des pings du jeu, qui le reprend les retrouve. Un rôle de
// charme donné à la main reste à un porteur, même sans rôle Pokémon, et part
// chez qui n'a pas le charme (syncCharmRoles). La synchronisation ne change rien
// quand tout est déjà juste : ses propres modifications, qui reviennent ici,
// s'arrêtent d'elles-mêmes.
async function execute(oldMember, newMember) {
    try {
        const watched = [
            process.env.POKEMON_ROLE_ID,
            ...getItems()
                .filter((item) => item.charm)
                .map((item) => charmRoleId(item.charm.generation)),
        ].filter(Boolean);
        // Un ancien membre absent du cache arrive partiel : on synchronise,
        // sans conclure qu'il a quitté le rôle Pokémon.
        const changed =
            oldMember.partial ||
            watched.some((roleId) => oldMember.roles.cache.has(roleId) !== newMember.roles.cache.has(roleId));
        const pokemonRole = process.env.POKEMON_ROLE_ID;
        const leftPokemonRole =
            !oldMember.partial &&
            Boolean(pokemonRole) &&
            oldMember.roles.cache.has(pokemonRole) &&
            !newMember.roles.cache.has(pokemonRole);
        if (changed) syncCharmRoles(newMember.id, { member: newMember, leftPokemonRole });
    } catch (error) {
        handleException(error);
    }
}

export { name, once, execute };
