import { readdirSync } from "fs";
import { handleException, log } from "../../modules/utils.js";

export default (bot) => {
  bot.handleEvents = async () => {
    const eventsFolders = readdirSync(`./events`);
    for (const folder of eventsFolders) {
      const eventsFiles = readdirSync(`./events/${folder}`).filter((file) =>
        file.endsWith(".js")
      );
      switch (folder) {
        case "client":
          for (const file of eventsFiles) {
            const event = require(`../../events/${folder}/${file}`);
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
            log(`registered event: ${file}`);
          }
          break;
      }
    }
  };
};
