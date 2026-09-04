// Les regex globales portent un `lastIndex` qui survit d'un appel à l'autre :
// `regex.test(a)` puis `regex.test(b)` reprend la recherche au milieu de `b` et
// rate donc un lien sur deux. Ces motifs étant utilisés à la fois avec
// `.test()` (messageCreate) et `.replace()`, on expose des fabriques plutôt
// qu'un objet partagé, et une version sans `g` pour les tests d'existence.
const TWITTER_SOURCE = 'https:\\/\\/(www\\.)?(x\\.com|twitter\\.com)';
const INSTAGRAM_SOURCE = 'https:\\/\\/(www\\.)?instagram\\.com\\/reel\\/';
const EMOJI_SOURCE = '((?<!\\\\)<:[^:]+:(\\d+)>)|\\p{Emoji_Presentation}|\\p{Extended_Pictographic}';

// Sans `g` : sûres à réutiliser avec .test(), aucun état conservé.
const twitterRegex = new RegExp(TWITTER_SOURCE, 'i');
const instagramRegex = new RegExp(INSTAGRAM_SOURCE, 'i');

// Avec `g` : à usage unique, pour .replace() / .match(). Toujours passer par la
// fabrique pour obtenir une instance neuve.
const twitterRegexGlobal = () => new RegExp(TWITTER_SOURCE, 'gi');
const instagramRegexGlobal = () => new RegExp(INSTAGRAM_SOURCE, 'gi');
const emojiRegexGlobal = () => new RegExp(EMOJI_SOURCE, 'gmu');

// Conservé pour `String.prototype.match(...)`, qui remet lastIndex à zéro avec
// le drapeau `g` — le seul usage de ce motif dans le projet.
const emojiRegex = emojiRegexGlobal();

export {
	twitterRegex,
	instagramRegex,
	emojiRegex,
	twitterRegexGlobal,
	instagramRegexGlobal,
	emojiRegexGlobal,
};
