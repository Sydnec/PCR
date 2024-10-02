import axios from 'axios'; // Pour faire des requêtes HTTP
import { handleException } from '../../modules/utils.js'; // Ton utilitaire pour gérer les erreurs
import dotenv from 'dotenv';
dotenv.config(); // Charger les variables d'environnement

export default (bot) => {
    bot.handleCOTDOnTimer = async () => {
        try {
            // Remplacez 'VOTRE_API_KEY' par votre clé API si nécessaire
            const url = `https://fetedujour.fr/api/v2/${process.env.API_KEY}/json-saints`;
            const response = await axios.get(url);

            // Vérifier si la réponse contient des prénoms
            if (response.data && response.data.saints) {
                // Formatage des résultats
                let messageContent = `Nous somme le ${formatDate(response.data.day, response.data.month)} et nous célébrons les :`

                response.data.saints.forEach(saint => {
                const gender = saint.gender === 'M' ? 'Masculin' : 'Féminin';
                messageContent += `\n- ${saint.name} (${gender})`;
                });

                messageContent += '\n pour fêter ça, apéro !'
                const channel = await bot.channels.cache.get(process.env.COTD_CHANNEL_ID);
                channel
                .send(messageContent)
            }
        } catch (error) {
            handleException(error); // Utilisation de ton module d'erreur personnalisé
        }
    };
};

function formatDate(day, month) {
    // Ajoute un zéro devant si le jour ou le mois a un seul chiffre
    const formattedDay = day.toString().padStart(2, '0');
    const formattedMonth = month.toString().padStart(2, '0');

    return `${formattedDay}/${formattedMonth}`;
}