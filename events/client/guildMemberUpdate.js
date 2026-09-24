import { charmRoleId } from '../../modules/pokemon/data.js';
import { syncCharmRoles } from '../../modules/pokemon/charms.js';
import { getItems } from '../../modules/pokemon/items.js';
import { handleException } from '../../modules/utils.js';

const name = 'guildMemberUpdate';
const once = false;

// Les rôles du Charme Chroma suivent le rôle Pokémon : qui le retire ne veut
// plus des pings du jeu, qui le reprend les retrouve. Un rôle de charme posé ou
// retiré à la main est remis d'accord avec l'inventaire, qui fait foi. La
// synchronisation ne change rien quand tout est déjà juste : ses propres
// modifications, qui reviennent ici, s'arrêtent d'elles-mêmes.
async function execute(oldMember, newMember) {
    try {
        const watched = [
            process.env.POKEMON_ROLE_ID,
            ...getItems()
                .filter((item) => item.charm)
                .map((item) => charmRoleId(item.charm.generation)),
        ].filter(Boolean);
        // Un ancien membre absent du cache arrive partiel : dans le doute, on
        // synchronise.
        const changed =
            oldMember.partial ||
            watched.some((roleId) => oldMember.roles.cache.has(roleId) !== newMember.roles.cache.has(roleId));
        if (changed) syncCharmRoles(newMember.id, { member: newMember });
    } catch (error) {
        handleException(error);
    }
}

export { name, once, execute };
