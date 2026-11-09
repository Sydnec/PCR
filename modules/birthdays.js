// Logique pure des anniversaires : parsing de la saisie, calcul des dates.
// Isolée de Discord et de la base pour être testable sans client
// (test/birthdays.js), comme les autres règles de jeu du projet.
//
// L'année vaut null quand le membre ne veut pas donner son âge : tout ce qui
// en dépend (validation du 29 février, âge affiché) doit tolérer cette absence.

function isLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// Jours du mois. Année inconnue : février compte 29 jours, on accepte le
// 29 février (célébré le 28 les années non bissextiles, voir celebrationDayOf).
function daysInMonth(year, month) {
  if (month === 2) return year === null || isLeap(year) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// « JJ/MM » ou « JJ/MM/AAAA ». Renvoie { day, month, year } ou null : les
// refus sont traités par l'appelant, qui a le contexte Discord pour répondre.
export function parseBirthday(raw) {
  const match = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(String(raw).trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = match[3] ? Number(match[3]) : null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Un jour inexistant pour ce mois (31/04, 29/02 d'une année non bissextile)
  // est une faute de frappe, pas une préférence.
  if (day > daysInMonth(year, month)) return null;
  // Une année plausible : les centenaires du serveur sont invraisemblables,
  // les dates futures plus encore. 1900 est une borne de validation, pas une
  // valeur de jeu : elle vit ici, pas dans la configuration.
  if (year !== null && (year < 1900 || year > new Date().getFullYear())) return null;
  return { day, month, year };
}

// Le jour réellement fêté une année donnée : le 29 février se célèbre le 28
// les années non bissextiles — le membre existe, son anniversaire aussi.
export function celebrationDayOf({ day, month }, targetYear) {
  if (month === 2 && day === 29 && !isLeap(targetYear)) return 28;
  return day;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Prochaine date de fête, minuit local. Cette année si elle n'est pas passée,
// sinon l'an prochain — le 29 février recalculé pour l'année visée.
export function nextOccurrence(row, now = new Date()) {
  const thisYear = now.getFullYear();
  const when = new Date(thisYear, row.month - 1, celebrationDayOf(row, thisYear));
  if (when < startOfDay(now)) {
    const nextYear = thisYear + 1;
    return new Date(nextYear, row.month - 1, celebrationDayOf(row, nextYear));
  }
  return when;
}

// Jours restants avant la prochaine fête (0 = aujourd'hui).
export function daysUntil(row, now = new Date()) {
  return Math.round((nextOccurrence(row, now) - startOfDay(now)) / 86400000);
}

// Fête aujourd'hui ? Le filtre du minuteur quotidien, qui reçoit des lignes
// de base où month commence à 1 comme dans la saisie.
export function isToday(row, now = new Date()) {
  return (
    row.month === now.getMonth() + 1 &&
    celebrationDayOf(row, now.getFullYear()) === now.getDate()
  );
}

// « 24/07 » ou « 24/07/1998 », tel que saisi. Le jour et le mois sont
// complétés à deux chiffres : l'affichage ne dépend plus de la saisie.
export function formatBirthday({ day, month, year }) {
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return year === null ? `${dd}/${mm}` : `${dd}/${mm}/${year}`;
}
