// La courbe des soldes, lue dans le journal des points (points_log, que
// tiennent les déclencheurs de points-db.js) : le solde de chaque dresseur à
// intervalles réguliers entre deux dates, pour la page d'administration.
//
// Chaque intervalle garde le solde de son dernier mouvement, reporté tant que
// rien ne bouge. La réduction se fait dans SQLite : un journal de plusieurs
// mois ne traverse jamais la mémoire ligne à ligne.
import db from "./points-db.js";

// Une courbe se lit sur quelques centaines de points : davantage ne se verrait
// pas à l'écran, et ne ferait que grossir la réponse.
const STEPS = 240;

const all = (sql, params) =>
  new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows ?? [])))
  );

// Rappelle cb(err, { from, to, times, series }) : `times` les instants de la
// courbe, et pour chaque dresseur de la table des points, du plus riche au plus
// pauvre, `values` son solde à chacun d'eux. Avant son premier mouvement, c'est
// le solde d'avant (0 pour un nouveau venu) ; null seulement pour un dresseur
// que le journal ne connaît pas. `since` (ms) borne le début ; sans lui, et de
// toute façon, la courbe commence avec le journal.
export function getPointsHistory({ since = null } = {}, cb) {
  readHistory(since).then(
    (history) => cb(null, history),
    (err) => cb(err, null)
  );
}

async function readHistory(since) {
  const to = Date.now();
  const [{ start } = {}] = await all("SELECT MIN(created_at) AS start FROM points_log", []);
  const from = Math.min(to, Math.max(since ?? 0, start ?? to));
  // Un journal qui vient de naître n'a qu'un instant à montrer.
  const steps = to > from ? STEPS : 0;
  const step = steps ? Math.ceil((to - from) / steps) : 1;
  const times = Array.from({ length: steps + 1 }, (_, index) => Math.min(to, from + index * step));

  const [users, buckets] = await Promise.all([
    // Le solde au départ : le dernier mouvement jusqu'à `from`, ou, pour qui
    // est arrivé après, le solde d'avant son premier. Deux recherches dans
    // l'index (user_id, created_at) par dresseur, pas une lecture du journal.
    all(
      `SELECT user_id, balance,
              COALESCE(
                (SELECT balance FROM points_log l
                  WHERE l.user_id = p.user_id AND l.created_at <= ?
                  ORDER BY l.created_at DESC, l.id DESC LIMIT 1),
                (SELECT balance - delta FROM points_log l
                  WHERE l.user_id = p.user_id AND l.created_at > ?
                  ORDER BY l.created_at, l.id LIMIT 1)
              ) AS initial
         FROM points p
        ORDER BY balance DESC, user_id`,
      [from, from]
    ),
    // Le dernier mouvement de chaque intervalle ]from + (k-1)·step, from + k·step].
    // Le CAST n'est pas de trop : node-sqlite3 passe un horodatage en ms comme
    // un réel, et la division ne serait plus entière.
    all(
      `SELECT user_id, CAST((created_at - ? + ? - 1) / ? AS INTEGER) AS bucket, balance, MAX(id)
         FROM points_log
        WHERE created_at > ? AND created_at <= ?
        GROUP BY user_id, bucket`,
      [from, step, step, from, from + steps * step]
    ),
  ]);

  const moves = new Map();
  for (const row of buckets) {
    if (!moves.has(row.user_id)) moves.set(row.user_id, new Map());
    moves.get(row.user_id).set(row.bucket, row.balance);
  }

  const series = users.map(({ user_id: userId, balance, initial }) => {
    const changes = moves.get(userId);
    let value = initial ?? null;
    const values = times.map((_, index) => {
      if (index && changes?.has(index)) value = changes.get(index);
      return value;
    });
    return { userId, balance: balance ?? 0, values };
  });
  return { from, to, times, series };
}
