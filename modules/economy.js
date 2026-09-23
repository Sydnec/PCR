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
import { EmbedBuilder } from "discord.js";
import db from "./points-db.js";
import { handleException } from "./utils.js";
import { pseudo } from "./pseudo.js";

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

// Le solde mis en forme, et pas seulement calculé : il s'affiche à plusieurs
// endroits — sous une apparition, quand on le demande — et un montant à cinq
// chiffres sans séparateur ne se lit pas d'un coup d'œil. Une seule fonction
// pour tous ces endroits, comme la fiche d'espèce sert la commande et le bouton.
//
// Un embed de présentation dans un module de mutations, c'est délibéré : le
// solde est une notion d'économie, pas de Pokémon, et le prochain appelant n'a
// pas à aller le chercher dans les embeds du jeu.
//
// `balls` ajoute les balls en poche ({ label, emoji, count }, voir getBallStock) :
// les points ne disent pas tout de ce qu'on peut lancer, une ball offerte passant
// avant le solde. Absent — lecture de l'inventaire ratée — la ligne est omise
// plutôt que d'afficher un « aucune ball » qui serait faux.
export function buildBalanceEmbed(balance, { user = null, balls = null } = {}) {
  const lines = [`**${balance.toLocaleString("fr-FR")}** points`];
  if (balls) {
    lines.push(
      "",
      ...(balls.length
        ? balls.map((ball) => `${ball.emoji} ${ball.label} **\u00D7${ball.count}**`)
        : ["*Aucune ball en poche.*"])
    );
  }
  // Tout tient dans la description, sous le montant : c'est une seule réponse —
  // de quoi lancer — et non des rubriques à parcourir.
  const embed = new EmbedBuilder().setColor(0xf1c40f).setDescription(lines.join("\n"));

  // Sans destinataire nommé, on tutoie : c'est le cas de l'éphémère ouvert sous
  // une apparition, où le solde ne peut être que celui du cliqueur. /solde, lui,
  // peut viser quelqu'un d'autre, alors il le nomme et pose son avatar — deux
  // soldes affichés coup sur coup ne doivent pas pouvoir se confondre.
  if (!user) return embed.setTitle("\u{1F4B0} Ton solde");

  const avatar = user.displayAvatarURL?.();
  if (avatar) embed.setThumbnail(avatar);
  return embed.setTitle(`\u{1F4B0} Solde de ${user.displayName ?? user.username}`);
}

// Applique une série de mouvements { userId, amount } — un don collectif, un
// pot commun — séquentiellement : chaque addPoints est une écriture SQLite, les
// lancer en parallèle ne ferait que les mettre en file d'attente. Un échec
// n'interrompt pas les suivants : sur une distribution de masse, mieux vaut
// servir 49 membres sur 50 et le signaler que tout abandonner au premier
// incident. Rend le nombre d'échecs.
//
// Un seul mouvement de masse à la fois. Le verrou n'est pas du zèle : sans lui,
// deux appels concurrents s'emmêlent dans la transaction ci-dessous. SQLite
// refuse un BEGIN dans un BEGIN, et le COMMIT du plus court referme celle du
// plus long en plein milieu — on se retrouverait moins bien protégé qu'en
// n'ayant aucune transaction du tout. La file est en mémoire, et c'est
// suffisant : le bot est un processus unique, seul écrivain de cette base.
let queue = Promise.resolve();

export function applyMovements(movements) {
  const turn = queue.then(() => applyMovementsNow(movements));
  // La file ne doit pas se rompre sur un échec : on l'enchaîne sur une branche
  // neutralisée, l'erreur partant à l'appelant par `turn`.
  queue = turn.then(
    () => {},
    () => {}
  );
  return turn;
}

async function applyMovementsNow(movements) {
  // Une transaction, et non N écritures indépendantes. Un pot commun est à
  // somme nulle ; interrompu au deux centième mouvement sur quatre cents, il
  // crée ou détruit de la monnaie sans laisser trace de l'endroit où il s'est
  // arrêté. Ici, ou tout est appliqué, ou rien ne l'est.
  //
  // Aucun ROLLBACK volontaire : node-sqlite3 sérialise tout sur une connexion
  // unique, donc les écritures des autres composants émises pendant la fenêtre
  // entrent dans NOTRE transaction. Les annuler pour un mouvement raté
  // emporterait leurs points de message avec. On valide donc toujours, et l'on
  // se contente de compter les échecs ; seul un arrêt brutal déclenche une
  // annulation, et c'est là précisément qu'on la veut.
  const exec = (sql) =>
    new Promise((resolve) => db.run(sql, (err) => resolve(err ?? null)));

  const beginError = await exec("BEGIN IMMEDIATE");
  if (beginError) {
    // On continue quand même — les mouvements valent mieux que rien — mais sans
    // prétendre à l'atomicité, et en le disant. Message neutre : cette fonction
    // sert aussi /admin points sur un rôle, qui n'a rien à voir avec le pot commun.
    handleException("Transaction refusée, mouvements appliqués un à un :", beginError);
  }

  // Les échecs se journalisent APRÈS la transaction : retrouver un pseudo peut
  // demander à Discord, et rien ne doit la garder ouverte pendant ce temps.
  const failed = [];
  let commitError = null;
  try {
    for (const { userId, amount } of movements) {
      if (!amount) continue;
      const err = await new Promise((resolve) => addPoints(userId, amount, resolve));
      if (err) failed.push({ userId, amount, err });
    }
  } finally {
    // COMMIT tenté DANS TOUS LES CAS, y compris après un BEGIN refusé. Le sauter
    // était une erreur : un COMMIT raté laisse la transaction ouverte, tous les
    // BEGIN suivants échouent donc, et si chacun saute son COMMIT à son tour,
    // plus rien n'est jamais validé — ni les pots, ni les points de message, qui
    // partagent la connexion. Invisible jusqu'au redémarrage, qui annule tout.
    commitError = await exec("COMMIT");
    // « no transaction is active » est le cas bénin : il n'y en avait pas à
    // fermer, et c'est très bien.
    if (commitError && /no transaction is active/i.test(commitError.message)) commitError = null;
  }

  for (const { userId, amount, err } of failed) {
    handleException(`Mouvement de ${amount} points impossible pour ${await pseudo(userId)} :`, err);
  }
  const failures = failed.length;

  if (commitError) {
    handleException("Validation des mouvements impossible :", commitError);
    // SQLite a tout annulé : aucun solde n'a bougé. Rendre `failures: 0` ferait
    // journaliser un pot fantôme et consommerait l'échéance de la semaine.
    throw commitError;
  }
  return failures;
}
