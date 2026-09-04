import { readdirSync } from 'fs';
import { handleException, log } from '../../modules/utils.js';

export default (bot) => {
    bot.handleEvents = async () => {
        const eventsFolders = readdirSync(`./events`);
        for (const folder of eventsFolders) {
            const eventsFiles = readdirSync(`./events/${folder}`).filter(
                (file) => file.endsWith('.js')
            );

            switch (folder) {
                case 'client':
                    for (const file of eventsFiles) {
                        import(`../../events/${folder}/${file}`)
                            .then((eventModule) => {
                                const event =
                                    eventModule.default || eventModule;
                                // `execute` est asynchrone : un try/catch
                                // synchrone n'attrape que ce qui échoue avant le
                                // premier await. Tout le reste partait en rejet
                                // non géré, sans indiquer l'événement fautif.
                                const invoke = (...args) => {
                                    try {
                                        const result = event.execute(...args, bot);
                                        if (result && typeof result.then === 'function') {
                                            result.catch((e) =>
                                                handleException(`Événement ${event.name} :`, e)
                                            );
                                        }
                                    } catch (e) {
                                        handleException(`Événement ${event.name} :`, e);
                                    }
                                };
                                if (event.once) {
                                    bot.once(event.name, invoke);
                                } else {
                                    bot.on(event.name, invoke);
                                }
                                log(`Registered event: ${file}`);
                            })
                            .catch((e) => {
                                // Gère les erreurs liées à l'importation
                                handleException(`Error importing event ${file}: ${e}`);
                            });
                    }
                    break;
            }
        }
    };
};
