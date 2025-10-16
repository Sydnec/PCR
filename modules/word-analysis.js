// Module d'analyse linguistique pour les statistiques de mots
// Fournit des fonctionnalités de filtrage, catégorisation et analyse

// Liste complète des stop words français (mots vides à ignorer)
export const FRENCH_STOP_WORDS = new Set([
    // Articles
    'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'l',
    // Prépositions
    'à', 'au', 'aux', 'dans', 'pour', 'par', 'avec', 'sans', 'sur', 'sous',
    'en', 'vers', 'chez', 'entre', 'contre', 'depuis', 'pendant',
    // Pronoms
    'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles',
    'me', 'te', 'se', 'le', 'la', 'les', 'lui', 'leur', 'y',
    'moi', 'toi', 'soi', 'eux',
    // Pronoms démonstratifs/possessifs
    'mon', 'ton', 'son', 'ma', 'ta', 'sa', 'mes', 'tes', 'ses',
    'notre', 'votre', 'leur', 'nos', 'vos', 'leurs',
    'ce', 'cet', 'cette', 'ces', 'celui', 'celle', 'ceux', 'celles',
    // Conjonctions
    'et', 'ou', 'mais', 'donc', 'or', 'ni', 'car', 'que', 'qui', 'quoi',
    'dont', 'où', 'quand', 'comme', 'si', 'lorsque', 'puisque',
    // Négations
    'ne', 'pas', 'plus', 'jamais', 'rien', 'personne', 'aucun', 'aucune',
    // Verbes auxiliaires et très courants (conjugaisons)
    'être', 'avoir', 'faire', 'dire', 'aller', 'voir', 'savoir', 'pouvoir',
    'falloir', 'vouloir', 'devoir', 'prendre', 'trouver', 'donner', 'venir',
    'ai', 'as', 'a', 'avons', 'avez', 'ont', 'avais', 'avait', 'avaient',
    'es', 'est', 'sommes', 'êtes', 'sont', 'étais', 'était', 'étaient',
    'été', 'ayant', 'eu', 'eue', 'eus', 'eues',
    'suis', 'sera', 'serai', 'seront', 'serais', 'serait', 'seraient',
    'fais', 'fait', 'faites', 'font', 'faisais', 'faisait', 'faisaient',
    'vais', 'va', 'allons', 'allez', 'vont', 'allais', 'allait', 'allaient',
    // Adverbes très courants
    'très', 'bien', 'tout', 'tous', 'toute', 'toutes', 'alors', 'aussi',
    'encore', 'déjà', 'même', 'peu', 'beaucoup', 'trop', 'assez',
    'moins', 'tant', 'autant', 'ainsi', 'ici', 'là',
    // Expressions courantes
    'c\'est', 'c\'était', 'n\'est', 'qu\'il', 'qu\'elle', 'qu\'on',
    'd\'un', 'd\'une', 'l\'on', 's\'il', 's\'est',
    // Mots de liaison
    'alors', 'ensuite', 'enfin', 'puis', 'après', 'avant', 'maintenant',
    // Autres
    'oui', 'non', 'peut', 'autres', 'autre', 'chaque', 'tel', 'telle'
]);

// Mots positifs (joie, enthousiasme, appréciation)
export const POSITIVE_WORDS = new Set([
    'cool', 'super', 'génial', 'top', 'excellent', 'parfait', 'incroyable',
    'magnifique', 'merveilleux', 'fantastique', 'formidable', 'extraordinaire',
    'merci', 'bravo', 'félicitations', 'content', 'heureux', 'joie', 'plaisir',
    'amour', 'aimer', 'adore', 'kiffe', 'love', 'adorable', 'mignon',
    'sympa', 'gentil', 'agréable', 'chouette', 'beau', 'belle', 'joli',
    'ouf', 'incroyable', 'dingue', 'fou', 'mortel', 'énorme', 'puissant',
    'mdr', 'ptdr', 'lol', 'xd', 'haha', 'hihi', 'héhé', 'rire', 'drôle',
    'marrant', 'rigolo', 'excellent', 'nickel', 'impeccable', 'stylé',
    'bg', 'bonne', 'bon', 'meilleur', 'best', 'win', 'gg', 'gz', 'wp',
    'respect', 'force', 'courage', 'chaud', 'validé', 'approuvé'
]);

// Mots négatifs (tristesse, colère, frustration)
export const NEGATIVE_WORDS = new Set([
    'nul', 'mauvais', 'horrible', 'terrible', 'affreux', 'moche', 'laid',
    'chiant', 'relou', 'lourd', 'pénible', 'énervant', 'agaçant', 'fatigue',
    'merde', 'putain', 'bordel', 'con', 'connard', 'connerie', 'débile',
    'idiot', 'stupide', 'crétin', 'imbécile', 'naze', 'pourri', 'dégueu',
    'triste', 'déprimé', 'déprime', 'déçu', 'déception', 'regrette',
    'colère', 'énervé', 'furieux', 'rage', 'haine', 'déteste',
    'problème', 'erreur', 'bug', 'cassé', 'pété', 'mort', 'dead',
    'impossible', 'difficile', 'dur', 'compliqué', 'galère', 'chaud',
    'perdu', 'fail', 'rip', 'oof', 'sad', 'tmtc', 'dommage', 'tant pis',
    'injuste', 'peur', 'angoisse', 'stress', 'inquiet', 'crainte'
]);

// Tics de langage français modernes
export const COMMON_FILLER_WORDS = new Set([
    'genre', 'truc', 'machin', 'chose', 'bidule', 'trucs',
    'du coup', 'en fait', 'en gros', 'en vrai', 'en mode',
    'genre', 'style', 'quoi', 'voilà', 'bon', 'bah', 'euh',
    'franchement', 'carrément', 'grave', 'trop', 'vachement',
    'quand même', 'un peu', 'limite', 'juste', 'vraiment',
    'littéralement', 'complètement', 'totalement'
]);

/**
 * Filtre les mots pour ne garder que les mots significatifs
 * @param {Object} wordCounts - Objet {mot: nombre}
 * @param {number} minLength - Longueur minimale d'un mot
 * @param {number} minOccurrences - Nombre minimal d'occurrences
 * @returns {Array} Tableau de [mot, count] triés par count DESC
 */
export function filterSignificantWords(wordCounts, minLength = 3, minOccurrences = 5) {
    return Object.entries(wordCounts)
        .filter(([word, count]) => {
            const cleanWord = word.toLowerCase().trim();
            return (
                !FRENCH_STOP_WORDS.has(cleanWord) &&
                cleanWord.length >= minLength &&
                count >= minOccurrences &&
                /^[a-zàâäæçéèêëïîôùûüÿœ'-]+$/i.test(cleanWord) // Lettres françaises uniquement
            );
        })
        .sort((a, b) => b[1] - a[1]);
}

/**
 * Catégorise un mot selon son sentiment
 * @param {string} word - Le mot à analyser
 * @returns {string} 'positive', 'negative' ou 'neutral'
 */
export function categorizeSentiment(word) {
    const cleanWord = word.toLowerCase().trim();
    if (POSITIVE_WORDS.has(cleanWord)) return 'positive';
    if (NEGATIVE_WORDS.has(cleanWord)) return 'negative';
    return 'neutral';
}

/**
 * Analyse le sentiment global d'un utilisateur
 * @param {Object} wordCounts - Objet {mot: nombre}
 * @returns {Object} {positive: number, negative: number, neutral: number, score: number}
 */
export function analyzeSentiment(wordCounts) {
    let positive = 0;
    let negative = 0;
    let neutral = 0;

    Object.entries(wordCounts).forEach(([word, count]) => {
        const sentiment = categorizeSentiment(word);
        if (sentiment === 'positive') positive += count;
        else if (sentiment === 'negative') negative += count;
        else neutral += count;
    });

    const total = positive + negative + neutral;
    const score = total > 0 ? Math.round((positive / (positive + negative)) * 100) : 50;

    return {
        positive,
        negative,
        neutral,
        score, // 0-100, 50 = neutre, >50 = positif, <50 = négatif
        totalWords: total
    };
}

/**
 * Détecte les tics de langage (mots de remplissage sur-utilisés)
 * @param {Object} wordCounts - Objet {mot: nombre}
 * @returns {Array} Tableau de [mot, count] des tics détectés
 */
export function detectFillerWords(wordCounts) {
    return Object.entries(wordCounts)
        .filter(([word]) => {
            const cleanWord = word.toLowerCase().trim();
            return COMMON_FILLER_WORDS.has(cleanWord);
        })
        .sort((a, b) => b[1] - a[1]);
}

/**
 * Calcule la diversité lexicale (ratio mots uniques / mots totaux)
 * @param {Object} wordCounts - Objet {mot: nombre}
 * @returns {Object} {uniqueWords: number, totalWords: number, diversity: number}
 */
export function calculateLexicalDiversity(wordCounts) {
    const entries = Object.entries(wordCounts);
    const uniqueWords = entries.length;
    const totalWords = entries.reduce((sum, [, count]) => sum + count, 0);
    const diversity = totalWords > 0 ? (uniqueWords / totalWords) * 100 : 0;

    return {
        uniqueWords,
        totalWords,
        diversity: Math.round(diversity * 10) / 10, // Arrondi à 1 décimale
        score: Math.min(10, Math.round(diversity * 2)) // Score sur 10
    };
}

/**
 * Détecte les mots sur-utilisés par rapport à la moyenne du serveur
 * @param {Object} userWordCounts - Mots de l'utilisateur {mot: nombre}
 * @param {Object} serverAverages - Moyennes serveur {mot: nombre}
 * @param {number} threshold - Ratio minimum pour considérer un mot comme sur-utilisé
 * @returns {Array} Tableau de {word, userCount, serverAvg, ratio}
 */
export function detectOverusedWords(userWordCounts, serverAverages, threshold = 2.0) {
    const overused = [];

    Object.entries(userWordCounts).forEach(([word, userCount]) => {
        const serverAvg = serverAverages[word] || 0;
        if (serverAvg > 0) {
            const ratio = userCount / serverAvg;
            if (ratio >= threshold) {
                overused.push({
                    word,
                    userCount,
                    serverAvg: Math.round(serverAvg),
                    ratio: Math.round(ratio * 10) / 10
                });
            }
        }
    });

    return overused.sort((a, b) => b.ratio - a.ratio);
}

/**
 * Calcule la moyenne des mots pour tous les utilisateurs du serveur
 * @param {Array} allUsersWordCounts - Tableau d'objets {userId, wordCounts}
 * @returns {Object} Moyennes {mot: nombre moyen}
 */
export function calculateServerWordAverages(allUsersWordCounts) {
    const wordSums = {};
    const wordUserCounts = {};

    allUsersWordCounts.forEach(({ wordCounts }) => {
        Object.entries(wordCounts).forEach(([word, count]) => {
            if (!wordSums[word]) {
                wordSums[word] = 0;
                wordUserCounts[word] = 0;
            }
            wordSums[word] += count;
            wordUserCounts[word] += 1;
        });
    });

    const averages = {};
    Object.keys(wordSums).forEach(word => {
        averages[word] = wordSums[word] / wordUserCounts[word];
    });

    return averages;
}

/**
 * Génère un résumé textuel enrichi des stats de mots
 * @param {Object} wordCounts - Objet {mot: nombre}
 * @param {Object} serverAverages - Moyennes serveur (optionnel)
 * @returns {Object} Résumé complet avec toutes les métriques
 */
export function generateWordSummary(wordCounts, serverAverages = null) {
    const significant = filterSignificantWords(wordCounts, 3, 5);
    const sentiment = analyzeSentiment(wordCounts);
    const fillers = detectFillerWords(wordCounts);
    const diversity = calculateLexicalDiversity(wordCounts);
    
    let overused = [];
    if (serverAverages) {
        overused = detectOverusedWords(wordCounts, serverAverages, 2.0);
    }

    return {
        topWords: significant.slice(0, 10),
        sentiment,
        fillerWords: fillers.slice(0, 5),
        diversity,
        overusedWords: overused.slice(0, 5)
    };
}
