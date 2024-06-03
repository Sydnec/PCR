import { REST, Routes, PermissionsBitField } from 'discord.js';
import { readdirSync } from 'fs';
import { format } from 'date-fns';
import { emojiRegex } from './regex.js';
import dotenv from 'dotenv';
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
async function dbAddDeleteMessage(message, days, db) {
	try {
		const messageLink = message.url;
		const messageId = message.id;
		const createdAt = message.createdTimestamp; // Date de création du message en millisecondes
		const expireAt = createdAt + days * 24 * 60 * 60 * 1000; // Convertir les jours en millisecondes

		// Stocker l'information du message à supprimer dans la base de données
		db.run(
			'INSERT INTO messages (id, link, expire_at) VALUES (?, ?, ?)',
			[messageId, messageLink, expireAt],
			(err) => {
				if (err) {
					handleException(err);
				} else {
					log(
						`Message programmé pour suppression après ${days} jours : ${messageLink}`
					);
				}
			}
		);
	} catch (err) {
		handleException(err);
	}
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
    db,
};
