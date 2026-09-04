import { Client, Collection, GatewayIntentBits, Partials } from "discord.js";
import { readdirSync } from "fs";
import { handleException, log } from "./modules/utils.js";
import cron from "node-cron";
import dotenv from "dotenv";
dotenv.config();

// Programme une tâche cron sans laisser une variable d'environnement absente ou
// mal formée interrompre le démarrage.
//
// Auparavant tout le bloc vivait dans un unique try : un ADVENT_CRON_TIMER
// manquant faisait lever cron.schedule, et les planifications suivantes — dont
// la vérification des rappels toutes les minutes — n'étaient JAMAIS enregistrées.
function scheduleCron(label, expression, task) {
  if (!expression) {
    log(`⚠️ ${label} non configuré, tâche planifiée ignorée`);
    return null;
  }
  try {
    const job = cron.schedule(expression, task);
    log(`Tâche planifiée : ${label} (${expression})`);
    return job;
  } catch (error) {
    handleException(`Expression cron invalide pour ${label} :`, error);
    return null;
  }
}

async function main() {
  const bot = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildInvites,
    ],
    // Sans ces partials, Discord.js n'émet pas messageReactionAdd/Remove pour
    // les messages absents du cache. Le message des rôles étant par nature
    // ancien, la distribution de rôles par réaction ne se déclenchait jamais
    // après un redémarrage.
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
      Partials.User,
      Partials.GuildMember,
    ],
  });

  bot.commands = new Collection();
  bot.commandsArray = [];
  bot.buttons = new Collection();

  // Cache des invitations : guildId -> Map(code -> nombre d'utilisations).
  bot.invites = new Map();

  bot.on("clientReady", async () => {
    bot.user.setActivity("PCR Bot", { type: "WATCHING" });

    // Chargement du cache des invitations. `forEach(async …)` ne rendait aucune
    // promesse : un serveur sans permission « Gérer le serveur » produisait un
    // rejet non géré et laissait le cache vide.
    await Promise.all(
      bot.guilds.cache.map(async (guild) => {
        try {
          const invites = await guild.invites.fetch();
          bot.invites.set(
            guild.id,
            new Map(invites.map((invite) => [invite.code, invite.uses ?? 0]))
          );
        } catch (error) {
          // Permission manquante : le suivi des invitations est simplement
          // indisponible pour ce serveur, ce n'est pas fatal.
          log(
            `⚠️ Invitations illisibles pour ${guild.name} : suivi désactivé (${error.message})`
          );
          bot.invites.set(guild.id, new Map());
        }
      })
    );
  });

  const functionFolders = readdirSync("./functions");
  for (const folder of functionFolders) {
    const functionFiles = readdirSync(`./functions/${folder}`).filter((file) =>
      file.endsWith(".js")
    );
    for (const file of functionFiles) {
      const { default: importedFunction } = await import(
        `./functions/${folder}/${file}`
      );
      importedFunction(bot);
    }
  }

  bot.handleEvents();
  bot.handleCommands();

  if (!process.env.DISCORD_TOKEN) {
    throw new Error("DISCORD_TOKEN est absent de l'environnement.");
  }
  await bot.login(process.env.DISCORD_TOKEN);

  scheduleCron("ADVENT_CRON_TIMER", process.env.ADVENT_CRON_TIMER, () => {
    bot.handleAdventCalendarOnTimer();
  });

  scheduleCron("COTD_CRON_TIMER", process.env.COTD_CRON_TIMER, () => {
    bot.handleCOTDOnTimer();
  });

  // if (process.env.ANNUAL_RECAP_CRON_TIMER) {
  //   scheduleCron("ANNUAL_RECAP_CRON_TIMER", process.env.ANNUAL_RECAP_CRON_TIMER, () => {
  //     bot.handleAnnualRecapOnTimer();
  //   });
  // }

  // Vérifier les rappels toutes les minutes.
  scheduleCron("rappels", "* * * * *", () => {
    bot.handleRemindersOnTimer();
  });

  bot.on("error", (e) => {
    handleException(e);
  });
}

main().catch((e) => {
  handleException(e);
  process.exit(1);
});

process.on("unhandledRejection", (e) => {
  handleException(e);
});

// On journalise avant de mourir : sans ce gestionnaire, l'erreur fatale
// disparaissait avec le processus. On sort quand même — après une exception non
// interceptée l'état du processus n'est plus fiable, et PM2 redémarre proprement.
process.on("uncaughtException", (e) => {
  handleException("Exception non interceptée :", e);
  process.exit(1);
});
