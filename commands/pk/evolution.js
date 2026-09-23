import {
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { handleException } from "../../modules/utils.js";
import {
  DITTO_HELPER,
  countBySpecies,
  describeEvolution,
  evolutionShortage,
  getIndividuals,
  resolveIndividual,
  sacrificeFill,
} from "../../modules/pokemon/collection.js";
import { dittoSpecies, embedColor, getSpecies, spriteUrl } from "../../modules/pokemon/data.js";
import { getInventory, getItem, getItems } from "../../modules/pokemon/items.js";
import {
  HINT_VALUE,
  displayName,
  individualChoices,
  respondHint as hint,
} from "../../modules/pokemon/embeds.js";

const pts = (value) => value.toLocaleString("fr-FR");
const NO_ENTRY = { total: 0, normal: 0, shiny: 0 };

// Les objets d'évolution que ce dresseur a en assez grand nombre pour s'en
// servir. Trois bonbons ou rien : deux ne remplacent pas deux tiers d'un
// sacrifice.
function usableHelpers(userId, cb) {
  getInventory(userId, (err, rows) => {
    if (err) return cb(err, []);
    const helpers = [];
    for (const row of rows || []) {
      const item = getItem(row.item_key);
      if (item?.evolution && row.count >= (item.evolution.quantity ?? 1)) {
        helpers.push({ ...item, held: row.count });
      }
    }
    cb(null, helpers);
  });
}

// Ce qu'une espèce permet de payer. `stock.total` compte ses individus, shiny
// compris et celui qui évolue compris : une entrée de Pokédex est une espèce,
// et `required` compte déjà celui qui reste.
const canPay = (plan, stock) => !plan.error && stock.total >= plan.required;

// Métamorph en renfort, ou null : seulement quand les exemplaires ne suffisent
// pas, que l'espèce a de quoi évoluer tout en gardant son entrée, et qu'il reste
// un Métamorph après l'évolution. `sacrificeFill` dit combien il en faut — la
// même fonction qu'evolve, qui tranche à la fin.
function dittoPath(plan, stock) {
  if (plan.error || canPay(plan, stock) || stock.total < 2) return null;
  const fill = sacrificeFill(plan, stock.total);
  if (!fill.dittos || stock.dittos < fill.dittos + 1) return null;
  return fill;
}

// Toutes les façons de faire évoluer cette espèce, aides comprises. Chacune
// porte son propre plan : une pierre ne coûte pas ce que coûte un bonbon, et le
// nombre de sacrifices change avec elle.
function evolutionPaths(speciesId, stock, helpers) {
  const paths = [];
  const base = describeEvolution(speciesId);
  if (canPay(base, stock)) paths.push({ plan: base, helper: null });

  for (const helper of helpers) {
    const plan = describeEvolution(speciesId, null, helper.key);
    // Une aide qui ne change rien à ce qui manque n'a pas à encombrer l'écran :
    // on ne la propose que si elle rend l'évolution possible, ou moins chère.
    if (!canPay(plan, stock)) continue;
    if (!paths.length || plan.points < base.points || plan.required < base.required) {
      paths.push({ plan, helper });
    }
  }
  const fill = dittoPath(base, stock);
  if (fill) paths.push({ plan: base, helper: null, ditto: fill });
  return paths;
}

// Le stock d'une espèce, lu dans les comptes de countBySpecies : ses
// individus, shiny compris, et les Métamorph — toutes variantes — qui peuvent
// combler les sacrifices qui manquent.
function stockOf(counts, speciesId) {
  const entry = counts.get(speciesId) ?? NO_ENTRY;
  const metamorph = dittoSpecies();
  const dittos = (metamorph && counts.get(metamorph.id)) || NO_ENTRY;
  return { ...entry, dittos: dittos.total, dittoNormals: dittos.normal };
}

// Combien de shiny partiraient parmi `count` sacrifices, quand `normals`
// normaux peuvent partir avant eux : un shiny sacrifié ne se rattrape pas,
// l'écran le dit avant le clic.
const shinyNote = (count, normals) => {
  const shinies = Math.max(0, count - Math.max(0, normals));
  return shinies > 0 ? `, dont **${shinies}** ✨ faute de normaux` : "";
};

// Espèces que ce dresseur possède : celles qu'il peut faire évoluer — par ses
// propres moyens ou avec un objet — et celles qui pourraient évoluer mais dont
// il manque des exemplaires. Le second lot sert à expliquer une liste vide au
// lieu de la laisser muette : c'est exactement ce qui faisait croire à une
// commande cassée.
function listEvolvable(userId, cb) {
  usableHelpers(userId, (err, helpers) => {
    if (err) return cb(err, [], []);
    getIndividuals(userId, (err, rows) => {
      if (err) return cb(err, [], []);
      const counts = countBySpecies(rows);
      const evolvable = [];
      const incomplete = [];
      for (const speciesId of counts.keys()) {
        const stock = stockOf(counts, speciesId);
        const paths = evolutionPaths(speciesId, stock, helpers);
        if (paths.length) {
          evolvable.push({ speciesId, count: stock.total, shiny: stock.shiny });
          continue;
        }
        const plan = describeEvolution(speciesId);
        if (!plan.error) incomplete.push({ speciesId, count: stock.total, plan });
      }
      // Les plus proches du seuil d'abord : ce sont les plus utiles à afficher.
      incomplete.sort((a, b) => b.count - a.count);
      cb(null, evolvable, incomplete);
    });
  });
}

// Les objets qui remplacent des sacrifices sur toutes les espèces, tels que le
// catalogue les décrit : le refus dit ce qui comblerait le manque.
function helpersHint() {
  return getItems()
    .filter((item) => item.evolution && !item.evolution.from)
    .map((item) => {
      const { quantity = 1, copies = 1 } = item.evolution;
      return (
        `${quantity}× ${item.emoji} ${item.label} ${quantity > 1 ? "tiennent" : "tient"} lieu ` +
        `${copies > 1 ? `de ${copies} sacrifices` : "d'un sacrifice"}.`
      );
    })
    .join("\n");
}

export default {
  describe: (sub) =>
    sub
      .setName("evolution")
      .setDescription("Fait évoluer un de tes Pokémon en sacrifiant d'autres exemplaires")
      .addStringOption((option) =>
        option
          .setName("espece")
          .setDescription("L'espèce à faire évoluer")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName("individu")
          .setDescription("Le Pokémon précis qui évolue : il garde son sexe, sa ball, sa fertilité")
          .setRequired(true)
          .setAutocomplete(true)
      ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const query = String(focused.value ?? "").toLowerCase();

    // Deuxième temps : l'individu, parmi ceux de l'espèce choisie. Les autres
    // options sont lisibles pendant l'autocomplétion.
    if (focused.name === "individu") {
      const species = getSpecies(Number(interaction.options.get("espece")?.value));
      if (!species) return hint(interaction, "⚠️ Choisis d'abord l'espèce dans l'option « espece »");
      return getIndividuals(interaction.user.id, (err, rows) => {
        if (err) {
          handleException("Autocomplétion d'évolution :", err);
          return interaction.respond([]).catch(() => {});
        }
        const choices = individualChoices(
          rows.filter((row) => row.species_id === species.id),
          query,
          (row) => !row.last
        );
        if (!choices.length) {
          return hint(interaction, `Aucun ${species.name} ne peut évoluer : il en reste toujours un`);
        }
        interaction.respond(choices).catch(() => {});
      });
    }

    listEvolvable(interaction.user.id, (err, entries, incomplete) => {
      if (err) {
        handleException("Autocomplétion d'évolution :", err);
        return interaction.respond([]).catch(() => {});
      }
      const choices = entries
        .map((entry) => ({
          name:
            `${getSpecies(entry.speciesId).name} (×${entry.count}` +
            `${entry.shiny ? `, dont ${entry.shiny} ✨` : ""})`,
          value: String(entry.speciesId),
        }))
        .filter((choice) => choice.name.toLowerCase().includes(query))
        .slice(0, 25);
      if (choices.length) return interaction.respond(choices).catch(() => {});

      // Rien à proposer : on dit ce qui manque, espèce par espèce.
      const hints = incomplete
        .map((entry) => ({
          name:
            `⚠️ ${entry.plan.species.name} : ${entry.plan.required} exemplaires requis, ` +
            `tu en as ${entry.count}`,
          value: HINT_VALUE,
        }))
        .filter((choice) => choice.name.toLowerCase().includes(query))
        .slice(0, 25);
      if (hints.length) return interaction.respond(hints).catch(() => {});
      hint(interaction, "Aucun Pokémon de ta collection ne peut évoluer");
    });
  },

  async execute(interaction) {
    try {
      // Les deux valeurs se revalident : tapées à la main ou périmées, elles
      // peuvent désigner un Pokémon parti, ou d'une autre espèce.
      const selector = await new Promise((resolve, reject) =>
        resolveIndividual(
          interaction.user.id,
          interaction.options.getString("espece"),
          interaction.options.getString("individu"),
          (err, s) => (err ? reject(err) : resolve(s))
        )
      );
      if (selector.error) {
        return interaction.reply({ content: `❌ ${selector.error}`, flags: MessageFlags.Ephemeral });
      }
      const { speciesId, isShiny, sex, pokemonId } = selector;
      const plan = describeEvolution(speciesId);
      if (plan.error) {
        return interaction.reply({
          content: `❌ ${plan.error}`,
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      usableHelpers(interaction.user.id, (err, helpers) => {
        if (err) {
          handleException("Lecture des objets d'évolution :", err);
          helpers = [];
        }
        // Ce que le dresseur possède vraiment décide des boutons affichés : une
        // évolution qu'il ne peut pas payer n'a pas à lui être proposée.
        getIndividuals(interaction.user.id, (err, individuals) => {
          if (err) handleException("Lecture de la collection pour /pk evolution :", err);
          const stock = stockOf(countBySpecies(err ? [] : individuals), speciesId);
          // Les normaux qui peuvent être sacrifiés avant un shiny : tous, sauf
          // celui qui évolue s'il en est un.
          const normals = stock.normal - (isShiny ? 0 : 1);

          const species = plan.species;
          // Le deuxième segment du customId désigne l'individu qui évolue.
          const suffix = `#${pokemonId}`;
          const embed = new EmbedBuilder()
            .setTitle(`Évolution de #${pokemonId} ${displayName(species, isShiny, sex)}`)
            .setColor(embedColor(species, isShiny))
            .setThumbnail(spriteUrl(species, isShiny))
            .setDescription(
              (plan.branching
                ? `**${species.name}** peut évoluer en ${plan.targets
                    .map((target) => `**${target.name}**`)
                    .join(", ")}.\n\n` +
                  `Tu peux laisser le hasard décider, ou payer plus cher pour choisir.`
                : `**${species.name}** peut évoluer en **${plan.targets[0].name}**.`) +
                `\nIl garde son sexe, sa ball et sa fertilité${isShiny ? ", et reste shiny" : ""}.`
            );

          // Le coût de l'évolution ordinaire n'a sa place que si elle est
          // proposée : au-dessus d'un unique bouton « Pierre Feu → Pyroli
          // (gratuit) », annoncer « 1 sacrifice et 2000 points » se contredit.
          if (canPay(plan, stock)) {
            const sacrifices = plan.sacrifices;
            embed.addFields({
              name: "Coût",
              value:
                (sacrifices > 0
                  ? `**${sacrifices}** ${species.name} sacrifié${sacrifices > 1 ? "s" : ""}` +
                    `${shinyNote(sacrifices, normals) || ", les normaux d'abord"},`
                  : "Aucun sacrifice") +
                ` et **${pts(plan.points)}** points. Il t'en faut **${plan.required}** en ` +
                `tout, shiny ou non : celui qui évolue, ses sacrifices et un qui reste.`,
              inline: false,
            });
          }

          const rows = [];
          const normale = new ActionRowBuilder();
          if (!canPay(plan, stock)) {
            // Rien du tout : ni les exemplaires, ni de quoi les remplacer.
          } else if (plan.branching) {
            normale.addComponents(
              new ButtonBuilder()
                .setCustomId(`poke_evo|${speciesId}|${suffix}|random`)
                .setLabel(`Évolution aléatoire (${pts(plan.points)} pts)`)
                .setEmoji("\u{1F3B2}")
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId(`poke_evo|${speciesId}|${suffix}|choose`)
                .setLabel(
                  `Choisir l'évolution (${pts(describeEvolution(speciesId, plan.targets[0].id).points)} pts)`
                )
                .setEmoji("\u{1F3AF}")
                .setStyle(ButtonStyle.Secondary)
            );
          } else {
            normale.addComponents(
              new ButtonBuilder()
                .setCustomId(`poke_evo|${speciesId}|${suffix}|random`)
                .setLabel(`Faire évoluer (${pts(plan.points)} pts)`)
                .setEmoji("✨")
                .setStyle(ButtonStyle.Success)
            );
          }
          if (normale.components.length) rows.push(normale);

          // Un bouton par objet utilisable, dans une rangée à part : ce sont des
          // chemins moins chers, pas des variantes du premier. Discord en
          // accepte cinq par rangée, et le catalogue n'en propose pas davantage.
          const aides = new ActionRowBuilder();
          const lignes = [];
          for (const helper of helpers.slice(0, 5)) {
            const aide = describeEvolution(speciesId, null, helper.key);
            if (!canPay(aide, stock)) continue;
            const cible = aide.target ? ` → ${aide.target.name}` : "";
            const prix = aide.points > 0 ? `${pts(aide.points)} pts` : "gratuit";
            aides.addComponents(
              new ButtonBuilder()
                .setCustomId(`poke_evo|${speciesId}|${suffix}|random|${helper.key}`)
                .setLabel(`${helper.label}${cible} (${prix})`)
                .setEmoji(helper.emoji)
                .setStyle(ButtonStyle.Secondary)
            );
            lignes.push(
              `${helper.emoji} **${helper.evolution.quantity}× ${helper.label}**` +
                `${cible} — ${aide.required} exemplaire${aide.required > 1 ? "s" : ""} requis` +
                `${shinyNote(aide.sacrifices, normals)}, ${prix}`
            );
          }
          if (aides.components.length) {
            rows.push(aides);
            embed.addFields({
              name: "Tes objets",
              value: lignes.join("\n"),
              inline: false,
            });
          }

          // Métamorph, dans sa propre rangée : il ne remplace que des
          // sacrifices, donc le choix de la forme reste possible avec lui,
          // contrairement à une pierre qui impose la sienne.
          const fill = dittoPath(plan, stock);
          if (fill) {
            const metamorph = dittoSpecies();
            const joker = new ActionRowBuilder();
            const bouton = (mode, label) =>
              new ButtonBuilder()
                .setCustomId(`poke_evo|${speciesId}|${suffix}|${mode}|${DITTO_HELPER}`)
                .setLabel(label)
                .setStyle(ButtonStyle.Secondary);
            if (plan.branching) {
              joker.addComponents(
                bouton("random", `${fill.dittos}× ${metamorph.name} · hasard (${pts(plan.points)} pts)`),
                bouton(
                  "choose",
                  `${fill.dittos}× ${metamorph.name} · choisir ` +
                    `(${pts(describeEvolution(speciesId, plan.targets[0].id).points)} pts)`
                )
              );
            } else {
              joker.addComponents(
                bouton("random", `${fill.dittos}× ${metamorph.name} (${pts(plan.points)} pts)`)
              );
            }
            rows.push(joker);
            embed.addFields({
              name: metamorph.name,
              value:
                `**${fill.dittos}** ${metamorph.name}${shinyNote(fill.dittos, stock.dittoNormals)} ` +
                `${fill.dittos > 1 ? "tiennent" : "tient"} lieu de **${fill.missing}** ` +
                `sacrifice${fill.missing > 1 ? "s" : ""} manquant${fill.missing > 1 ? "s" : ""}, ` +
                `les normaux d'abord` +
                `${fill.real ? ` ; **${fill.real}** ${species.name}${shinyNote(fill.real, normals)} partent aussi` : ""}. ` +
                `Tu en as **${stock.dittos}**, un reste toujours.`,
              inline: false,
            });
          }

          // Aucun chemin : on le dit avec le chiffre qui manque, plutôt que
          // d'afficher un embed orné de boutons qui refuseraient tous.
          //
          // Métamorph n'est cité que s'il pourrait servir : il faut deux
          // exemplaires de l'espèce, celui qui évolue et celui qui reste. Ses
          // chiffres sont ceux de sacrificeFill, comme pour le bouton.
          if (!rows.length) {
            const metamorph = dittoSpecies();
            const joker = metamorph && stock.total >= 2 ? sacrificeFill(plan, stock.total) : null;
            return interaction
              .editReply({
                content: [
                  `❌ ${evolutionShortage(plan, err ? null : stock.total)}`,
                  helpersHint(),
                  joker?.dittos
                    ? `Ou **${joker.dittos + 1}** ${metamorph.name} ` +
                      `(${joker.dittos} sacrifié${joker.dittos > 1 ? "s" : ""} + 1 qui reste), ` +
                      `tu en as **${stock.dittos}**.`
                    : null,
                ]
                  .filter(Boolean)
                  .join("\n"),
              })
              .catch(() => {});
          }

          interaction.editReply({ embeds: [embed], components: rows }).catch(() => {});
        });
      });
    } catch (error) {
      handleException(error);
    }
  },
};
