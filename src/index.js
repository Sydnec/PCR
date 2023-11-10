// bot.mjs
import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';

// Charge les variables d'environnement depuis le fichier .env
dotenv.config();

const client = new Client({
    intents: [
    ],
  });

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.login(process.env.BOT_TOKEN);