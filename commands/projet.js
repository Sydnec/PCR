import { SlashCommandBuilder } from 'discord.js';
import { createCanvas, loadImage, registerFont } from 'canvas';
import { handleException, log, isAdmin } from '../modules/utils.js';
import { emojiRegex } from '../modules/regex.js';
import { format } from 'date-fns';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

export default {
    data: new SlashCommandBuilder().setName('projet').setDescription('projet'),

    async execute(interaction) {
        try {
            if (isAdmin(interaction.member)) {
                interaction.reply({
                    content:
                        'Le récapitulatif 2023 est en cours de génération ...',
                    ephemeral: true,
                });
                const result = await getMessageCount(interaction.channel.guild);
                // Appeler la fonction pour chaque utilisateur
                for (const userId in result) {
                    const userRecap = await generateUserInfoImage(
                        userId,
                        result
                    );
                    interaction.channel.send({
                        content: `### Message ayant le plus fait réagir : ${userRecap.message}`,
                        files: [userRecap.image],
                    });
                }
            }
        } catch (error) {
            handleException(error);
        }
    },
};

async function getMessageCount(guild) {
    try {
        await guild.members.fetch();
        const userStats = {};
        if (guild.channels.cache) {
            for (const [_, channel] of guild.channels.cache) {
                let userCount = {};
                const excludedChannelTypes = [4, 15];
                if (!excludedChannelTypes.includes(channel.type)) {
                    try {
                        let lastId;
                        do {
                            const options = { limit: 100, before: lastId };
                            const messages =
                                channel && channel.messages
                                    ? await channel.messages.fetch(options)
                                    : null;
                            for (const [_, member] of guild.members.cache) {
                                if (member.user.bot) {
                                    continue;
                                }
                                const filteredMessages = messages.filter(
                                    (msg) => msg.author.id === member.id
                                );
                                const messageCount = filteredMessages.size;
                                if (messageCount > 0) {
                                    const defaultUserStats = {
                                        username: member.displayName,
                                        avatarUrl: member.user
                                            .displayAvatarURL({
                                                format: 'webp',
                                                dynamic: true,
                                                size: 2048,
                                            })
                                            .replace('.webp', '.jpg'),
                                        joinedAt: member.joinedAt,
                                        count: 0,
                                        mostReactedMessage: '',
                                        mostActiveChannel: channel,
                                        channelMaxNumber: 0,
                                        emojiOccurrences: {},
                                        emojiMaxOccurrences: 0,
                                        mostUsedEmoji: {},
                                    };
                                    userStats[member.id] =
                                        userStats[member.id] ||
                                        defaultUserStats;
                                    userCount[member.id] = userCount[
                                        member.id
                                    ] || { count: 0 };

                                    userCount[member.id].count += messageCount;
                                    userStats[member.id].count += messageCount;

                                    filteredMessages.forEach((message) => {
                                        const emojis =
                                            message.content.match(emojiRegex);
                                        if (emojis) {
                                            emojis.forEach((emoji) => {
                                                const [emojiName, emojiId] =
                                                    emoji
                                                        .slice(2, -1)
                                                        .split(':');
                                                if (emojiId) {
                                                    userStats[
                                                        member.id
                                                    ].emojiOccurrences[
                                                        emojiId
                                                    ] =
                                                        (userStats[member.id]
                                                            .emojiOccurrences[
                                                            emojiId
                                                        ] || 0) + 1;
                                                    const currentCount =
                                                        userStats[member.id]
                                                            .emojiOccurrences[
                                                            emojiId
                                                        ];
                                                    if (
                                                        !userStats[member.id]
                                                            .mostUsedEmoji
                                                            .count ||
                                                        currentCount >
                                                            userStats[member.id]
                                                                .mostUsedEmoji
                                                                .count
                                                    ) {
                                                        userStats[
                                                            member.id
                                                        ].mostUsedEmoji = {
                                                            id: emojiId,
                                                            name: emojiName, // Ajout du nom de l'emoji
                                                            count: currentCount,
                                                        };
                                                    }
                                                }
                                            });
                                        }
                                    });
                                    const newMostReactedMessage =
                                        await Array.from(
                                            filteredMessages.values()
                                        ).reduce((prev, current) => {
                                            const totalReactionsPrev =
                                                prev.reactions.cache.reduce(
                                                    (acc, reaction) =>
                                                        acc + reaction.count,
                                                    0
                                                );
                                            const totalReactionsCurrent =
                                                current.reactions.cache.reduce(
                                                    (acc, reaction) =>
                                                        acc + reaction.count,
                                                    0
                                                );

                                            return totalReactionsPrev >
                                                totalReactionsCurrent
                                                ? prev
                                                : current;
                                        });
                                    if (
                                        !userStats[member.id]
                                            .mostReactedMessage ||
                                        newMostReactedMessage.reactions.cache.reduce(
                                            (acc, reaction) =>
                                                acc + reaction.count,
                                            0
                                        ) >
                                            userStats[
                                                member.id
                                            ].mostReactedMessage.reactions.cache.reduce(
                                                (acc, reaction) =>
                                                    acc + reaction.count,
                                                0
                                            )
                                    ) {
                                        userStats[
                                            member.id
                                        ].mostReactedMessage =
                                            newMostReactedMessage;
                                    }
                                }
                            }
                            lastId = messages.last()?.id;
                        } while (lastId !== undefined);
                        for (const [_, member] of guild.members.cache) {
                            if (member.user.bot) {
                                continue;
                            }
                            if (
                                userCount[member.id] &&
                                userCount[member.id].count >
                                    userStats[member.id].channelMaxNumber
                            ) {
                                userStats[member.id].channelMaxNumber =
                                    userCount[member.id].count;
                                userStats[member.id].mostActiveChannel =
                                    channel;
                            }
                        }
                    } catch (e) {
                        handleException(e);
                    }
                }
            }
        }
        return userStats;
    } catch (e) {
        handleException(e);
        return {};
    }
}

async function generateUserInfoImage(userId, result) {
    const user = result[userId];
    // Vérifier si l'utilisateur existe
    if (!user) {
        log(`Utilisateur avec l'ID ${userId} non trouvé.`);
        return;
    }

    // Récupérer les informations demandées
    const username = user.username;
    const joinedAt = user.joinedAt;
    const count = user.count;
    const countChannelMax = user.channelMaxNumber;
    const mostActiveChannel = user.mostActiveChannel;
    const mostReactedMessage = user.mostReactedMessage;
    const mostUsedEmoji = user.mostUsedEmoji;
    const avatar = user.avatarUrl; // Ajout de l'URL de l'avatar

    // Parametrage de la police
    const fontPath = './fonts/Montserrat-SemiBold.ttf';
    registerFont(fontPath, { family: 'Montserrat' });
    // Créer un canvas
    const canvas = createCanvas(1200, 450);
    const ctx = canvas.getContext('2d');
    ctx.font = '35px Montserrat';
    ctx.fillStyle = '#011526';

    // Charger une image de fond
    const backgroundImage = await loadImage('./images/background.jpg');
    ctx.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height);
    ctx.strokeRect(8, 8, 1184, 434);

    // Charger l'avatar de l'utilisateur
    const avatarImage = await loadImage(avatar);
    ctx.drawImage(avatarImage, 70, 50, 300, 300);

    // Dessiner les informations sur le canvas
    var text = ctx.measureText(`${username}`);
    ctx.fillText(`${username}`, 230 - text.width / 2, 410);
    ctx.fillText(
        `A rejoint le serveur le : ${format(joinedAt, 'dd/MM/yyyy')}`,
        470,
        80
    );
    ctx.fillText(`Messages envoyés : ${count.toLocaleString()}`, 470, 160);
    ctx.fillText(
        `Channel le plus actif : ${mostActiveChannel.name}\n\t avec ${countChannelMax.toLocaleString()} messages`,
        470,
        240
    );

    // Charge l'image de l'emoji
    try {
        const mostUsedEmojiImage = await loadImage(
            `https://cdn.discordapp.com/emojis/${mostUsedEmoji.id}.png`
        );
        ctx.drawImage(mostUsedEmojiImage, 930, 300, 120, 120);
        ctx.fillText(
            `Emoji le plus utilisé :\n\tavec ${mostUsedEmoji.count.toLocaleString()} utilisations`,
            470,
            350
        );
    } catch {
        ctx.fillText(
            `Emoji le plus utilisé : ${mostUsedEmoji.name}\n\tavec ${mostUsedEmoji.count.toLocaleString()} utilisations`,
            470,
            350
        );
    }

    // Sauvegarder le canvas comme image
    const imageBuffer = canvas.toBuffer('image/png');
    return { image: imageBuffer, message: mostReactedMessage.url };
}
