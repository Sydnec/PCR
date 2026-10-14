// La pêche. On lance la ligne avec une canne, pour le prix de cette canne, et un
// Pokémon tiré dans sa table (les taux officiels, pokemon-fishing.json) mord : il est
// réservé au pêcheur, que lui seul voit, et il s'enfuit au bout de `fishing.fleeSeconds`.
// Contrairement au safari, les balls se paient comme sur une apparition du salon.
//
// Une pêche est une ligne de pokemon_spawns au statut FISHING — jamais ACTIVE : l'index
// qui n'autorise qu'une apparition du salon à la fois n'est pas concerné, et la capture
// passe par le même resolveThrow. Un dresseur n'en a qu'une à la fois : une touche
// sans réponse bloque la suivante jusqu'à sa fuite.
//
// Retirer avant de créditer : les points partent d'abord, et reviennent si la touche
// ne peut pas être enregistrée.
import db from "../points-db.js";
import { addPoints, getBalance, spendPoints } from "../economy.js";
import { handleException } from "../utils.js";
import { getPokemonConfig } from "./config.js";
import {
  fishingOpen,
  generationOrdinal,
  pickFished,
  rarityOf,
  rollForm,
  rollSex,
  rollShiny,
} from "./data.js";
import { getInventory, getItem, getItems, grantItemOnce, rollHeldItem } from "./items.js";

const fr = (value) => value.toLocaleString("fr-FR");

// Les cannes du catalogue, de la moins chère à la plus chère.
export const getRods = () =>
  getItems()
    .filter((item) => item.rod)
    .sort((a, b) => a.rod.price - b.rod.price);

// La Canne de base est donnée à tous, une seule fois : grantItemOnce ne passe que si
// l'objet est absent, et la Canne ne s'échange ni ne se revend, donc elle n'est jamais
// redonnée à qui l'a eue.
function ensureBaseRod(userId, cb) {
  const base = getRods().find((rod) => rod.rod.base);
  if (!base) return cb(null);
  grantItemOnce(userId, base.key, { source: "peche" }, (err) => {
    if (err) handleException("Don de la Canne de base :", err);
    cb(err);
  });
}

// Les cannes ouvertes, avec ce que le dresseur en possède. La pêche ouverte, il a au moins
// la Canne de base.
export function getRodsOf(userId, cb) {
  if (!fishingOpen()) return cb(null, []);
  ensureBaseRod(userId, (baseError) => {
    if (baseError) return cb(baseError);
    getInventory(userId, (err, inventory) => {
      if (err) return cb(err);
      const held = new Map(inventory.map((row) => [row.item_key, row.count]));
      cb(
        null,
        getRods().map((item) => ({
          key: item.key,
          label: item.label,
          emoji: item.emoji,
          sprite: item.sprite ?? null,
          description: item.description ?? null,
          price: item.rod.price,
          owned: (held.get(item.key) ?? 0) > 0,
        }))
      );
    });
  });
}

// Une pêche qui n'a pas été lancée à temps s'est enfuie : on la ferme à la lecture,
// sans minuteur — l'échéance est en base, donc elle survit aux redémarrages.
function closeExpired(userId, cb) {
  db.run(
    `UPDATE pokemon_spawns SET status = 'FLED', ended_at = ?
      WHERE status = 'FISHING' AND reserved_for = ? AND flees_at <= ?`,
    [Date.now(), String(userId), Date.now()],
    (err) => cb(err)
  );
}

// La pêche en cours de ce dresseur, ou null.
export function getFishingSpawn(userId, cb) {
  closeExpired(userId, (err) => {
    if (err) return cb(err);
    db.get(
      "SELECT * FROM pokemon_spawns WHERE status = 'FISHING' AND reserved_for = ?",
      [String(userId)],
      (err, row) => cb(err, row ?? null)
    );
  });
}

// Lance la ligne : `cb(err, { ok, spawn? , reason?, existing? })`. Un refus ne coûte rien et
// donne ses chiffres.
export function castLine(userId, rodKey, cb) {
  const id = String(userId);
  if (!fishingOpen()) {
    const generation = Number(getPokemonConfig().fishing?.generation) || 2;
    return cb(null, {
      ok: false,
      reason: `La pêche ouvre avec la ${generationOrdinal(generation)} génération.`,
    });
  }
  const rod = getItem(rodKey);
  if (!rod?.rod) return cb(null, { ok: false, reason: "Choisis une canne dans la liste." });

  ensureBaseRod(id, (baseError) => {
    if (baseError) return cb(baseError);
    getInventory(id, (err, inventory) => {
      if (err) return cb(err);
      if (!inventory.some((row) => row.item_key === rod.key && row.count > 0)) {
        return cb(null, { ok: false, reason: `Tu n'as pas de ${rod.label}.` });
      }
      getFishingSpawn(id, (err, existing) => {
        if (err) return cb(err);
        if (existing) {
          return cb(null, {
            ok: false,
            existing,
            reason: "Tu as déjà une touche au bout de ta ligne : lance une ball, ou attends qu'elle s'enfuie.",
          });
        }
        const species = pickFished(rod.rod.pool);
        if (!species) {
          return cb(null, { ok: false, reason: "Rien ne mord pour l'instant avec cette canne." });
        }
        spendPoints(id, rod.rod.price, (err, debited) => {
          if (err) return cb(err);
          if (!debited) {
            return getBalance(id, (err, balance) =>
              err
                ? cb(err)
                : cb(null, {
                    ok: false,
                    reason: `La ${rod.label} pêche à ${fr(rod.rod.price)} points, tu en as ${fr(balance)}.`,
                  })
            );
          }
          openFishingSpawn(id, species, (err, spawn) => {
            if (!err && spawn) return cb(null, { ok: true, spawn, rod, price: rod.rod.price });
            // La touche n'a pas pu être enregistrée : les points reviennent. L'index
            // unique refuse une seconde pêche lancée en même temps par le même dresseur.
            addPoints(id, rod.rod.price, (refundError) => {
              if (refundError) handleException("Remboursement d'une pêche :", refundError);
              if (err && !/UNIQUE/i.test(err.message)) return cb(err);
              cb(null, {
                ok: false,
                reason: "Tu as déjà une touche au bout de ta ligne : lance une ball, ou attends qu'elle s'enfuie.",
              });
            });
          });
        });
      });
    });
  });
}

// Enregistre la touche : sexe, forme, objet tenu et shiny tirés ici, une fois, comme pour
// une apparition du salon.
function openFishingSpawn(userId, species, cb) {
  const config = getPokemonConfig();
  const now = Date.now();
  const fleeMs = Math.max(1, Number(config.fishing?.fleeSeconds) || 120) * 1000;
  const { shiny, charm } = rollShiny(config.spawn.shinyOdds);
  db.run(
    `INSERT INTO pokemon_spawns
       (species_id, is_shiny, catch_rate, rarity, status, spawned_at, flees_at, held_item, sex,
        charm_shiny, form, fished, reserved_for)
     VALUES (?, ?, ?, ?, 'FISHING', ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      species.id,
      shiny ? 1 : 0,
      species.catchRate,
      rarityOf(species),
      now,
      now + fleeMs,
      rollHeldItem(),
      rollSex(species),
      charm ? 1 : 0,
      rollForm(species),
      userId,
    ],
    function (err) {
      if (err) return cb(err);
      db.get("SELECT * FROM pokemon_spawns WHERE id = ?", [this.lastID], cb);
    }
  );
}
