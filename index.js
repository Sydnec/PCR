import { Client, Collection, GatewayIntentBits } from "discord.js"; // , Events, Routes, REST
import cron from "node-cron";
import dotenv from "dotenv";
import { readdirSync } from "fs";
import { handleException, error } from "./modules/utils.js";

try {
  const bot = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      // GatewayIntentBits.GuildMessageReactions,
      // GatewayIntentBits.DirectMessageReactions,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
      // GatewayIntentBits.GuildVoiceStates,
    ],
  });
  dotenv.config();

  bot.commands = new Collection();
  bot.commandsArray = [];
  bot.buttons = new Collection();
  bot.combotMessagesCount = 0;

  const functionFiles = readdirSync("./functions").filter((file) =>
    file.endsWith(".js")
  );
  for (const file of functionFiles) {
    const { default: importedFunction } = await import(`./functions/${file}`);
    importedFunction(bot);
  }

  bot.handleEvents();
  bot.handleCommands();

  bot.login(process.env.DISCORD_TOKEN);

  cron.schedule(process.env.AVENT_CRON_TIMER, () => {
    bot.handleMoodPollOnTimer();
  });

  bot.on("error", error);
} catch (e) {
  handleException(e);
}

process.on("unhandledRejection", (e) => {
  handleException(e);
});
