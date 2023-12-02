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
                                if (event.once) {
                                    bot.once(event.name, (...args) => {
                                        try {
                                            event.execute(...args, bot);
                                        } catch (e) {
                                            handleException(e);
                                        }
                                    });
                                } else {
                                    bot.on(event.name, (...args) => {
                                        try {
                                            event.execute(...args, bot);
                                        } catch (e) {
                                            handleException(e);
                                        }
                                    });
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
