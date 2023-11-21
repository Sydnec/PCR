import { REST, EmbedBuilder, Routes } from "discord.js";
import { readdirSync } from "fs";
import dotenv from "dotenv";
dotenv.config();

/**
 * retourne un numéro sur une plage maximum
 * @param {int} max valeur max
 * @returns nombre entre 0 et max
 */
function getRandomInt(max) {
  return Math.floor(Math.random() * max);
}

function embed(index, tab, credits) {
  const toSend = tab[index];
  return (
    new EmbedBuilder()
      // https://discordjs.guide/popular-topics/embeds.html#embed-preview
      .setColor(0x0099ff)
      .setTitle(toSend.nom)
      .setDescription("Signification: " + toSend.signification)
      .setImage(toSend.imageurl)
      .setTimestamp()
      .setFooter({
        text: credits,
        icon_url: "https://precoce-radio.fr/assets/images/poncefleur.png",
      })
  );
}

function isAdmin(message) {
  // check if the message author is an admin using ADMIN_ROLE_ID
  return message.member.roles.cache.has(process.env.ADMIN_ROLE_ID);
}

const getCommand = (message = "") =>
  message.replace(/\s+/, "\x01").split("\x01"); // Créer un tableau avec le séparateur ' '

async function registerCommands() {
  const commandFiles = readdirSync("./commands/").filter((file) =>
    file.endsWith(".js")
  );

  const commands = [];
  for (const file of commandFiles) {
    const command = require(`../commands/${file}`);
    if (command.slashData && !command.onlyAdmin) {
      commands.push(command.slashData.toJSON());
    }
  }

  const rest = new REST({ version: "9" }).setToken(process.env.DISCORD_TOKEN);
  try {
    log("Started refreshing application (/) commands.");

    if (environmentIsProd()) {
      await rest.put(Routes.applicationCommands(process.env.DICORD_CLIENT_ID), {
        body: commands,
      });
    } else {
      await rest.put(
        Routes.applicationGuildCommands(
          process.env.DICORD_CLIENT_ID,
          process.env.DICORD_GUILD_ID
        ),
        {
          body: commands,
        }
      );
      log("[DEV] application (/) locally.");
    }
    log("Successfully reloaded application (/) commands.");
  } catch (e) {
    handleException(e);
  }
}

function randomNum(min = 0, max = 1) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }

  return array;
}

function environmentIsProd() {
  return process.env.ENV === "production";
}

function handleException(e) {
  log("called handleException", e);
  error(`[${new Date()}] ${e}`);
}

function log(message) {
  console.log(`[${new Date()}] ${message}`);
}

function error(e) {
  console.error(`[${new Date()}] ${e}`);
}

export {
  getRandomInt,
  embed,
  isAdmin,
  registerCommands,
  getCommand,
  randomNum,
  shuffleArray,
  environmentIsProd,
  handleException,
  log,
  error,
};
