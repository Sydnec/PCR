// Description des tirages pondérés du jeu.
//
// Trois tables tirent au sort avec des poids : l'espèce qui apparaît, l'espèce
// qu'on croise au parc safari, et l'objet que tient un Pokémon. Un poids n'est
// pas un pourcentage — c'est une part d'un total qui bouge dès qu'on ajoute une
// ligne — et personne ne peut régler à l'aveugle ce qu'il ne sait pas convertir.
//
// Règle absolue de ce module : il ne recalcule JAMAIS un poids à sa façon. Il
// appelle les mêmes fonctions que les tirages — spawnWeight, itemDropWeight —
// sur les mêmes données. Une table qui diverge de la réalité qu'elle décrit
// serait pire que pas de table du tout : elle ferait régler le jeu à côté.
import { getPokemonConfig, getSafariConfig } from "./config.js";
import { allSpecies, isLegendary, itemOnlySpecies, spawnWeight } from "./data.js";
import { getItems, itemDropWeight, itemLot, itemLotteryWeight } from "./items.js";

// Une ligne de table : un groupe de tirages qui partagent le même poids.
// `count` vaut 1 pour un objet, et le nombre d'espèces pour un groupe de
// Pokémon — c'est ce facteur qui fait qu'un stade 3 à poids 10 pèse moins qu'un
// légendaire à poids 8 s'il y en a moins.
const row = (label, count, weight) => ({ label, count, weight, total: count * weight });

function table({ key, name, note, subject, gate = null, lots = false, rows }) {
  const kept = rows.filter((r) => r.count > 0);
  const total = kept.reduce((sum, r) => sum + r.total, 0);
  return {
    key,
    name,
    note,
    // Ce que compte une ligne : des catégories d'espèces ici, des objets là.
    subject,
    // La porte d'entrée, quand il y en a une : le butin ne se tire que si le
    // Pokémon tient quelque chose, alors qu'une apparition tire toujours une
    // espèce.
    gate,
    // Vrai quand les lignes portent une fourchette de quantité : le tableau
    // gagne alors une colonne, parce qu'une part de tirage ne dit rien du volume
    // gagné si un lot va de un à cinq.
    lots,
    total,
    rows: kept.map((r) => ({
      ...r,
      // Part du tirage, et part d'UN membre du groupe : « les stades 1 font
      // 79 % » et « ce Roucool-là fait 1 % » ne répondent pas à la même
      // question, et les deux se posent en réglant.
      share: total > 0 ? r.total / total : 0,
      unitShare: total > 0 ? r.weight / total : 0,
    })),
  };
}

// Les espèces, groupées comme spawnWeight les traite : les exclues d'abord —
// évolutions par échange ou par objet, et bébés, chacune dans sa ligne puisqu'on ne les
// obtient pas de la même façon —, puis les légendaires, le reste par stade. Un
// bébé rangé avec son stade prendrait le poids du groupe et gonflerait le
// total d'espèces qui ne sortent jamais.
function speciesRows(poolConfig) {
  const groups = new Map();
  const itemOnly = itemOnlySpecies();
  for (const species of allSpecies()) {
    const weight = spawnWeight(species, poolConfig, itemOnly);
    const key =
      species.tradeEvolution || itemOnly.has(species.id)
        ? "Hors pool (échange, objet)"
        : species.isBaby
          ? "Hors pool (œuf)"
          : isLegendary(species)
            ? "Légendaires"
            : `Stade ${species.stage}`;
    const group = groups.get(key) ?? { label: key, count: 0, weight };
    group.count += 1;
    // Un groupe dont les membres n'auraient pas le même poids serait un bug de
    // regroupement, pas une moyenne à faire : on garde le premier et le reste
    // se verrait au total.
    groups.set(key, group);
  }

  const ordre = [
    "Stade 1",
    "Stade 2",
    "Stade 3",
    "Légendaires",
    "Hors pool (échange, objet)",
    "Hors pool (œuf)",
  ];
  return (
    [...groups.values()]
      .sort((a, b) => ordre.indexOf(a.label) - ordre.indexOf(b.label))
      // Les groupes se comptent au fil des espèces, mais c'est `row` qui fabrique
      // une ligne : une seule définition de ce qu'est un total.
      .map((group) => row(group.label, group.count, group.weight))
  );
}

export function describeSpawnPool() {
  const config = getPokemonConfig().spawn;
  return table({
    key: "spawn",
    name: "Apparitions sauvages",
    subject: "catégorie",
    note: "L'espèce tirée à chaque apparition.",
    rows: speciesRows(config),
  });
}

export function describeSafariPool() {
  const config = getSafariConfig();
  return table({
    key: "safari",
    name: "Rencontres du parc safari",
    subject: "catégorie",
    note: "L'espèce tirée à chaque rencontre, une par action jouée.",
    rows: speciesRows(config),
  });
}

export function describeDropPool() {
  const chance = Number(getPokemonConfig().spawn?.heldItemChance) || 0;
  return table({
    key: "butin",
    name: "Butin des Pokémon",
    subject: "objet",
    note: "L'objet que tient un Pokémon, quand il en tient un.",
    gate: { label: "en tiennent un", chance },
    rows: getItems().map((item) => row(item.label, 1, itemDropWeight(item))),
  });
}

// La loterie a ses propres poids depuis qu'elle donne quelque chose sept fois
// sur dix : ouvrir sa porte aurait rendu les lots rares d'autant plus fréquents,
// alors qu'un Pokémon sur quinze tient toujours un objet. Elle est diluée avec du
// poids de balls, et le butin n'a pas bougé. Les deux tableaux se lisent côte à
// côte : c'est là, et nulle part ailleurs, qu'on voit qu'ils ont divergé.
export function describeLotteryPool() {
  const lottery = getPokemonConfig().lottery ?? {};
  const chance = Number(lottery.winChance) || 0;
  const raw = Number(lottery.lotDecay);
  // Annoncé en « N fois moins probable » : 0,5 se lit mal, « deux fois moins » se
  // lit tout seul.
  const decay = (Number.isFinite(raw) && raw > 0 ? 1 / raw : 1)
    .toFixed(1)
    .replace(".0", "")
    .replace(".", ",");
  return table({
    key: "loterie",
    name: "Loterie quotidienne",
    subject: "objet",
    note: `Le lot d'un tirage, un par dresseur et par jour. Chaque exemplaire de plus est ${decay} fois moins probable.`,
    gate: { label: "des tirages donnent un lot", chance },
    lots: true,
    rows: getItems().map((item) => {
      const { min, max } = itemLot(item);
      return {
        ...row(item.label, 1, itemLotteryWeight(item)),
        lot: min === max ? `${min}` : `${min}-${max}`,
      };
    }),
  });
}

export function describeWeightTables() {
  return [describeSpawnPool(), describeSafariPool(), describeDropPool(), describeLotteryPool()];
}
