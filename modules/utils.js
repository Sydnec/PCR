import { PermissionsBitField, ChannelType, EmbedBuilder } from 'discord.js';
import { format } from 'date-fns';
import { emojiRegexGlobal } from './regex.js';
import dotenv from 'dotenv';
import axios from 'axios';
import { load } from 'cheerio';
dotenv.config();

function isAdmin(member) {
	return member.permissions.has(PermissionsBitField.Flags.Administrator);
}
const getCommand = (message = '') =>
	message.replace(/\s+/, '\x01').split('\x01'); // Créer un tableau avec le séparateur ' '
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
function handleException(...args) {
	// Variadique : une cinquantaine d'appels dans le projet passent un message
	// de contexte suivi de l'erreur. Avec un seul paramètre, l'erreur était
	// silencieusement perdue et les logs n'indiquaient pas la cause.
	error(...args);
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
// Numérote les lignes d'un sondage et pose les réactions correspondantes.
//
// Le jeu de puces s'arrête à 20, la limite de réactions d'un message Discord.
// Auparavant il n'y en avait que dix : au-delà, `numbers[i]` valait undefined,
// la ligne était préfixée par « undefined » et `message.react(undefined)`
// levait une erreur — un sondage de plus de dix lignes (une quinzaine de jours
// avec /week, par exemple) était donc cassé.
const REACTION_SLOTS = [
	'1\uFE0F\u20E3',
	'2\uFE0F\u20E3',
	'3\uFE0F\u20E3',
	'4\uFE0F\u20E3',
	'5\uFE0F\u20E3',
	'6\uFE0F\u20E3',
	'7\uFE0F\u20E3',
	'8\uFE0F\u20E3',
	'9\uFE0F\u20E3',
	'\uD83D\uDD1F',
	// Au-delà de dix, on continue avec des lettres régionales : Discord accepte
	// vingt réactions par message, pas une de plus.
	...'ABCDEFGHIJ'
		.split('')
		.map((letter) =>
			String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65)
		),
];
const MAX_REACTIONS = REACTION_SLOTS.length;

// Pose les réactions une par une : lancées toutes ensemble, elles se faisaient
// limiter par l'API et une partie était perdue. Les doublons sont ignorés, un
// même emoji ne pouvant être ajouté deux fois.
async function addReactions(message, emojis) {
	const seen = new Set();
	for (const emoji of emojis) {
		if (!emoji || seen.has(emoji)) continue;
		seen.add(emoji);
		try {
			await message.react(emoji);
		} catch (e) {
			error(`Réaction ${emoji} impossible :`, e.message);
		}
	}
}

async function autoAddEmojis(message) {
	try {
		const content = message.content.split('\n'); //Sépare chaque ligne dans un tableau

		let i = 0;
		let newEmojisArray = [];
		let newMessageString = '';
		let noEmojiLine = false;

		for (const line of content) {
			if (line[0] === '#') {
				newMessageString += ' ' + line + '\n';
				continue;
			}

			// Plus de puce disponible : la ligne est conservée telle quelle,
			// sans numéro ni réaction, plutôt que préfixée d'un « undefined ».
			const slot = i < MAX_REACTIONS ? REACTION_SLOTS[i] : null;

			//Analyse ligne par ligne le message d'origine
			const emojisArray = line.match(emojiRegexGlobal());
			if (emojisArray === null) {
				//Aucun emoji sur la ligne
				if (slot) {
					newEmojisArray.push(slot);
					newMessageString += slot + ' ' + line + '\n';
					noEmojiLine = true;
				} else {
					newMessageString += ' ' + line + '\n';
				}
			} else {
				//La ligne contient un/des emoji.s
				if (
					message.guild?.emojis.cache.find(
						(emoji) => emoji.name === emojisArray[0].split(':')[1]
					) !== undefined ||
					!emojisArray[0].startsWith('<:')
				) {
					//L'emoji est accessible
					newEmojisArray.push(emojisArray[0]);
					newMessageString += ' ' + line + '\n';
				} else {
					//L'emoji n'est pas accessible
					if (slot) {
						newEmojisArray.push(slot);
						newMessageString +=
							slot + ' ' + line.split('>')[1] + '\n';
						noEmojiLine = true;
					} else {
						newMessageString += ' ' + line + '\n';
					}
				}
			}
			i++;
		}

		if (noEmojiLine === true) {
			//Il y a au moins une ligne sans emoji ou avec un emoji innaccessible
			if (message.author.id === message.client.user.id) {
				await message.edit(newMessageString);
				await addReactions(message, newEmojisArray);
			} else if (message.thread) {
				const newMessage = await message.thread.send(newMessageString); //Message écrit par le bot
				await addReactions(newMessage, newEmojisArray);
				await message.delete(); //Supprime le message de base
			} else {
				// Pas de fil où republier : on se contente d'ajouter les
				// réactions, au lieu de lever sur `message.thread.send`.
				await addReactions(message, newEmojisArray);
			}
		} else {
			await addReactions(message, newEmojisArray);
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
	for (const msg of messages) {
		await channel.send(msg);
	}
}
// Découpe un texte en messages respectant la limite de Discord.
//
// L'ancienne version poussait un morceau vide quand la première ligne dépassait
// déjà la limite, et laissait passer telle quelle toute ligne plus longue que
// `maxLength` — que l'API refusait ensuite.
function splitMessage(text, maxLength = 2000) {
	const messages = [];
	let current = '';

	const flush = () => {
		if (current.length > 0) messages.push(current);
		current = '';
	};

	for (const line of String(text).split('\n')) {
		// Une ligne trop longue à elle seule est coupée en tranches.
		let rest = line;
		while (rest.length + 1 > maxLength) {
			flush();
			messages.push(rest.slice(0, maxLength));
			rest = rest.slice(maxLength);
		}
		if ((current + rest + '\n').length > maxLength) flush();
		current += rest + '\n';
	}

	flush();
	return messages;
}

async function fetchFetesDuJour(day, month) {
	// Construit l'URL du format /date/DD-MM.htm
	const dd = String(day).padStart(2, '0');
	const mm = String(month).padStart(2, '0');
	const url = `https://www.journee-mondiale.com/date/${dd}-${mm}.htm`;

	// Sans timeout, une requête bloquée retenait indéfiniment l'appelant — donc
	// la tâche cron quotidienne comme l'interaction /cotd.
	const res = await axios.get(url, {
		timeout: 10000,
		headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PCR-bot/1.0)' },
	});
	const $ = load(res.data);
	const items = new Set();

	// Cherche les <h2> dans la section #journeesDuJour (structure fournie)
	$('#journeesDuJour article h2[itemprop="name"], #journeesDuJour article h2').each((i, el) => {
		const text = $(el).text().replace(/\s+/g, ' ').trim();
		if (text && text.length > 3) items.add(text);
	});

	return Array.from(items);
}

/**
 * Split un embed trop long en plusieurs embeds
 * Discord a une limite de 6000 caractères totaux par embed et 1024 caractères par field value
 * @param {EmbedBuilder} embed - L'embed à potentiellement split
 * @returns {Array<EmbedBuilder>} - Tableau d'embeds (1 ou plusieurs)
 */
function splitEmbed(embed) {
	const embeds = [];
	const data = embed.data;
	
	// Si l'embed est déjà valide (pas de fields trop longs), le retourner tel quel
	const fields = data.fields || [];
	const hasOversizedField = fields.some(f => f.value && f.value.length > 1024);
	
	if (!hasOversizedField) {
		return [embed];
	}
	
	// Créer un nouvel embed avec les métadonnées de base
	let currentEmbed = new EmbedBuilder()
		.setColor(data.color || null)
		.setTitle(data.title || null)
		.setDescription(data.description || null)
		.setThumbnail(data.thumbnail?.url || null)
		.setTimestamp(data.timestamp || null)
		.setFooter(data.footer || null);
	
	// Traiter chaque field
	for (const field of fields) {
		if (field.value.length <= 1024) {
			// Field normal, l'ajouter directement
			currentEmbed.addFields(field);
		} else {
			// Field trop long, le split en plusieurs embeds
			const lines = field.value.split('\n');
			let currentValue = '';
			let isFirstChunk = true;
			
			for (const line of lines) {
				// Si ajouter cette ligne dépasse 1024 caractères
				if ((currentValue + line + '\n').length > 1024) {
					// Sauvegarder le chunk actuel
					if (currentValue) {
						currentEmbed.addFields({
							name: isFirstChunk ? field.name : `${field.name} (suite)`,
							value: currentValue,
							inline: field.inline || false
						});
						isFirstChunk = false;
					}
					
					// Sauvegarder l'embed actuel et en créer un nouveau
					embeds.push(currentEmbed);
					currentEmbed = new EmbedBuilder()
						.setColor(data.color || null)
						.setTimestamp(data.timestamp || null)
						.setFooter(data.footer || null);
					
					currentValue = line + '\n';
				} else {
					currentValue += line + '\n';
				}
			}
			
			// Ajouter le dernier chunk
			if (currentValue) {
				currentEmbed.addFields({
					name: isFirstChunk ? field.name : `${field.name} (suite)`,
					value: currentValue,
					inline: field.inline || false
				});
			}
		}
	}
	
	// Ajouter le dernier embed s'il contient des fields
	if (currentEmbed.data.fields && currentEmbed.data.fields.length > 0) {
		embeds.push(currentEmbed);
	}
	
	return embeds.length > 0 ? embeds : [embed];
}

export {
	isAdmin,
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
	splitEmbed,
};
