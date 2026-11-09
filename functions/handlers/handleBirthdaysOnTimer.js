// Minuterie quotidienne des anniversaires. Un tick par minute comme les
// rappels : l'heure configurée est comparée ici, relue à chaque tick — la
// planification cron ne porte que la cadence, jamais l'heure. Changer l'heure
// par /admin config s'applique donc au prochain passage, sans redémarrage.
import { handleException } from "../../modules/utils.js";
import { pseudo } from "../../modules/pseudo.js";
import { getConfig } from "../../modules/config.js";
import { isToday } from "../../modules/birthdays.js";
// La table birthdays vit dans points.db (persistante), pas dans botdata-<ANNÉE>.db :
// une date déclarée en décembre doit exister encore en janvier.
import pointsDb from "../../modules/points-db.js";

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    pointsDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    pointsDb.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

export default (bot) => {
  bot.handleBirthdaysOnTimer = async () => {
    try {
      const config = getConfig().birthday;
      if (!config.enabled) return;

      const now = new Date();
      // Une seule passe efficace : la première minute de l'heure configurée.
      // Les 59 autres ticks de l'heure ne font rien — l'anti-doublon en base
      // suffirait, mais autant ne pas interroger la table pour rien.
      if (now.getHours() !== config.hour || now.getMinutes() !== 0) return;

      // Salon absent de l'env : fonctionnalité éteinte, sans erreur — même
      // convention que POKEMON_CHANNEL_ID.
      const channelId = process.env.BIRTHDAY_CHANNEL_ID;
      if (!channelId) return;

      const birthdays = await all("SELECT * FROM birthdays");

      // Le filtre des fêtes du jour : le 29 février se fête le 28 les années
      // non bissextiles (modules/birthdays.js).
      const celebrating = birthdays.filter((row) => isToday(row, now));
      if (celebrating.length === 0) return;

      const channel = await bot.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        return handleException("Salon d'anniversaires introuvable : " + channelId);
      }

      for (const row of celebrating) {
        // Garde anti-doublon portée par la ligne : un bot redémarré après le
        // premier envoi ne re-félicite pas la même année. L'UPDATE gardé ne
        // touche la ligne que si son année de fête n'est pas déjà la bonne :
        // si deux ticks se chevauchaient, un seul enverrait — le second
        // repart, changes vaut 0.
        let claimed;
        try {
          const result = await run(
            "UPDATE birthdays SET last_wished_year = ? WHERE user_id = ? AND (last_wished_year IS NULL OR last_wished_year <> ?)",
            [now.getFullYear(), row.user_id, now.getFullYear()]
          );
          claimed = result.changes > 0;
        } catch (error) {
          handleException("Verrou d'anniversaire pour " + row.user_id + " :", error);
          continue;
        }
        if (!claimed) continue;

        try {
          // Le nom ne vaut que pour le journal : le message affiche la
          // mention, que Discord rend indépendante du pseudo affiché.
          const name = await pseudo(row.user_id).catch(() => row.user_id);
          const message = config.message
            .replace("{user}", "<@" + row.user_id + ">")
            .replace("{name}", name);
          await channel.send({
            content: message,
            // allowedMentions explicite : la mention de la ligne est volontaire
            // et le reste du message ne peut pas contenir de ping surprises.
            allowedMentions: { users: [row.user_id] },
          });
          console.log("🎉 Anniversaire souhaité à " + name + " (" + row.user_id + ")");
        } catch (error) {
          // L'envoi a échoué : on rend la ligne « non félicitée » pour que la
          // minute suivante retente, plutôt que de marquer une fête ratée
          // comme faite.
          await run(
            "UPDATE birthdays SET last_wished_year = NULL WHERE user_id = ?",
            [row.user_id]
          ).catch(() => {});
          handleException("Envoi d'anniversaire pour " + row.user_id + " :", error);
        }
      }
    } catch (error) {
      handleException("Erreur de la minuterie des anniversaires :", error);
    }
  };
};
