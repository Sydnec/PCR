// Les œufs : la seule porte vers les bébés, qui n'apparaissent jamais.
//
// Seules les familles qui ont un bébé pondent, et l'œuf donne toujours ce bébé :
// Pikachu et Raichu donnent Pichu, un Bulbizarre ne pond rien. Un couple, c'est
// un mâle et une femelle de la famille — ou un parent de la famille, de
// n'importe quel sexe, et un Métamorph, qui n'en a pas. Métamorph remplace l'un
// des deux parents, jamais les deux. C'est lui qui rend possibles les familles
// d'un seul sexe, Kicklee et Tygnon (tous mâles) comme Lippoutou (toutes
// femelles).
//
// Trois règles tiennent l'économie :
// - les parents ne sont pas consommés, mais chacun ne pond qu'une fois dans sa
//   vie : il devient stérile ;
// - un seul œuf en couvaison par dresseur, garanti en base ;
// - l'œuf éclot au premier des deux seuils — tant d'heures, ou tant de
//   messages de son propriétaire, comme des pas dans le jeu.
import { EmbedBuilder } from "discord.js";
import db from "../points-db.js";
import { handleException, log } from "../utils.js";
import { getPokemonConfig } from "./config.js";
import {
  allSpecies,
  embedColor,
  evolutionChain,
  getAvailableSpecies,
  getSpecies,
  spriteUrl,
} from "./data.js";
import { creditSpecies } from "./collection.js";
import { displayName } from "./embeds.js";
import { resolveChannel } from "./spawn.js";

// Métamorph, retrouvé par son identifiant de PokéAPI plutôt que par un numéro
// écrit ici : le dataset est la seule source.
export const isDitto = (species) => species?.slug === "ditto";

// Les familles qui ont un bébé jouable, et leurs parents possibles : toute la
// lignée sauf le bébé lui-même, qui ne pond pas. Recalculé à chaque appel,
// comme tout ce qui dépend des générations ouvertes : en génération 1, aucun
// bébé n'existe encore, donc aucune famille.
export function babyFamilies() {
  return allSpecies()
    .filter((species) => species.isBaby)
    .map((baby) => ({
      baby,
      parents: new Set(
        evolutionChain(baby)
          .filter((link) => !link.isBaby)
          .map((link) => link.id)
      ),
    }));
}

// Le bébé qu'un parent peut donner, ou null. Métamorph n'en donne aucun seul :
// c'est l'autre parent qui décide de la famille.
//
// `families` se passe quand on interroge toute une liste : les recalculer pour
// chacune des 251 espèces relirait la configuration des milliers de fois.
export function babyOf(species, families = babyFamilies()) {
  if (!species) return null;
  return families.find((family) => family.parents.has(species.id))?.baby ?? null;
}

export const canBreed = (species, families = babyFamilies()) =>
  isDitto(species) || Boolean(babyOf(species, families));

// L'œuf qu'un couple pondrait, ou la raison pour laquelle il n'en pondra pas.
// Chaque parent est { species, sex }. Rend aussi les rôles : `father` et
// `mother` désignent le mâle et la femelle, Métamorph prenant celui qui reste.
export function describeEgg(first, second) {
  if (!first?.species || !second?.species) return { error: "Parent inconnu." };
  const dittos = [first, second].filter((parent) => isDitto(parent.species));
  if (dittos.length === 2) {
    return { error: "Deux Métamorph ne pondent rien : il faut un parent de la famille du bébé." };
  }
  for (const parent of [first, second]) {
    if (!isDitto(parent.species) && !babyOf(parent.species)) {
      const babies = babyFamilies().map((family) => family.baby.name);
      return {
        error:
          `**${parent.species.name}** n'a pas de bébé, il ne pond pas.` +
          (babies.length
            ? ` Seules les familles de ${babies.join(", ")} pondent.`
            : " Aucun bébé n'existe encore : les œufs arrivent avec la génération 2."),
      };
    }
  }

  if (dittos.length === 1) {
    const partner = isDitto(first.species) ? second : first;
    const ditto = dittos[0];
    const partnerIsMother = partner.sex === "F";
    return {
      baby: babyOf(partner.species),
      father: partnerIsMother ? ditto : partner,
      mother: partnerIsMother ? partner : ditto,
    };
  }

  const father = [first, second].find((parent) => parent.sex === "M");
  const mother = [first, second].find((parent) => parent.sex === "F");
  if (!father || !mother) {
    return { error: "Il faut un mâle et une femelle — ou un Métamorph à la place de l'un des deux." };
  }
  const baby = babyOf(father.species);
  if (baby.id !== babyOf(mother.species).id) {
    return {
      error:
        `**${father.species.name}** et **${mother.species.name}** ne sont pas de la même ` +
        `famille. Métamorph peut remplacer l'un des deux.`,
    };
  }
  return { baby, father, mother };
}

export function getIncubatingEgg(userId, cb) {
  db.get(
    "SELECT * FROM pokemon_eggs WHERE user_id = ? AND status = 'INCUBATING'",
    [userId],
    (err, row) => cb(err, row ?? null)
  );
}

// Rend un parent stérile, et c'est ce geste qui le revendique : un UPDATE gardé
// sur `sterile = 0`, dont RETURNING dit s'il a eu lieu. Deux pontes simultanées
// ne peuvent donc pas se servir du même individu. On prend le plus récent des
// individus fertiles du groupe — ou l'individu désigné par `pokemonId`. `sex IS
// ?` et non `=` : un Métamorph n'a pas de sexe, et NULL = NULL n'est jamais
// vrai en SQL.
function claimParent(userId, { speciesId, isShiny, sex, pokemonId = null }, cb) {
  db.get(
    `UPDATE pokemon_owned SET sterile = 1
      WHERE sterile = 0 AND id = (
        SELECT id FROM pokemon_owned
         WHERE user_id = ? AND species_id = ? AND is_shiny = ? AND sex IS ? AND sterile = 0
           AND (? IS NULL OR id = ?)
         ORDER BY obtained_at DESC, id DESC LIMIT 1)
      RETURNING id`,
    [userId, speciesId, isShiny ? 1 : 0, sex ?? null, pokemonId ?? null, pokemonId ?? null],
    (err, row) => cb(err, row?.id ?? null)
  );
}

// Compensation : un parent revendiqué redevient fertile si la ponte échoue.
const releaseParents = (ids, cb = () => {}) =>
  db.run(
    `UPDATE pokemon_owned SET sterile = 0 WHERE id IN (${ids.map(() => "?").join(", ") || "NULL"})`,
    ids,
    (err) => {
      if (err) handleException("Restitution de la fertilité des parents :", err);
      cb();
    }
  );

// Pond un œuf. Les deux parents sont des groupes { speciesId, isShiny, sex },
// ou des individus précis (`pokemonId`, résolus par resolveSelector), dans
// n'importe quel ordre : describeEgg distribue les rôles. Enchaînement
// ordonné avec compensation, comme une fusion : le père, puis la mère, puis
// l'œuf — et chaque étape rend ce que les précédentes ont pris si elle échoue.
export function layEgg(userId, firstGroup, secondGroup, cb) {
  const config = getPokemonConfig().eggs;
  if (!config?.enabled) return cb(null, { ok: false, reason: "Les œufs sont désactivés." });

  const parent = (group) => ({
    group,
    species: getAvailableSpecies(group.speciesId),
    sex: group.sex ?? null,
  });
  const plan = describeEgg(parent(firstGroup), parent(secondGroup));
  if (plan.error) return cb(null, { ok: false, reason: plan.error });
  const father = plan.father.group;
  const mother = plan.mother.group;
  const fatherSpecies = plan.father.species;
  const motherSpecies = plan.mother.species;

  getIncubatingEgg(userId, (err, current) => {
    if (err) return cb(err);
    if (current) {
      return cb(null, {
        ok: false,
        reason: "Tu couves déjà un œuf : il faut qu'il éclose avant d'en pondre un autre.",
      });
    }

    const noFertile = (species, group) =>
      cb(null, {
        ok: false,
        reason: group.pokemonId
          ? `Le Pokémon #${group.pokemonId} ne peut plus pondre : chaque Pokémon ne pond ` +
            `qu'une fois dans sa vie.`
          : `Tu n'as pas de **${displayName(species, false, group.sex)}** fertile : chaque ` +
            `Pokémon ne pond qu'une fois dans sa vie.`,
      });

    claimParent(userId, father, (err, fatherId) => {
      if (err) return cb(err);
      if (!fatherId) return noFertile(fatherSpecies, father);

      claimParent(userId, mother, (err, motherId) => {
        if (err || !motherId) {
          return releaseParents([fatherId], () =>
            err ? cb(err) : noFertile(motherSpecies, mother)
          );
        }

        const now = Date.now();
        const hatchAt = now + Math.max(0, Number(config.hatchHours) || 0) * 3600 * 1000;
        const hatchMessages = Math.max(1, Math.round(Number(config.hatchMessages) || 1));
        db.run(
          `INSERT INTO pokemon_eggs
             (user_id, species_id, father_id, mother_id, father_species_id, mother_species_id,
              status, messages, hatch_messages, laid_at, hatch_at)
           VALUES (?, ?, ?, ?, ?, ?, 'INCUBATING', 0, ?, ?, ?)`,
          [
            userId,
            plan.baby.id,
            fatherId,
            motherId,
            fatherSpecies.id,
            motherSpecies.id,
            hatchMessages,
            now,
            hatchAt,
          ],
          function (err) {
            if (err) {
              // L'index unique a parlé : un œuf pondu entre la lecture et
              // l'écriture. Les parents redeviennent fertiles.
              return releaseParents([fatherId, motherId], () => {
                if (/UNIQUE/i.test(err.message)) {
                  return cb(null, {
                    ok: false,
                    reason: "Tu couves déjà un œuf : il faut qu'il éclose avant d'en pondre un autre.",
                  });
                }
                cb(err);
              });
            }
            log(
              `Œuf : ${userId} obtient un œuf de ${plan.baby.name} ` +
                `(${fatherSpecies.name} × ${motherSpecies.name})`
            );
            getIncubatingEgg(userId, (err, egg) =>
              cb(err, { ok: true, egg: egg ?? { id: this.lastID, species_id: plan.baby.id } })
            );
          }
        );
      });
    });
  });
}

// ====================== ÉCLOSION ======================

// Fait éclore un œuf. La revendication est l'UPDATE gardé sur le statut : le
// message qui franchit le seuil et le balayage horaire peuvent arriver ensemble,
// un seul des deux fait naître le bébé. Si le crédit échoue, l'œuf se remet à
// couver plutôt que de disparaître — il éclora au passage suivant.
export function hatchEgg(eggId, cb) {
  db.run(
    "UPDATE pokemon_eggs SET status = 'HATCHED', hatched_at = ? WHERE id = ? AND status = 'INCUBATING'",
    [Date.now(), eggId],
    function (err) {
      if (err) return cb(err);
      if (this.changes !== 1) return cb(null, null);

      db.get("SELECT * FROM pokemon_eggs WHERE id = ?", [eggId], (err, egg) => {
        if (err || !egg) return cb(err ?? new Error(`Œuf #${eggId} introuvable`));
        const species = getSpecies(egg.species_id);
        // Un bébé a ses chances d'être shiny comme une apparition sauvage.
        const odds = Math.max(1, Number(getPokemonConfig().spawn.shinyOdds) || 1);
        const isShiny = Math.floor(Math.random() * odds) === 0;
        creditSpecies(egg.user_id, species.id, isShiny, { origin: "oeuf" }, (err, born) => {
          if (err) {
            return db.run(
              "UPDATE pokemon_eggs SET status = 'INCUBATING', hatched_at = NULL WHERE id = ?",
              [eggId],
              () => cb(err)
            );
          }
          db.run("UPDATE pokemon_eggs SET pokemon_id = ? WHERE id = ?", [born.id, eggId], (err) => {
            if (err) handleException("Lien de l'œuf vers son bébé :", err);
          });
          log(`Éclosion : ${egg.user_id} obtient ${species.name}${isShiny ? " ✨" : ""} (œuf #${eggId})`);
          cb(null, { egg, species, isShiny, sex: born.sex });
        });
      });
    }
  );
}

export function buildHatchEmbed({ egg, species, isShiny, sex }) {
  return new EmbedBuilder()
    .setTitle("🐣 Un œuf a éclos !")
    .setColor(embedColor(species, isShiny))
    .setThumbnail(spriteUrl(species, isShiny))
    .setDescription(
      `<@${egg.user_id}> accueille **${displayName(species, isShiny, sex)}** !` +
        (isShiny ? "\nEt il brille… ✨" : "")
    );
}

// L'annonce se fait dans le salon des apparitions, là où l'on suit le jeu.
// Au mieux : un bébé né sans annonce reste un bébé né.
async function announceHatch(client, result) {
  try {
    const channel = await resolveChannel(client);
    if (!channel) return;
    await channel.send({
      content: `<@${result.egg.user_id}>`,
      embeds: [buildHatchEmbed(result)],
    });
  } catch (error) {
    handleException("Annonce d'une éclosion :", error);
  }
}

const hatchAndAnnounce = (client, eggId) =>
  hatchEgg(eggId, (err, result) => {
    if (err) return handleException(`Éclosion de l'œuf #${eggId} :`, err);
    if (result) announceHatch(client, result);
  });

// Un message de plus pour l'œuf de son auteur, et l'éclosion si c'est le
// dernier qui manquait. Sur le chemin de chaque message du serveur : une seule
// instruction, qui ne touche rien quand l'auteur ne couve pas.
export function countEggMessage(client, userId) {
  db.get(
    `UPDATE pokemon_eggs SET messages = messages + 1
      WHERE user_id = ? AND status = 'INCUBATING'
      RETURNING id, messages, hatch_messages, hatch_at`,
    [userId],
    (err, egg) => {
      if (err) return handleException("Compteur de messages d'un œuf :", err);
      if (!egg) return;
      if (egg.messages >= egg.hatch_messages || Date.now() >= egg.hatch_at) {
        hatchAndAnnounce(client, egg.id);
      }
    }
  );
}

// Le balayage : les œufs dont l'échéance est passée éclosent même si leur
// propriétaire se tait. Indépendant de l'activité, comme la fuite des Pokémon.
export function hatchDueEggs(client) {
  db.all(
    "SELECT id FROM pokemon_eggs WHERE status = 'INCUBATING' AND hatch_at <= ?",
    [Date.now()],
    (err, rows) => {
      if (err) return handleException("Balayage des œufs :", err);
      for (const { id } of rows || []) hatchAndAnnounce(client, id);
    }
  );
}

// L'état d'un œuf en couvaison, pour /pk oeuf voir et la confirmation de ponte.
// Les colonnes father_* et mother_* tiennent les rôles de mâle et de femelle ;
// un Métamorph y occupe celui qui restait, sans symbole puisqu'il n'a pas de
// sexe.
export function buildEggEmbed(egg) {
  const baby = getSpecies(egg.species_id);
  const parentName = (id, sex) => {
    const species = getSpecies(id);
    if (!species) return "?";
    return displayName(species, false, isDitto(species) ? null : sex);
  };
  const left = Math.max(0, egg.hatch_messages - egg.messages);
  return new EmbedBuilder()
    .setTitle("🥚 Ton œuf")
    .setColor(0xf5e6c8)
    .setDescription(
      `Un œuf de **${baby?.name ?? "?"}**, pondu par ` +
        `**${parentName(egg.father_species_id, "M")}** et ` +
        `**${parentName(egg.mother_species_id, "F")}**.\n\n` +
        `Il éclora <t:${Math.floor(egg.hatch_at / 1000)}:R>, ou dans **${left}** ` +
        `message${left > 1 ? "s" : ""} de ta part — au premier des deux.`
    );
}
