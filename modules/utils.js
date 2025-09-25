import { REST, Routes, PermissionsBitField, ChannelType } from 'discord.js';
import { readdirSync } from 'fs';
import { format } from 'date-fns';
import { emojiRegex } from './regex.js';
import dotenv from 'dotenv';
import axios from 'axios';
import { load } from 'cheerio';
dotenv.config();

function isAdmin(member) {
	return member.permissions.has(PermissionsBitField.Flags.Administrator);
}
const getCommand = (message = '') =>
	message.replace(/\s+/, '\x01').split('\x01'); // Créer un tableau avec le séparateur ' '
async function registerCommands() {
	const commandFiles = readdirSync('./commands/').filter((file) =>
		file.endsWith('.js')
	);

	const commands = [];
	for (const file of commandFiles) {
		try {
			const commandModule = await import(`../commands/${file}`);
			const { slashData, onlyAdmin } =
				commandModule.default || commandModule;
			if (slashData && !onlyAdmin) {
				commands.push(slashData.toJSON());
			}
		} catch (error) {
			console.error(`Erreur lors de l'import du fichier ${file}:`, error);
		}
	}

	const rest = new REST({ version: '10' }).setToken(
		process.env.DISCORD_TOKEN
	);
	try {
		log('Started refreshing application (/) commands.');
		await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
			body: commands,
		});
		log('Successfully reloaded application (/) commands.');
	} catch (e) {
		handleException(e);
	}
}
function environmentIsProd() {
	return process.env.ENV === 'production';
}
function getRoleID(roleName, guild) {
	const role = guild.roles.cache.find((role) => role.name === roleName);
	if (role) {
		return role.id;
	} else {
		return -1;
	}
}
function handleException(e) {
	error(e);
}
function log(...args) {
	const messageWithDate = [`${formatDate()} -`, ...args];
	console.log(...messageWithDate);
}
function error(...args) {
	const messageWithDate = [`${formatDate()} -`, ...args];
	console.error(...messageWithDate);
}
function formatDate() {
	const currentDate = new Date();
	return format(currentDate, 'dd/MM/yyyy HH:mm:ss');
}
async function autoAddEmojis(message) {
	try {
		const numbers = [
			'1️⃣',
			'2️⃣',
			'3️⃣',
			'4️⃣',
			'5️⃣',
			'6️⃣',
			'7️⃣',
			'8️⃣',
			'9️⃣',
			'🔟',
		];
		const content = message.content.split('\n'); //Sépare chaque ligne dans un tableau

		let i = 0;
		let emojisArray = [];
		let newEmojisArray = [];
		let newMessageString = '';
		let noEmojiLine = false;

		content.forEach((line) => {
			if (line[0] === '#') {
				newMessageString += ' ' + line + '\n';
				return;
			}

			//Analyse ligne par ligne le message d'origine
			emojisArray = line.match(emojiRegex);
			if (emojisArray === null) {
				//Aucun emoji sur la ligne
				newEmojisArray.push(numbers[i]);
				newMessageString += numbers[i] + ' ' + line + '\n';
				noEmojiLine = true;
			} else {
				//La ligne contient un/des emoji.s
				if (
					message.guild.emojis.cache.find(
						(emoji) => emoji.name === emojisArray[0].split(':')[1]
					) !== undefined ||
					!emojisArray[0].startsWith('<:')
				) {
					//L'emoji est accessible
					newEmojisArray.push(emojisArray[0]);
					newMessageString += ' ' + line + '\n';
				} else {
					//L'emoji n'est pas accessible
					newEmojisArray.push(numbers[i]);
					newMessageString +=
						numbers[i] + ' ' + line.split('>')[1] + '\n';
					noEmojiLine = true;
				}
			}
			i++;
		});
		if (noEmojiLine === true) {
			//Il y a au moins une ligne sans emoji ou avec un emoji innaccessible
			if (message.author.id === process.env.CLIENT_ID) {
				message.edit(newMessageString);
				newEmojisArray.forEach((emoji) => {
					message.react(emoji); //Ajoute les reactions
				});
			} else {
				const newMessage = await message.thread.send(newMessageString); //Message écrit par le bot
				newEmojisArray.forEach((emoji) => {
					newMessage.react(emoji); //Ajoute les reactions
				});
				await message.delete(); //Supprime le message de base
			}
		} else {
			newEmojisArray.forEach((emoji) => {
				message.react(emoji); //Ajoute les reactions
			});
		}
	} catch (e) {
		error(e);
	}
}
async function dbAddDeleteMessage(messageId, messageLink, expireAt, db) {
	const expireAtString = new Date(expireAt).toLocaleString('fr-FR', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});

	try {
		// Vérifier si le message existe déjà dans la base de données
		db.get('SELECT * FROM messages WHERE id = ?', [messageId], (err, row) => {
			if (err) {
				handleException(err);
				return;
			}
			if (row) {
				// Le message existe déjà, mettre à jour l'enregistrement
				db.run(
					'UPDATE messages SET expire_at = ? WHERE id = ?',
					[expireAt, messageId],
					(err) => {
						if (err) {
							handleException(err);
						} else {
							log(
								`(MàJ) Message programmé pour suppression le ${expireAtString} : ${messageLink}`
							);
						}
					}
				);
			} else {
				// Le message n'existe pas, insérer un nouvel enregistrement
				db.run(
					'INSERT INTO messages (id, link, expire_at) VALUES (?, ?, ?)',
					[messageId, messageLink, expireAt],
					(err) => {
						if (err) {
							handleException(err);
						} else {
							log(
								`Message programmé pour suppression le ${expireAtString} : ${messageLink}`
							);
						}
					}
				);
			}
		});
	} catch (err) {
		handleException(err);
	}
}
async function updateThreadList(guild) {
	const channel = await guild.channels.fetch(process.env.THREAD_LIST_CHANNEL_ID);

	const defaultRole = guild.roles.cache.get(process.env.DEFAULT_ROLE_ID);

	const textChannels = guild.channels.cache.filter(
		c =>
			(c.type === ChannelType.GuildText) &&
			c.permissionsFor(defaultRole)?.has(PermissionsBitField.Flags.ViewChannel)
	);

	let threadsByChannel = new Map();

	for (const [, ch] of textChannels) {
		if (ch.threads && typeof ch.threads.fetchActive === 'function') {
			// Fils actifs
			const active = await ch.threads.fetchActive();
			for (const thread of active.threads.values()) {
				if (!threadsByChannel.has(ch)) threadsByChannel.set(ch, []);
				threadsByChannel.get(ch).push(thread);
			}
			// Fils archivés publics
			const archivedPublic = await ch.threads.fetchArchived({ type: 'public' });
			for (const thread of archivedPublic.threads.values()) {
				if (!threadsByChannel.has(ch)) threadsByChannel.set(ch, []);
				// Évite les doublons
				if (!threadsByChannel.get(ch).some(t => t.id === thread.id)) {
					threadsByChannel.get(ch).push(thread);
				}
			}
		}
	}

	let threadList = '';
	const sortedChannels = Array.from(threadsByChannel.keys()).sort((a, b) => {
		if (a.parent && b.parent) {
			if (a.parent.position !== b.parent.position) {
				return a.parent.position - b.parent.position;
			}
		}
		if (a.parent && !b.parent) return 1;
		if (!a.parent && b.parent) return -1;
		return a.position - b.position;
	});

	for (const parent of sortedChannels) {
		const threads = threadsByChannel.get(parent);
		if (threads.length === 0) continue;
		threadList += `\n__**${parent.name}**__\n`;
		threadList += threads.map(t => `- <#${t.id}> (${t.name})`).join('\n') + '\n';
	}
	if (!threadList) threadList = 'Aucun fil sur le serveur.';

	const messages = splitMessage(`**Liste des fils du serveur :**\n${threadList}`);

	let fetched = await channel.messages.fetch({ limit: 100 });

	for (const [, message] of fetched) {
		await message.delete();
	}
	let listMessage;
	for (const msg of messages) {
		listMessage = await channel.send(msg);
	}
}
function splitMessage(text, maxLength = 2000) {
	const lines = text.split('\n');
	const messages = [];
	let current = '';
	for (const line of lines) {
		if ((current + line + '\n').length > maxLength) {
			messages.push(current);
			current = '';
		}
		current += line + '\n';
	}
	if (current) messages.push(current);
	return messages;
}

async function fetchFetesDuJour(day, month) {
	// Construit l'URL du format /date/DD-MM.htm
	const dd = String(day).padStart(2, '0');
	const mm = String(month).padStart(2, '0');
	const url = `https://www.journee-mondiale.com/date/${dd}-${mm}.htm`;

	const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PCR-bot/1.0)'} });
	const $ = load(res.data);
	const items = new Set();

	// Cherche les <h2> dans la section #journeesDuJour (structure fournie)
	$('#journeesDuJour article h2[itemprop="name"], #journeesDuJour article h2').each((i, el) => {
		const text = $(el).text().replace(/\s+/g, ' ').trim();
		if (text && text.length > 3) items.add(text);
	});

	return Array.from(items);
}

export {
	isAdmin,
	registerCommands,
	getCommand,
	environmentIsProd,
	handleException,
	log,
	autoAddEmojis,
	getRoleID,
	dbAddDeleteMessage,
	updateThreadList,
	splitMessage,
	fetchFetesDuJour,
};
