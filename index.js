import { Client, Collection, GatewayIntentBits } from "discord.js";
import { readdirSync } from "fs";
import { handleException, log } from "./modules/utils.js";
import cron from "node-cron";
import dotenv from "dotenv";
dotenv.config();

try {
  const bot = new Client({
    // Le bot relaie du texte écrit par les membres (/safe-place, /poll, /week,
    // /edit, remplacement des liens twitter/instagram, contenus récupérés en
    // ligne par /cotd). Sans garde-fou, n'importe qui pouvait y glisser
    // « @everyone » et se servir du bot pour mentionner tout le serveur.
    // parse: users + roles conserve les pings volontaires (dresseurs, paris)
    // et bloque @everyone/@here quelle qu'en soit la provenance.
    allowedMentions: { parse: ["users", "roles"] },
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });

  bot.commands = new Collection();
  bot.commandsArray = [];
  bot.buttons = new Collection();

  // Initialize invite cache
  bot.invites = new Map();

  bot.on("clientReady", async () => {
    bot.user.setActivity("PCR Bot", { type: "WATCHING" });

    // Load and cache invites. Sans droit « Gérer le serveur », la requête
    // échoue : on l'ignore plutôt que de laisser un rejet non capturé.
    bot.guilds.cache.forEach(async (guild) => {
      const firstInvites = await guild.invites.fetch().catch(() => null);
      if (!firstInvites) {
        return handleException(
          `Invitations illisibles sur ${guild.name} : suivi des invitations désactivé`
        );
      }
      bot.invites.set(
        guild.id,
        new Map(firstInvites.map((invite) => [invite.code, invite.uses]))
      );
    });
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

  bot.login(process.env.DISCORD_TOKEN);

  // Planification défensive : node-cron lève sur une expression absente ou
  // invalide. Comme tous les cron étaient enregistrés à la suite, une seule
  // variable d'environnement manquante interrompait la séquence et privait le
  // bot des minuteries suivantes — rappels et fuite des Pokémon compris.
  const schedule = (expression, name, task) => {
    if (!expression) {
      return log(`⚠️ ${name} non planifié : expression cron absente`);
    }
    if (!cron.validate(expression)) {
      return handleException(`Expression cron invalide pour ${name} : ${expression}`);
    }
    cron.schedule(expression, task);
  };

  schedule(process.env.ADVENT_CRON_TIMER, "calendrier de l'avent", () => {
    bot.handleAdventCalendarOnTimer();
  });

  schedule(process.env.COTD_CRON_TIMER, 'saints du jour', () => {
    bot.handleCOTDOnTimer();
  });

  // if (process.env.ANNUAL_RECAP_CRON_TIMER) {
  //   cron.schedule(process.env.ANNUAL_RECAP_CRON_TIMER, () => {
  //     bot.handleAnnualRecapOnTimer();
  //   });
  // }

  // Vérifier les rappels toutes les minutes
  cron.schedule("* * * * *", () => {
    bot.handleRemindersOnTimer();
  });

  // Faire fuir les Pokémon dont la durée de vie est écoulée. Indépendant de
  // l'activité du serveur, sinon un salon silencieux ne les délogerait jamais.
  cron.schedule("* * * * *", () => {
    bot.handlePokemonFleeOnTimer();
  });

  bot.on("error", (e) => {
    handleException(e);
  });
} catch (e) {
  handleException(e);
}

process.on("unhandledRejection", (e) => {
  handleException(e);
});
