// Mutations de solde atomiques.
//
// Le système de capture débite des points sur des clics simultanés : sans
// garde, deux lancers lancés en même temps peuvent faire passer un solde sous
// zéro. Une instruction UPDATE seule est une transaction en SQLite, donc
// « décrémenter si et seulement si le solde suffit » tient en une requête.
//
// À noter : db.serialize(async () => {...}) ne sérialise QUE la portion
// synchrone du callback, jusqu'au premier await. Ne comptez pas dessus pour
// protéger de l'argent — utilisez ces helpers et enchaînez les callbacks.
import db from "./points-db.js";
import { handleException } from "./utils.js";

// Débite cost points si le solde le permet.
// Rappelle cb(err, true) si le débit a eu lieu, cb(err, false) sinon.
// Un utilisateur absent de la table donne false : c'est le comportement voulu,
// il n'a jamais gagné le moindre point.
export function spendPoints(userId, cost, cb) {
  if (!Number.isInteger(cost) || cost < 0) {
    return cb(new Error(`Montant invalide : ${cost}`), false);
  }
  db.run(
    "UPDATE points SET balance = balance - ? WHERE user_id = ? AND balance >= ?",
    [cost, userId, cost],
    function (err) {
      // function() et non une flèche : this.changes n'existe pas autrement.
      if (err) return cb(err, false);
      cb(null, this.changes === 1);
    }
  );
}

// Crédite des points. Sert aux remboursements, toujours après un débit réussi,
// ce qui garantit que la ligne existe déjà.
export function addPoints(userId, amount, cb = () => {}) {
  db.run(
    `INSERT INTO points (user_id, balance) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET balance = balance + ?`,
    [userId, amount, amount],
    (err) => cb(err)
  );
}

export function getBalance(userId, cb) {
  db.get("SELECT balance FROM points WHERE user_id = ?", [userId], (err, row) => {
    if (err) return cb(err, 0);
    cb(null, row ? row.balance : 0);
  });
}

// Applique une série de mouvements { userId, amount } — un don collectif, un
// pot commun — séquentiellement : chaque addPoints est une écriture SQLite, les
// lancer en parallèle ne ferait que les mettre en file d'attente.
//
// Un échec n'interrompt pas les suivants : sur une distribution de masse, mieux
// vaut servir 49 membres sur 50 et le signaler que tout abandonner au premier
// incident. Rend le nombre d'échecs.
export async function applyMovements(movements) {
  // Une transaction, et non N écritures indépendantes. Un pot commun est
  // à somme nulle ; interrompu au deux centième mouvement sur quatre cents, il
  // crée ou détruit de la monnaie sans laisser trace de l'endroit où il s'est
  // arrêté. Ici, ou tout est appliqué, ou rien ne l'est.
  //
  // Aucun ROLLBACK volontaire : node-sqlite3 sérialise tout sur une connexion
  // unique, donc les écritures des autres composants émises pendant la fenêtre
  // entrent dans NOTRE transaction. Les annuler pour un mouvement raté
  // emporterait leurs points de message avec. On valide donc toujours, et l'on
  // se contente de compter les échecs ; seul un arrêt brutal déclenche une
  // annulation, et c'est là précisément qu'on la veut.
  const exec = (sql) => new Promise((resolve) => db.run(sql, () => resolve()));
  await exec("BEGIN IMMEDIATE");
  let failures = 0;
  try {
    for (const { userId, amount } of movements) {
      if (!amount) continue;
      // eslint-disable-next-line no-await-in-loop
      const err = await new Promise((resolve) => addPoints(userId, amount, resolve));
      if (err) {
        failures++;
        handleException(`Mouvement de ${amount} points impossible pour ${userId} :`, err);
      }
    }
  } finally {
    await exec("COMMIT");
  }
  return failures;
}
