// Le starter de génération. À l'ouverture d'une génération qui en prévoit
// (pokemon.starters.choices), chaque dresseur en choisit un parmi trois, une fois,
// définitivement : il reçoit tout de suite son stade 1. Compléter ensuite le
// Pokédex de la génération — hors légendaires, comme le Charme Chroma — lui donne
// les évolutions de son starter par paliers, puis le stade 1 en shiny.
//
// Rien n'est tenu en mémoire : le choix et les paliers donnés vivent en base. Un
// choix tardif rattrape tout ce que le Pokédex a déjà atteint, et le démarrage
// rattrape ce que la vérification n'aurait pas encore donné.
import db from "../points-db.js";
import { handleException, log } from "../utils.js";
import { pseudo } from "../pseudo.js";
import { getPokemonConfig } from "./config.js";
import { activeGeneration, generationOrdinal, getSpecies } from "./data.js";
import { charmSpecies } from "./charms.js";
import { creditSpecies } from "./collection.js";
import { resolveChannel } from "./spawn.js";

let bot = null;
export function setStarterClient(client) {
  bot = client;
}

const config = () => getPokemonConfig().starters ?? { choices: {}, rewards: [] };

// Les paliers de la configuration, triés et nettoyés : un réglage à chaud ne passe
// pas par des bornes. Un palier sans stade valide donnerait une seconde copie du
// stade 1, un pourcentage nul ou au-delà de 100 serait dû tout de suite ou jamais, et
// deux paliers au même pourcentage ne se revendiquent qu'une fois.
export function starterTiers() {
  const seen = new Set();
  return (config().rewards ?? [])
    .filter((tier) => {
      const valid =
        Number.isInteger(tier?.stage) &&
        tier.stage >= 1 &&
        tier.percent > 0 &&
        tier.percent <= 100 &&
        Number.isInteger(tier.percent) &&
        !seen.has(tier.percent);
      if (valid) seen.add(tier.percent);
      return valid;
    })
    .sort((a, b) => a.percent - b.percent);
}

// Les starters proposés pour une génération : ceux de la configuration qui
// existent dans le jeu de données. Vide, la génération n'a pas de choix.
export function starterChoices(generation) {
  return (config().choices?.[generation] ?? []).map(getSpecies).filter(Boolean);
}

// Les générations ouvertes qui proposent un choix, dans l'ordre.
export function starterGenerations() {
  const active = activeGeneration();
  return Object.keys(config().choices ?? {})
    .map(Number)
    .filter((generation) => generation >= 1 && generation <= active && starterChoices(generation).length)
    .sort((a, b) => a - b);
}

// La génération dont `speciesId` est un des starters proposés, parmi celles qui
// sont ouvertes. Le choix se retrouve ainsi depuis l'espèce seule, qui est la valeur
// d'autocomplétion et le numéro du bouton de confirmation.
export const generationOfStarter = (speciesId) =>
  starterGenerations().find((generation) =>
    starterChoices(generation).some((species) => species.id === Number(speciesId))
  ) ?? null;

// L'espèce de la lignée d'un starter au `stage` demandé (1 : lui-même). Lue sur les
// données brutes : les évolutions d'une génération fermée n'en sont pas filtrées,
// puisque le rang d'une lignée ne dépend pas de l'ouverture du jeu. Null si la
// lignée est plus courte.
export function lineageAt(starter, stage) {
  let current = starter;
  for (let step = 1; step < stage; step++) {
    current = getSpecies(current?.evolvesInto?.[0]);
    if (!current) return null;
  }
  return current ?? null;
}

// Le starter choisi par `userId` pour une génération, ou null.
export function getStarter(userId, generation, cb) {
  db.get(
    "SELECT species_id FROM pokemon_starters WHERE user_id = ? AND generation = ?",
    [String(userId), generation],
    (err, row) => cb(err, row ? getSpecies(row.species_id) : null)
  );
}

export function getStarters(userId, cb) {
  db.all(
    "SELECT generation, species_id FROM pokemon_starters WHERE user_id = ? ORDER BY generation",
    [String(userId)],
    (err, rows) =>
      cb(
        err,
        (rows ?? []).map((row) => ({ generation: row.generation, species: getSpecies(row.species_id) }))
      )
  );
}

// Les paliers déjà donnés pour une génération, en pourcentages.
export function givenTiers(userId, generation, cb) {
  db.all(
    "SELECT percent FROM pokemon_starter_rewards WHERE user_id = ? AND generation = ?",
    [String(userId), generation],
    (err, rows) => cb(err, new Set((rows ?? []).map((row) => row.percent)))
  );
}

// Où en est le Pokédex d'une génération pour ce dresseur : les espèces qu'il
// possède sur celles qui comptent (hors légendaires), comme le Charme Chroma.
export function starterProgress(userId, generation, cb) {
  const needed = charmSpecies(generation);
  db.all(
    "SELECT DISTINCT species_id FROM pokemon_owned WHERE user_id = ?",
    [String(userId)],
    (err, rows) => {
      if (err) return cb(err);
      const owned = new Set((rows ?? []).map((row) => row.species_id));
      const have = needed.filter((species) => owned.has(species.id)).length;
      cb(null, { have, total: needed.length });
    }
  );
}

// Un palier est atteint quand `percent` % du Pokédex est possédé. Sans espèce à
// compter, rien n'est atteint : un Pokédex vide de sens ne récompense personne.
export const tierReached = ({ have, total }, percent) => total > 0 && have * 100 >= percent * total;

// Le choix d'un starter. La ligne de choix est la revendication : INSERT OR IGNORE
// ne passe qu'une fois par dresseur et par génération, même sous deux clics
// simultanés. Le stade 1 se donne après, et la ligne se retire si le don échoue :
// rien ne se perd, rien ne se crée. Les paliers déjà atteints se donnent aussitôt.
// `cb(err, { ok, reason?, species?, rewards? })`.
export function chooseStarter(userId, generation, speciesId, cb) {
  const choices = starterChoices(generation);
  if (!starterGenerations().includes(generation)) {
    return cb(null, { ok: false, reason: "Cette génération ne propose pas de starter." });
  }
  const species = choices.find((entry) => entry.id === Number(speciesId));
  if (!species) {
    return cb(null, { ok: false, reason: "Ce Pokémon n'est pas l'un des starters proposés." });
  }
  db.run(
    "INSERT OR IGNORE INTO pokemon_starters (user_id, generation, species_id, chosen_at) VALUES (?, ?, ?, ?)",
    [String(userId), generation, species.id, Date.now()],
    function (err) {
      if (err) return cb(err);
      if (this.changes === 0) {
        return getStarter(userId, generation, (err, chosen) => {
          if (err) return cb(err);
          cb(null, {
            ok: false,
            reason:
              `Tu as déjà choisi **${chosen?.name ?? "un starter"}** pour la ` +
              `${generationOrdinal(generation)} génération : le choix est définitif.`,
          });
        });
      }
      creditSpecies(String(userId), species.id, false, { origin: "starter", checkStarters: false }, (creditError) => {
        if (creditError) {
          return db.run(
            "DELETE FROM pokemon_starters WHERE user_id = ? AND generation = ?",
            [String(userId), generation],
            (deleteError) => {
              if (deleteError) handleException("Annulation d'un choix de starter :", deleteError);
              cb(creditError);
            }
          );
        }
        checkStarterRewards(userId, (err, rewards) => {
          if (err) handleException("Paliers d'un starter :", err);
          cb(null, { ok: true, species, rewards: rewards ?? [] });
        });
      });
    }
  );
}

// Donne à `userId` les paliers de ses starters que son Pokédex a atteints et qu'il
// n'a pas encore reçus. Sûr à appeler aussi souvent qu'on veut : chaque palier se
// revendique d'abord (INSERT OR IGNORE) et la revendication se retire si le don
// échoue, si bien qu'un palier ne se donne jamais deux fois ni ne se perd. Rend
// les paliers donnés par cet appel.
export function checkStarterRewards(userId, cb = () => {}) {
  const tiers = starterTiers();
  getStarters(userId, async (err, starters) => {
    if (err) {
      handleException("Lecture des starters :", err);
      return cb(err, []);
    }
    const given = [];
    const active = activeGeneration();
    for (const { generation, species: starter } of starters) {
      if (!starter || generation > active) continue;
      // Une récompense est une espèce de plus au Pokédex de la génération, qui
      // peut atteindre le palier suivant : on relit jusqu'à ce que plus rien ne soit
      // à donner.
      for (let pass = 0; pass <= tiers.length; pass++) {
        const progress = await new Promise((resolve) =>
          starterProgress(userId, generation, (err, value) => resolve(err ? null : value))
        );
        const done = await new Promise((resolve) =>
          givenTiers(userId, generation, (err, value) => resolve(err ? null : value))
        );
        if (!progress || !done) break;
        const due = tiers.filter((tier) => !done.has(tier.percent) && tierReached(progress, tier.percent));
        let gave = 0;
        for (const tier of due) {
          const reward = await giveTier(userId, generation, starter, tier);
          if (reward) {
            given.push(reward);
            gave++;
          }
        }
        if (!gave) break;
      }
    }
    cb(null, given);
  });
}

// Un palier : revendiqué, donné, annoncé. Null s'il était déjà pris ou si le don a
// échoué (la revendication est alors retirée, le prochain passage réessaie).
function giveTier(userId, generation, starter, tier) {
  const target = lineageAt(starter, tier.stage);
  if (!target) {
    handleException(
      "Palier de starter sans espèce :",
      new Error(`${starter.name}, stade ${tier.stage}`)
    );
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    db.run(
      `INSERT OR IGNORE INTO pokemon_starter_rewards (user_id, generation, percent, given_at)
       VALUES (?, ?, ?, ?)`,
      [String(userId), generation, tier.percent, Date.now()],
      function (err) {
        if (err) {
          handleException("Revendication d'un palier de starter :", err);
          return resolve(null);
        }
        if (this.changes === 0) return resolve(null);
        creditSpecies(
          String(userId),
          target.id,
          Boolean(tier.shiny),
          { origin: "starter", checkStarters: false },
          (creditError) => {
            if (creditError) {
              handleException("Don d'un palier de starter :", creditError);
              return db.run(
                "DELETE FROM pokemon_starter_rewards WHERE user_id = ? AND generation = ? AND percent = ?",
                [String(userId), generation, tier.percent],
                () => resolve(null)
              );
            }
            const reward = { generation, percent: tier.percent, species: target, shiny: Boolean(tier.shiny) };
            announceTier(userId, reward);
            resolve(reward);
          }
        );
      }
    );
  });
}

async function announceTier(userId, { generation, percent, species, shiny }) {
  pseudo(userId).then((name) =>
    log(`Starter : ${name} reçoit ${species.name}${shiny ? " ✨" : ""} (${percent} % de la ${generationOrdinal(generation)} génération)`)
  );
  if (!bot) return;
  try {
    const channel = await resolveChannel(bot);
    if (!channel) return;
    await channel.send({
      content:
        `🌱 <@${userId}> atteint **${percent} %** du Pokédex de la ${generationOrdinal(generation)} ` +
        `génération, hors légendaires, et reçoit **${species.name}${shiny ? " ✨ shiny" : ""}**, ` +
        "de la lignée de son starter !",
      allowedMentions: { users: [String(userId)] },
    });
  } catch (error) {
    handleException("Annonce d'un palier de starter :", error);
  }
}

// Au démarrage : les paliers que la vérification n'aurait pas encore donnés
// (Pokédex atteint avant l'arrivée du système, ou arrivée interrompue).
//
// Le stade 1 aussi : le choix se revendique avant le don, et une coupure entre les
// deux laisserait un choix « définitif » sans Pokémon. Un starter reçu ne quitte
// jamais la boîte (il en reste toujours un de chaque espèce) : qui n'en a aucun ne
// l'a donc jamais reçu.
export function repairStarters(client) {
  setStarterClient(client);
  db.all("SELECT user_id, species_id FROM pokemon_starters", [], async (err, rows) => {
    if (err) return handleException("Rattrapage des starters :", err);
    for (const { user_id: userId, species_id: speciesId } of rows ?? []) {
      const owns = await new Promise((resolve) =>
        db.get(
          "SELECT 1 AS found FROM pokemon_owned WHERE user_id = ? AND species_id = ? LIMIT 1",
          [userId, speciesId],
          (err, row) => resolve(err ? true : Boolean(row))
        )
      );
      if (!owns) {
        await new Promise((resolve) =>
          creditSpecies(userId, speciesId, false, { origin: "starter", checkStarters: false }, (err) => {
            if (err) handleException("Rattrapage du stade 1 d'un starter :", err);
            resolve();
          })
        );
      }
      await new Promise((resolve) => checkStarterRewards(userId, resolve));
    }
  });
}
