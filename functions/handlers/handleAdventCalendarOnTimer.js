import { readFile } from "fs/promises";
import { handleException } from "../../modules/utils.js";

export default (bot) => {
  bot.handleAdventCalendarOnTimer = async () => {
    try {
      const channel = bot.channels.cache.get(process.env.ADVENT_CHANNEL_ID);

      if (!channel) {
        throw new Error("ADVENT_CHANNEL_ID not found");
      }

      // Récupérer le jour actuel (1-31)
      const today = new Date().getDate();
      const currentMonth = new Date().getMonth() + 1; // 1-12

      // Vérifier si on est en décembre et entre le 1er et le 24
      if (currentMonth !== 12 || today < 1 || today > 24) {
        console.log(
          `Calendrier de l'avent : Pas le bon moment (${today}/${currentMonth})`
        );
        return;
      }

      // Charger les questions du calendrier
      const jsonData = await readFile("./modules/advent.json", "utf-8");
      const adventData = JSON.parse(jsonData);

      // Trouver la question du jour
      const todayQuestion = adventData.find((item) => item.jour === today);

      if (!todayQuestion || !todayQuestion.contenu) {
        console.log(`Pas de contenu pour le jour ${today}`);
        return;
      }

      // Créer un nouveau thread avec la question du jour
      const threadName = `Jour ${today} - ${todayQuestion.contenu.substring(
        0,
        80
      )}`;

      const thread = await channel.threads.create({
        name: threadName,
        autoArchiveDuration: 1440, // 24 heures
        reason: `Calendrier de l'avent - Jour ${today}`,
      });

      // Message d'introduction dans le thread
      let messageContent = `# 🎄 Calendrier de l'Avent - Jour ${today}\n\n`;

      if (todayQuestion.categorie) {
        messageContent += `**${todayQuestion.categorie}**\n\n`;
      }

      messageContent += `${todayQuestion.contenu}\n\n`;
      messageContent += `_Partagez vos réponses ci-dessous !_ ✨`;

      // Envoyer le message dans le thread
      const threadMessage = await thread.send(messageContent);

      // Ajouter une image si elle existe
      if (todayQuestion.image) {
        await thread.send({ files: [todayQuestion.image] });
      }

      // Épingler le message d'introduction
      await threadMessage.pin();

      console.log(`Thread créé pour le jour ${today} : ${threadName}`);
    } catch (error) {
      handleException(error);
    }
  };
};
