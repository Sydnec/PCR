// Ce qu'un Pokémon laisse tomber en partant.
//
// Un Pokémon sur quelques-uns tient un objet. En temps normal il part avec celui
// qui l'attrape ; une fois sur cinq il le lâche par terre, et là c'est une
// seconde course — ouverte à tout le monde, y compris à ceux qui n'ont pas lancé
// une seule ball. C'est aussi la seule chose qu'un Pokémon enfui laisse derrière
// lui, ce qui donne une raison de suivre une apparition qu'on sait perdue.
//
// Même doctrine que le reste : l'objet au sol est une ligne en base, sa
// revendication un UPDATE gardé dont on inspecte this.changes. Deux clics
// simultanés, un seul ramasseur — et le bouton répond encore après un
// redémarrage du bot.
import db from "../points-db.js";
import { handleException, log } from "../utils.js";
import { getPokemonConfig } from "./config.js";
import { getItem, grantItem } from "./items.js";
import { buildDropEmbed, buildDropRow } from "./embeds.js";

// Le tirage, et lui seul : les appelants décident quoi en faire. Sortir le
// hasard de la décision rend le reste testable et lisible.
export function leavesItemBehind() {
  const chance = Number(getPokemonConfig().spawn?.itemDropChance) || 0;
  return chance > 0 && Math.random() < chance;
}

export function getDrop(dropId, cb) {
  db.get("SELECT * FROM pokemon_drops WHERE id = ?", [dropId], cb);
}

// Pose l'objet par terre et l'annonce. L'annonce est best-effort : un salon
// injoignable ne doit pas empêcher la ligne d'exister, mais un objet dont
// personne ne voit le message n'a aucun intérêt — on le referme donc plutôt que
// de le laisser ouvert pour l'éternité.
export function dropItem(client, { spawn, itemKey }, cb = () => {}) {
  const item = getItem(itemKey);
  if (!item) return cb(null, null);

  db.run(
    `INSERT INTO pokemon_drops (spawn_id, item_key, species_id, channel_id, dropped_at)
     VALUES (?, ?, ?, ?, ?)`,
    [spawn?.id ?? null, itemKey, spawn?.species_id ?? null, spawn?.channel_id ?? null, Date.now()],
    async function (err) {
      if (err) {
        handleException("Dépôt d'un objet au sol :", err);
        return cb(err, null);
      }
      const dropId = this.lastID;

      if (!client || !spawn?.channel_id) return cb(null, dropId);
      try {
        const channel = await client.channels.fetch(spawn.channel_id);
        const message = await channel.send({
          embeds: [buildDropEmbed(item)],
          components: [buildDropRow(dropId)],
        });
        db.run(
          "UPDATE pokemon_drops SET message_id = ? WHERE id = ?",
          [message.id, dropId],
          (err) => {
            if (err) handleException("Enregistrement du message d'objet au sol :", err);
          }
        );
        log(`Objet au sol #${dropId} : ${item.label} (spawn #${spawn.id ?? "—"})`);
      } catch (error) {
        handleException("Annonce d'un objet au sol :", error);
        db.run("UPDATE pokemon_drops SET status = 'LOST' WHERE id = ?", [dropId], () => {});
        return cb(error, null);
      }
      cb(null, dropId);
    }
  );
}

// Revendication atomique. Rend la définition de l'objet au vainqueur, et null à
// tous les autres : « quelqu'un a été plus rapide » n'est pas une erreur.
export function claimDrop(userId, dropId, cb) {
  db.run(
    `UPDATE pokemon_drops SET status = 'CLAIMED', claimed_by = ?, claimed_at = ?
      WHERE id = ? AND status = 'OPEN'`,
    [userId, Date.now(), dropId],
    function (err) {
      if (err) return cb(err, null);
      if (this.changes !== 1) return cb(null, null);

      getDrop(dropId, (err, drop) => {
        if (err || !drop) return cb(err ?? new Error(`Objet au sol introuvable : ${dropId}`), null);
        const item = getItem(drop.item_key);
        if (!item) {
          // Clé disparue du catalogue entre le dépôt et le ramassage : on rouvre
          // plutôt que de faire disparaître l'objet dans le vide.
          db.run("UPDATE pokemon_drops SET status = 'OPEN', claimed_by = NULL WHERE id = ?", [dropId], () => {});
          return cb(new Error(`Objet au sol inconnu : ${drop.item_key}`), null);
        }

        grantItem(userId, drop.item_key, 1, { source: `sol:${dropId}` }, (err) => {
          if (err) {
            // Le crédit a échoué : l'objet retourne par terre, sans quoi il
            // serait perdu pour tout le monde.
            db.run(
              "UPDATE pokemon_drops SET status = 'OPEN', claimed_by = NULL, claimed_at = NULL WHERE id = ?",
              [dropId],
              (reopenError) => {
                if (reopenError) handleException("Réouverture d'un objet au sol :", reopenError);
              }
            );
            return cb(err, null);
          }
          log(`Objet au sol #${dropId} ramassé par ${userId} (${item.label})`);
          cb(null, { drop, item });
        });
      });
    }
  );
}
