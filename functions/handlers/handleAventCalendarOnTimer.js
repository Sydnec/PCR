import { handleException, error, log } from "../../modules/utils.js";

export default (bot) => {
  bot.handleAventCalendarOnTimer = async () => {
    const channel = bot.channels.cache.get(process.env.AVENT_CHANNEL_ID);
    if (channel) {
      // get old message and delete it
      
      // write the new message
      
    }
  };
};
