// Handler : fait fuir les Pokémon dont la durée de vie est écoulée.
//
// Le remplacement par un nouveau spawn dépend de l'activité du serveur ; ce
// balayage n'en dépend pas, ce qui est tout l'intérêt : sur un salon silencieux,
// c'est le seul mécanisme capable de déloger un Pokémon que personne n'attrape.
import db from "../../modules/points-db.js";
import { handleException, log } from "../../modules/utils.js";
import { endSpawnAsFled } from "../../modules/pokemon/spawn.js";

export default (bot) => {
  bot.handlePokemonFleeOnTimer = async () => {
    try {
      const now = Date.now();

      db.all(
        `SELECT * FROM pokemon_spawns
          WHERE status = 'ACTIVE' AND flees_at IS NOT NULL AND flees_at <= ?`,
        [now],
        (err, rows) => {
          if (err) return handleException("Balayage des fuites Pokémon :", err);

          // L'index unique partiel garantit un seul spawn actif ; la boucle
          // reste défensive et ne coûte rien.
          for (const spawn of rows || []) {
            db.run(
              `UPDATE pokemon_spawns SET status = 'FLED', ended_at = ?
                WHERE id = ? AND status = 'ACTIVE'`,
              [Date.now(), spawn.id],
              function (err) {
                if (err) return handleException("Fuite par expiration :", err);
                // Même garde que partout ailleurs : si une capture s'est
                // conclue entre la lecture et l'écriture, elle a gagné la
                // course et il n'y a rien à annoncer.
                if (this.changes !== 1) return;

                log(`Spawn #${spawn.id} : durée de vie écoulée, le Pokémon s'enfuit`);
                endSpawnAsFled(bot, spawn);
              }
            );
          }
        }
      );
    } catch (error) {
      handleException(error, "handlePokemonFleeOnTimer");
    }
  };
};
