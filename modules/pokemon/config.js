// Helpers de domaine au-dessus du bloc `pokemon` de la config.
//
// La lecture du fichier, les valeurs par défaut et la fusion vivent dans
// modules/config.js, qui en est le propriétaire unique : ce module n'en expose
// que la tranche Pokémon et les commodités qui vont avec.
import { DEFAULTS, getConfig } from "../config.js";

export function getPokemonConfig() {
  return getConfig().pokemon;
}

// Les réglages du bilan de saison. config.json est un fichier qu'on retouche à la main : une
// valeur qui n'est pas un entier positif retombe sur celle du code (DEFAULTS), plutôt que de
// donner un classement de longueur NaN ou un bail d'un envoi qui n'expire jamais.
export function getSeasonRecapConfig() {
  const config = getPokemonConfig().seasonRecap ?? {};
  const fallback = DEFAULTS.pokemon.seasonRecap;
  const whole = (key, min = 1) => {
    const value = Math.floor(Number(config[key]));
    return Number.isFinite(value) && value >= min ? value : fallback[key];
  };
  return {
    enabled: config.enabled !== false,
    topSize: whole("topSize"),
    podiumSize: whole("podiumSize"),
    minThrowsForLuck: whole("minThrowsForLuck"),
    minLotteryDraws: whole("minLotteryDraws"),
    minSpawnsForFleeRate: whole("minSpawnsForFleeRate"),
    publishWithinHours: whole("publishWithinHours"),
    retryMinutes: whole("retryMinutes"),
    // Zéro est une valeur valable : pas de retentative, ou pas d'attente.
    recordRetries: whole("recordRetries", 0),
    recordRetryDelayMs: whole("recordRetryDelayMs", 0),
  };
}

// Renvoie la définition d'une ball, ou null si la clé est inconnue.
export function getBall(key) {
  const special = getSpecialBalls().find((ball) => ball.key === key);
  if (special) return special;
  const balls = getPokemonConfig().capture.balls;
  // hasOwnProperty : sans lui, une clé héritée (« constructor », par exemple)
  // renvoyait un objet tronqué au lieu de null, et le lancer partait avec un
  // prix indéfini.
  if (!Object.prototype.hasOwnProperty.call(balls, key)) return null;
  const ball = balls[key];
  return ball ? { key, ...ball } : null;
}

// Les balls spéciales de la boutique, marquées `special` pour que le lancer les
// distingue des balls ordinaires (capture.balls), qu'elles ne rejoignent jamais :
// les fiches et les probabilités affichées n'ont pas à les compter.
export function getSpecialBalls() {
  const balls = getPokemonConfig().capture.specialBalls ?? {};
  return Object.entries(balls)
    .filter(([key]) => key !== "maxHeld")
    .map(([key, ball]) => ({ key, special: true, ...ball }));
}

export const specialBallLimit = () =>
  Math.max(1, Math.floor(Number(getPokemonConfig().capture.specialBalls?.maxHeld) || 10));

export function getBalls() {
  const balls = getPokemonConfig().capture.balls;
  return Object.entries(balls).map(([key, ball]) => ({ key, ...ball }));
}

// Une ball dont le prix monte à chaque achat : il dépend de celui qui la paie,
// donc ne se lit pas dans la config seule (getBallPrice, capture.js) ni sur un
// message identique pour tous. `priceGrowth` à 1 la rend à prix fixe.
export const hasPersonalPrice = (ball) => Number(ball.priceGrowth) > 1;

// Le prix de la ball quand son dresseur en a déjà payé `purchases` en points.
// Calculé depuis le prix de base plutôt que de proche en proche : l'arrondi ne
// s'accumule pas d'un achat à l'autre. Plafonné, car un facteur réglé très haut
// finirait par donner un prix infini, qui ne se paie ni ne s'affiche.
export function priceAfter(ball, purchases) {
  if (!hasPersonalPrice(ball)) return ball.price;
  return Math.min(
    Math.round(ball.price * Number(ball.priceGrowth) ** purchases),
    Number.MAX_SAFE_INTEGER
  );
}

// Réglages du parc safari, avec la Safari Ball déjà mise en forme comme les
// balls de capture (clé comprise) pour que les embeds n'aient pas à distinguer
// les deux familles.
export function getSafariConfig() {
  const safari = getPokemonConfig().safari;
  return { ...safari, ball: { key: "safari", ...safari.ball } };
}
