// La vitrine : les Pokémon qu'un dresseur expose aux autres membres, pour
// frimer. Du décor, comme le rangement du PC : elle ne change rien au jeu, et
// un Pokémon exposé reste jouable. Son rang vit dans sa ligne
// (`pokemon_owned.showcase_pos`), si bien qu'un Pokémon revendu ou sacrifié
// quitte la vitrine avec la boîte, qu'un échangé la quitte en changeant de
// dresseur, et qu'un Pokémon qui évolue y reste, lui-même sous sa nouvelle
// forme.
import db from "../points-db.js";
import { getPokemonConfig } from "./config.js";

// Combien de Pokémon une vitrine expose au plus (`pokemon.showcase.slots`).
export const showcaseSlots = () =>
  Math.max(1, Math.floor(Number(getPokemonConfig().showcase?.slots) || 1));

// Les Pokémon exposés par un dresseur, dans l'ordre de sa vitrine. Une
// compensation a pu y remettre un Pokémon de plus que la vitrine n'en montre :
// seuls les premiers comptent.
export function getShowcase(userId, cb) {
  db.all(
    `SELECT * FROM pokemon_owned
      WHERE user_id = ? AND showcase_pos IS NOT NULL
      ORDER BY showcase_pos, id
      LIMIT ?`,
    [String(userId), showcaseSlots()],
    (err, rows) => cb(err, rows || [])
  );
}

// Les dresseurs qui exposent quelque chose, les vitrines les plus garnies
// d'abord : de quoi aller voir celles des autres.
export function listShowcases(cb) {
  db.all(
    `SELECT user_id, MIN(COUNT(*), ?) AS count FROM pokemon_owned
      WHERE showcase_pos IS NOT NULL
      GROUP BY user_id
      ORDER BY count DESC, user_id`,
    [showcaseSlots()],
    (err, rows) => cb(err, rows || [])
  );
}

// Expose un Pokémon, au bout de la vitrine. Une seule écriture, gardée dans
// son WHERE : le Pokémon est bien à lui, pas déjà exposé, et il reste une
// place. Le refus se lit ensuite, pour dire lequel des trois a manqué.
export function addToShowcase(userId, pokemonId, cb) {
  const slots = showcaseSlots();
  db.run(
    `UPDATE pokemon_owned
        SET showcase_pos = COALESCE(
          (SELECT MAX(showcase_pos) FROM pokemon_owned WHERE user_id = $user), 0) + 1
      WHERE id = $id AND user_id = $user AND showcase_pos IS NULL
        AND (SELECT COUNT(*) FROM pokemon_owned
              WHERE user_id = $user AND showcase_pos IS NOT NULL) < $slots`,
    { $user: String(userId), $id: Number(pokemonId), $slots: slots },
    function (err) {
      if (err) return cb(err);
      if (this.changes === 1) return cb(null, { ok: true });
      db.get(
        `SELECT
           (SELECT showcase_pos FROM pokemon_owned WHERE id = $id AND user_id = $user) AS pos,
           (SELECT COUNT(*) FROM pokemon_owned WHERE id = $id AND user_id = $user) AS mine,
           (SELECT COUNT(*) FROM pokemon_owned
             WHERE user_id = $user AND showcase_pos IS NOT NULL) AS shown`,
        { $user: String(userId), $id: Number(pokemonId) },
        (err, row) => {
          if (err) return cb(err);
          if (!row?.mine) {
            return cb(null, {
              ok: false,
              reason: `Le Pokémon #${pokemonId} n'est pas dans ta boîte.`,
            });
          }
          if (row.pos !== null) {
            return cb(null, {
              ok: false,
              reason: `Le Pokémon #${pokemonId} est déjà dans ta vitrine.`,
            });
          }
          cb(null, {
            ok: false,
            reason:
              `Ta vitrine est pleine (${Math.min(row.shown, slots)}/${slots}) : retires-en un ` +
              `d'abord.`,
          });
        }
      );
    }
  );
}

// Retire un Pokémon de la vitrine ; `removed` dit s'il y était.
export function removeFromShowcase(userId, pokemonId, cb) {
  db.run(
    `UPDATE pokemon_owned SET showcase_pos = NULL
      WHERE id = ? AND user_id = ? AND showcase_pos IS NOT NULL`,
    [Number(pokemonId), String(userId)],
    function (err) {
      cb(err, this ? this.changes === 1 : false);
    }
  );
}

// Range la vitrine dans l'ordre donné (des identifiants). Seuls les Pokémon
// encore exposés et encore à lui bougent : un ordre venu d'une page périmée
// n'expose rien de plus.
export function orderShowcase(userId, ids, cb) {
  const order = [...new Set(ids.map(Number))].filter(Number.isInteger);
  if (!order.length) return cb(null, 0);
  const cases = order.map(() => "WHEN ? THEN ?").join(" ");
  db.run(
    `UPDATE pokemon_owned SET showcase_pos = CASE id ${cases} END
      WHERE user_id = ? AND showcase_pos IS NOT NULL
        AND id IN (${order.map(() => "?").join(", ")})`,
    [...order.flatMap((id, index) => [id, index + 1]), String(userId), ...order],
    function (err) {
      cb(err, this ? this.changes : 0);
    }
  );
}

// Met un Pokémon exposé à la place `place` (1 = la première), les autres se
// décalant. Rien ne s'expose ni ne sort ici : seul l'ordre change.
export function moveInShowcase(userId, pokemonId, place, cb) {
  getShowcase(userId, (err, rows) => {
    if (err) return cb(err);
    const ids = rows.map((row) => row.id).filter((id) => id !== Number(pokemonId));
    if (ids.length === rows.length) return cb(null, false);
    const at = Math.max(0, Math.min(ids.length, Math.floor(Number(place) || 1) - 1));
    ids.splice(at, 0, Number(pokemonId));
    orderShowcase(userId, ids, (err) => cb(err, !err));
  });
}

// Revendique l'envoi de la vitrine dans un salon : un par dresseur toutes les
// `shareCooldownMinutes`. L'INSERT gardé tranche, this.changes le dit ; un
// refus rend l'heure du prochain envoi possible. `sharedAt` sert à rendre la
// revendication si l'envoi échoue à coup sûr (releaseShowcaseShare).
export function claimShowcaseShare(userId, cb) {
  const now = Date.now();
  const cooldown = Math.max(0, Number(getPokemonConfig().showcase?.shareCooldownMinutes) || 0);
  db.run(
    `INSERT INTO pokemon_showcase_shares (user_id, shared_at) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET shared_at = excluded.shared_at
      WHERE shared_at <= ?`,
    [String(userId), now, now - cooldown * 60_000],
    function (err) {
      if (err) return cb(err);
      if (this.changes === 1) return cb(null, { ok: true, sharedAt: now });
      db.get(
        "SELECT shared_at FROM pokemon_showcase_shares WHERE user_id = ?",
        [String(userId)],
        (err, row) => {
          if (err) return cb(err);
          cb(null, { ok: false, retryAt: (row?.shared_at ?? now) + cooldown * 60_000 });
        }
      );
    }
  );
}

// Rend la revendication d'un envoi qui n'a pas pu partir : le dresseur peut
// réessayer tout de suite. Gardé sur l'heure revendiquée, pour ne pas effacer
// un envoi plus récent.
export function releaseShowcaseShare(userId, sharedAt, cb = () => {}) {
  db.run(
    "UPDATE pokemon_showcase_shares SET shared_at = 0 WHERE user_id = ? AND shared_at = ?",
    [String(userId), sharedAt],
    (err) => cb(err)
  );
}
