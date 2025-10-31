const twitterRegex = /https:\/\/(www\.)?(x\.com|twitter\.com)/gi;
const instagramRegex = /https:\/\/(www\.)?instagram\.com/gi;
const emojiRegex =
  /((?<!\\)<:[^:]+:(\d+)>)|\p{Emoji_Presentation}|\p{Extended_Pictographic}/gmu;

export { twitterRegex, instagramRegex, emojiRegex };
