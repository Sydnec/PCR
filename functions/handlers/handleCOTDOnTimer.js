import axios from 'axios'; // Pour faire des requêtes HTTP
import { handleException, fetchFetesDuJour } from '../../modules/utils.js'; // Ton utilitaire pour gérer les erreurs
import dotenv from 'dotenv';
dotenv.config(); // Charger les variables d'environnement

export default (bot) => {
    bot.handleCOTDOnTimer = async () => {
        try {
            const url = 'https://nominis.cef.fr/json/nominis.php';
            const response = await axios.get(url);

            // Vérifier si la réponse contient des prénoms majeurs
            if (response.data && response.data.response && response.data.response.prenoms && response.data.response.prenoms.majeurs) {
                const saints = response.data.response.prenoms.majeurs;
                let messageContent = `Nous sommes le ${formatDate(response.data.response.query.jour, response.data.response.query.mois)} et nous célébrons les :`;

                Object.keys(saints).forEach(name => {
                    const gender = saints[name].sexe === 'masculin' ? 'Masculin' : 'Féminin';
                    messageContent += `\n- ${name} (${gender})`;
                });

                // Récupérer les fêtes du jour depuis journee-mondiale.com via utilitaire
                let fetesDuJour = [];
                try {
                    fetesDuJour = await fetchFetesDuJour(response.data.response.query.jour, response.data.response.query.mois);
                } catch (err) {
                    // Ne pas casser la fonction principale si le scraping échoue
                    handleException(err);
                }

                if (fetesDuJour && fetesDuJour.length > 0) {
                  messageContent += '\n\nFêtes du jour :';
                  fetesDuJour.forEach(fete => {
                    messageContent += `\n- ${fete}`;
                  });
                }

                messageContent += '\nPour fêter ça, apéro !';
                const channel = await bot.channels.cache.get(process.env.COTD_CHANNEL_ID);
                channel.send(messageContent);
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
