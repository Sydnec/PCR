const twitterRegex = /https:\/\/(x\.com|twitter\.com)/gi;
const emojiRegex =
	/((?<!\\)<:[^:]+:(\d+)>)|\p{Emoji_Presentation}|\p{Extended_Pictographic}/gmu;

export { twitterRegex, emojiRegex };
