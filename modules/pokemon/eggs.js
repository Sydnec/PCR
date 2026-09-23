// Les œufs : la seule porte vers les bébés, qui n'apparaissent jamais.
//
// Un couple — un mâle et une femelle d'une famille qui a un bébé — pond un œuf.
// Métamorph peut tenir le rôle de l'un des deux parents, à condition d'avoir le
// sexe du rôle : un Métamorph mâle remplace le père, une femelle la mère. C'est
// ce qui rend possibles les familles d'un seul sexe, Kicklee et Tygnon (tous
// mâles) comme Lippoutou (toutes femelles).
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
export function babyOf(species) {
  if (!species) return null;
  return babyFamilies().find((family) => family.parents.has(species.id))?.baby ?? null;
}

export const canBreed = (species) => isDitto(species) || Boolean(babyOf(species));

// L'œuf qu'un couple pondrait, ou la raison pour laquelle il n'en pondra pas.
export function describeEgg(father, mother) {
  if (!father || !mother) return { error: "Parent inconnu." };
  if (isDitto(father) && isDitto(mother)) {
    return { error: "Deux Métamorph ne pondent rien : il faut un parent de la famille du bébé." };
  }
  const fatherBaby = isDitto(father) ? null : babyOf(father);
  const motherBaby = isDitto(mother) ? null : babyOf(mother);
  if (!isDitto(father) && !fatherBaby) {
    return { error: `**${father.name}** n'a pas de bébé : il ne peut pas pondre.` };
  }
  if (!isDitto(mother) && !motherBaby) {
    return { error: `**${mother.name}** n'a pas de bébé : elle ne peut pas pondre.` };
  }
  if (fatherBaby && motherBaby && fatherBaby.id !== motherBaby.id) {
    return {
      error:
        `**${father.name}** et **${mother.name}** ne sont pas de la même famille. ` +
        `Métamorph peut remplacer l'un des deux.`,
    };
  }
  return { baby: fatherBaby ?? motherBaby };
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
// individus fertiles du groupe.
function claimParent(userId, { speciesId, isShiny, sex }, cb) {
  db.get(
    `UPDATE pokemon_owned SET sterile = 1
      WHERE sterile = 0 AND id = (
        SELECT id FROM pokemon_owned
         WHERE user_id = ? AND species_id = ? AND is_shiny = ? AND sex = ? AND sterile = 0
         ORDER BY obtained_at DESC, id DESC LIMIT 1)
      RETURNING id`,
    [userId, speciesId, isShiny ? 1 : 0, sex],
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

// Pond un œuf. `father` et `mother` sont des groupes { speciesId, isShiny } ; le
// sexe est celui du rôle. Enchaînement ordonné avec compensation, comme une
// fusion : le père, puis la mère, puis l'œuf — et chaque étape rend ce que les
// précédentes ont pris si elle échoue.
export function layEgg(userId, father, mother, cb) {
  const config = getPokemonConfig().eggs;
  if (!config?.enabled) return cb(null, { ok: false, reason: "Les œufs sont désactivés." });

  const fatherSpecies = getAvailableSpecies(father.speciesId);
  const motherSpecies = getAvailableSpecies(mother.speciesId);
  const plan = describeEgg(fatherSpecies, motherSpecies);
  if (plan.error) return cb(null, { ok: false, reason: plan.error });

  getIncubatingEgg(userId, (err, current) => {
    if (err) return cb(err);
    if (current) {
      return cb(null, {
        ok: false,
        reason: "Tu couves déjà un œuf : il faut qu'il éclose avant d'en pondre un autre.",
      });
    }

    const noFertile = (species, sex) =>
      cb(null, {
        ok: false,
        reason:
          `Tu n'as pas de **${displayName(species, false, sex)}** fertile : chaque ` +
          `Pokémon ne pond qu'une fois dans sa vie.`,
      });

    claimParent(userId, { ...father, sex: "M" }, (err, fatherId) => {
      if (err) return cb(err);
      if (!fatherId) return noFertile(fatherSpecies, "M");

      claimParent(userId, { ...mother, sex: "F" }, (err, motherId) => {
        if (err || !motherId) {
          return releaseParents([fatherId], () =>
            err ? cb(err) : noFertile(motherSpecies, "F")
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
                `(${fatherSpecies.name} ♂ × ${motherSpecies.name} ♀)`
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

// L'état d'un œuf en couvaison, pour /oeuf voir et la confirmation de ponte.
export function buildEggEmbed(egg) {
  const baby = getSpecies(egg.species_id);
  const father = getSpecies(egg.father_species_id);
  const mother = getSpecies(egg.mother_species_id);
  const left = Math.max(0, egg.hatch_messages - egg.messages);
  return new EmbedBuilder()
    .setTitle("🥚 Ton œuf")
    .setColor(0xf5e6c8)
    .setDescription(
      `Un œuf de **${baby?.name ?? "?"}**, pondu par **${father?.name ?? "?"} ♂** et ` +
        `**${mother?.name ?? "?"} ♀**.\n\n` +
        `Il éclora <t:${Math.floor(egg.hatch_at / 1000)}:R>, ou dans **${left}** ` +
        `message${left > 1 ? "s" : ""} de ta part — au premier des deux.`
    );
}
