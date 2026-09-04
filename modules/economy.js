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
