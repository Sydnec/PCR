// Infos : les règles du jeu en bref. Chaque chiffre vient de l'API (/api/rules),
// qui le lit dans les réglages en cours ou le calcule avec la fonction même qui
// tire au sort : la page ne recalcule rien, elle ne fait que mettre en forme.
import { api, colorChip, dateTimeFr, fmt, h, itemIcon, percent, richText } from "../lib.js";

// Une ligne de règle : le gras (**…**) et les emoji comme dans les messages du
// jeu.
const rule = (text) => h("li", {}, richText(text));

// Une part réglée (7 %, 20 %, 66,7 %) : une décimale au plus. Sous 1 %, les
// chances comme sur les annonces (0,36 %).
const pct = (probability) =>
  probability < 0.01 ? percent(probability) : `${fmt(Math.round(probability * 1000) / 10)} %`;

// « 1 sur 33 » plutôt que « 3,03 % » : plus parlant pour ce qui est rare.
const oneIn = (probability) => `1 sur ${fmt(Math.round(1 / probability))}`;

const ordinal = (generation) => (generation === 1 ? "1re" : `${generation}e`);

// Une durée réglée en secondes : en minutes seulement quand elle tombe juste, pour
// ne jamais arrondir 90 s en « 2 min ».
const seconds = (value) =>
  value >= 60 && value % 60 === 0 ? duration(value / 60) : `${fmt(value)} s`;

const duration = (minutes) => {
  if (minutes < 60) return `${fmt(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${fmt(hours)} h ${fmt(rest)}` : `${fmt(hours)} h`;
};

// Un écart de chances, « 25–33 % », ou une seule valeur quand il n'y en a pas.
const range = (min, max) =>
  percent(min) === percent(max)
    ? percent(min)
    : `${percent(min).replace(" %", "")}–${percent(max)}`;

const list = (...items) => h("ul", { class: "rules-list" }, items.filter(Boolean));

// Les chiffres qu'on vient chercher, en tête de carte : on les lit d'un coup d'œil,
// le détail suit en dessous.
// Sans chiffre à montrer, rien : pas de bandeau vide.
const facts = (...entries) => {
  const shown = entries.filter(Boolean);
  if (!shown.length) return null;
  return h(
    "div",
    { class: "rules-facts" },
    shown.map(([value, label]) =>
      h("div", { class: "rules-fact" }, h("strong", {}, value), h("span", {}, label))
    )
  );
};

// Un tableau large défile dans sa carte plutôt que d'élargir la page.
const scroll = (element) => h("div", { class: "rules-scroll" }, element);

const table = (headers, rows) =>
  scroll(
    h(
      "table",
      { class: "rules-table" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          headers.map((header) => h("th", {}, header))
        )
      ),
      h(
        "tbody",
        {},
        rows.map((cells) =>
          h(
            "tr",
            {},
            cells.map((cell) => h("td", {}, cell))
          )
        )
      )
    )
  );

// Une carte : une règle du jeu. `wide` pour celles qui portent un grand tableau.
const card = (title, { wide = false } = {}, ...content) =>
  h("article", { class: `rules-card${wide ? " rules-wide" : ""}` }, h("h3", {}, title), content);

// Un thème regroupe des cartes ; c'est lui que le sommaire désigne.
const theme = (id, title, intro, ...cards) => {
  const filled = cards.flat().filter(Boolean);
  if (!filled.length) return null;
  return h(
    "section",
    { class: "rules-theme", id },
    h("h2", {}, title),
    intro ? h("p", { class: "muted" }, intro) : null,
    h("div", { class: "rules-grid" }, filled)
  );
};

function rarityTable(rarities) {
  return table(
    ["Rareté", "Chance", "Espèces"],
    rarities.map((rarity) => [
      colorChip(rarity.label, { className: `rarity-${rarity.key}` }),
      pct(rarity.share),
      fmt(rarity.species),
    ])
  );
}

// ---------------------------------------------------------------- Points

function points(rules) {
  const { ranks, then } = rules.points;
  return card(
    "Points",
    {},
    facts(
      ranks.length ? [`${fmt(ranks[0])} pts`, "ton 1er message récompensé du jour"] : null,
      then
        ? [`${fmt(then)} pts`, ranks.length ? "chacun des suivants" : "par message récompensé"]
        : null
    ),
    list(
      ranks.length > 1
        ? rule(
            `Chaque jour, tes messages récompensés rapportent ` +
              `${ranks.map((value) => `**${fmt(value)}**`).join(", ")} points` +
              (then ? `, puis **${fmt(then)}** chacun.` : ".")
          )
        : null,
      rule(
        `Ils paient les balls, les évolutions${rules.fishing.enabled ? ", la pêche" : ""} et ` +
          `l'entrée du parc safari.`
      )
    )
  );
}

function lottery(rules) {
  if (!rules.lottery.enabled) return null;
  return card(
    "Loterie",
    {},
    facts([pct(rules.lottery.winChance), "de gagner un objet"]),
    list(
      rule(
        "Un tirage par jour avec /pk loterie. Les chances de chaque objet sont dans « Objets »."
      ),
      rules.lottery.lotDecay > 0 && rules.lottery.lotDecay < 1
        ? rule(
            `Dans un lot, chaque exemplaire de plus est **${fmt(1 / rules.lottery.lotDecay)} ` +
              `fois** moins probable.`
          )
        : null
    )
  );
}

// ---------------------------------------------------------------- Attraper

function spawns(rules) {
  const { spawn } = rules;
  return card(
    "Apparitions",
    { wide: true },
    facts(
      [`${fmt(spawn.messages)} messages`, "avant qu'il laisse sa place"],
      [
        `${duration(spawn.fleeMinutes.min)} à ${duration(spawn.fleeMinutes.max)}`,
        "avant qu'il s'enfuie seul",
      ],
      [`1 sur ${fmt(spawn.shinyOdds)}`, "est shiny ✨"],
      [pct(spawn.heldItemChance), "tiennent un objet"]
    ),
    list(
      rule(
        `Un Pokémon capturé ou enfui est remplacé au message suivant` +
          (spawn.afterEndMinutes ? ` (après ${duration(spawn.afterEndMinutes)})` : "") +
          `. Sinon, il laisse sa place au bout de **${fmt(spawn.messages)} messages** (et au ` +
          `moins ${duration(spawn.minDelayMinutes)}), ou s'enfuit seul.`
      ),
      rule(
        `Un **légendaire** reste **${fmt(spawn.legendaryFleeMultiplier)} fois plus longtemps** ` +
          `(${duration(spawn.fleeMinutes.min * spawn.legendaryFleeMultiplier)} à ` +
          `${duration(spawn.fleeMinutes.max * spawn.legendaryFleeMultiplier)}) et les messages ` +
          `ne le font jamais partir : seule son échéance, ou une capture, le retire.`
      ),
      rule(
        `L'objet tenu revient au capteur — sauf **${pct(spawn.itemDropChance)}** du temps : il ` +
          `tombe, capturé ou enfui, et le premier autre dresseur à cliquer « Ramasser » le prend.`
      )
    ),
    rarityTable(spawn.rarities)
  );
}

function capture(rules) {
  // La Master Ball n'a pas de colonne : elle capture à coup sûr.
  const balls = rules.capture.balls.filter((ball) => !ball.guaranteed);
  const sure = rules.capture.balls.filter((ball) => ball.guaranteed);
  return card(
    "Capture",
    { wide: true },
    facts([`${fmt(rules.capture.cooldownSeconds)} s`, "entre deux lancers"]),
    list(
      rule("Le premier lancer réussi l'emporte. Une ball de ton sac passe avant tes points."),
      h(
        "li",
        {},
        rules.capture.balls.map((ball, index) => [
          index ? " · " : "",
          itemIcon(ball),
          " ",
          h("strong", {}, ball.label),
          // Au prix qui monte, celui d'ici est le premier : on dit de combien
          // chaque achat suivant renchérit.
          ball.priceGrowth
            ? ` dès ${fmt(ball.price)} pts (+${fmt((ball.priceGrowth - 1) * 100)} % à chaque achat)`
            : ` ${fmt(ball.price)} pts`,
          ball.guaranteed ? ", capture garantie" : ` (×${fmt(ball.multiplier)})`,
        ])
      )
    ),
    scroll(
      h(
        "table",
        { class: "rules-table" },
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", {}, "Difficulté"),
            balls.map((ball) => h("th", { title: ball.label }, itemIcon(ball)))
          )
        ),
        h(
          "tbody",
          {},
          rules.capture.table.map((band) =>
            h(
              "tr",
              {},
              h("td", {}, band.label),
              balls.map((ball) => {
                const odds = band.balls.find((entry) => entry.key === ball.key);
                return h("td", {}, odds ? range(odds.min, odds.max) : "—");
              })
            )
          )
        )
      )
    ),
    h(
      "p",
      { class: "muted small" },
      "Chances d'une capture au premier lancer, selon l'espèce. L'apparition affiche les siennes" +
        (sure.length ? `, et la ${sure.map((ball) => ball.label).join(", ")} ne rate jamais.` : ".")
    )
  );
}

function shop(rules) {
  if (!rules.shop.balls.length) return null;
  return card(
    "Boutique",
    {},
    h(
      "ul",
      { class: "items" },
      rules.shop.balls.map((ball) =>
        h(
          "li",
          { class: "item" },
          h("span", { class: "item-icon" }, itemIcon(ball)),
          h(
            "span",
            { class: "item-text" },
            h("strong", {}, `${ball.label} · ${fmt(ball.price)} pts`),
            h("span", { class: "small" }, ball.effect)
          )
        )
      )
    ),
    list(
      rule(
        `Elles s'achètent avec /pk boutique, **${fmt(rules.shop.maxHeld)}** de chaque au plus en poche ` +
          `et **${fmt(rules.shop.dailyLimit)}** de chaque par jour (minuit UTC), ` +
          `et se lancent depuis « Balls spéciales ».`
      ),
      rule(
        "Une ball achetée ne sert qu'aux Pokémon apparus **après** son achat. Si un autre " +
          "attrape le Pokémon avant toi, elle t'est rendue."
      )
    )
  );
}

function charm(rules) {
  if (!rules.charm?.generations.length) return null;
  const { multiplier, generations } = rules.charm;
  return card(
    "Charme Chroma",
    {},
    facts(
      [`×${fmt(multiplier)}`, "de chances de shiny sur sa génération"],
      [`1 sur ${fmt(Math.round(rules.spawn.shinyOdds / multiplier))}`, "en apparition"]
    ),
    list(
      rule(
        `Complète le Pokédex d'une génération, légendaires et fabuleux à part : ` +
          generations
            .map(
              (entry) => `**${fmt(entry.required)} espèces** pour la ${ordinal(entry.generation)}`
            )
            .join(", ") +
          `. Tu reçois son 🌟 Charme Chroma, pour de bon.`
      ),
      rule(`Le bonus vaut aussi au parc safari et dans les œufs.`),
      rule(
        "Une apparition peut ne briller que pour les porteurs : l'annonce le dit et mentionne " +
          "leur rôle. Attrapée avec le charme, c'est un shiny ; sans, un Pokémon normal."
      )
    )
  );
}

// ---------------------------------------------------------------- Sorties

function safari(rules) {
  const park = rules.safari;
  if (!park.enabled) return null;
  const [first, ...more] = park.bait;
  const last = park.bait[park.bait.length - 1];
  return card(
    "Parc Safari",
    { wide: true },
    facts(
      [`${fmt(park.durationHours)} h`, "d'ouverture, au hasard"],
      [`${fmt(park.actions)} actions`, "gratuites par visite"],
      [`${fmt(park.entryPrice)} pts`, "l'entrée hors ouverture"],
      [`1 sur ${fmt(park.shinyOdds)}`, "est shiny ✨"]
    ),
    list(
      rule(
        `Il s'ouvre au hasard (**${pct(park.chancePerHour)}** par heure, au moins ` +
          `**${fmt(park.minHoursBetween)} h** entre deux), et suspend les apparitions ` +
          `**${fmt(park.spawnPauseHours)} h**.`
      ),
      rule(
        `Entrée gratuite pendant un parc ; sinon un Ticket Safari ou **${fmt(park.entryPrice)} pts**, ` +
          `une fois par **${fmt(park.entryCooldownHours)} h**.`
      ),
      h(
        "li",
        {},
        itemIcon(park.ball),
        " ",
        richText(`${park.ball.label} : **×${fmt(park.ball.multiplier)}** sur les chances.`)
      ),
      more.length
        ? rule(
            `🍎 Appât : chances ×${fmt(more[0].factor)}, jusqu'à **×${fmt(last.factor)}** ; mais sa ` +
              `fuite passe de **${pct(first.flee)}** à ` +
              `${more.map((step) => `**${pct(step.flee)}**`).join(" puis ")}.`
          )
        : null,
      rule(`🏃 Fuir : passer au suivant, **${pct(park.fleeFailChance)}** d'échec.`),
      rule("Les évolutions y sont plus fréquentes :")
    ),
    rarityTable(park.rarities)
  );
}

function fishing(rules) {
  const { fishing: fish } = rules;
  if (!fish.enabled || !fish.rods.length) return null;
  const prices = new Set(fish.rods.map((rod) => rod.price));
  const base = fish.rods.find((rod) => rod.base);
  return card(
    "Pêche",
    { wide: true },
    facts(
      prices.size === 1
        ? [`${fmt(fish.rods[0].price)} pts`, "le lancer, quelle que soit la canne"]
        : null,
      [seconds(fish.fleeSeconds), "avant que la touche s'enfuie"]
    ),
    list(
      rule(
        "Lance ta ligne avec /pk pecher (ou depuis la page Capture) : le Pokémon qui mord est " +
          "**pour toi seul**. Une touche à la fois, et les balls se paient comme sur une apparition."
      ),
      base
        ? rule(
            `La ${base.label} est donnée à tous ; les autres cannes tombent sur les Pokémon ` +
              `capturés et se gagnent à la loterie.`
          )
        : null,
      fish.wildRarityFactor < 1
        ? rule(
            `Ce qui se pêche est plus rare à l'état sauvage : **×${fmt(fish.wildRarityFactor)}** ` +
              `sur ses chances d'apparition, au parc safari compris.`
          )
        : null
    ),
    table(
      ["Canne", prices.size === 1 ? null : "Prix", "Espèces", "Les plus probables"].filter(Boolean),
      fish.rods.map((rod) =>
        [
          [itemIcon(rod), " ", rod.label],
          prices.size === 1 ? null : `${fmt(rod.price)} pts`,
          fmt(rod.species),
          rod.top.map((entry) => `${entry.name} ${pct(entry.share)}`).join(", ") +
            (rod.species > rod.top.length ? "…" : ""),
        ].filter((cell) => cell !== null)
      )
    )
  );
}

// ---------------------------------------------------------------- Collection

function starters(rules) {
  const { generations, tiers } = rules.starters;
  if (!generations.length) return null;
  const reward = (tier) =>
    tier.stage === 1 ? "ton starter" : `le stade ${fmt(tier.stage)} de ta lignée`;
  return generations.map((entry) =>
    card(
      `Starter de la ${ordinal(entry.generation)} génération`,
      {},
      list(
        rule(
          `Choisis-en un parmi ${fmt(entry.choices.length)} avec /pk starter : c'est ` +
            "**définitif**, et tu reçois tout de suite son premier stade."
        ),
        ...entry.choices.map((choice) => rule(`**${choice.line.join(" → ")}**`))
      ),
      tiers.length
        ? table(
            [`Pokédex de la ${ordinal(entry.generation)}`, "Récompense"],
            tiers.map((tier) => [
              `${fmt(tier.percent)} %`,
              `${reward(tier)}${tier.shiny ? " en shiny ✨" : ""}`,
            ])
          )
        : null,
      h(
        "p",
        { class: "muted small" },
        "Légendaires et fabuleux à part, comme pour le Charme Chroma."
      )
    )
  );
}

function evolution(rules) {
  const { stages, branches, dittosPerCopy, metamorph } = rules.evolution;
  const step = (stage) => (stage === 2 ? "1re" : `${stage - 1}e`);
  return card(
    "Évolution",
    {},
    stages.length
      ? table(
          ["Évolution", "Sacrifices", "Prix", "Il t'en faut"],
          stages.map((stage) => [
            step(stage.stage),
            fmt(stage.sacrifices),
            `${fmt(stage.points)} pts`,
            fmt(stage.required),
          ])
        )
      : null,
    list(
      rule("« Il t'en faut » compte celui qui évolue, les sacrifices et un qui reste."),
      ...branches.map((branch) =>
        rule(
          `${branch.species.join(", ")} : **${fmt(branch.random)} pts** au hasard, ` +
            `**${fmt(branch.choose)} pts** pour choisir la forme.`
        )
      ),
      metamorph
        ? rule(
            `**${fmt(dittosPerCopy)} ${metamorph}**, shiny ou non, remplace un sacrifice manquant ; ` +
              `certains objets aussi (voir Objets).`
          )
        : null,
      rule(
        "Celui qui évolue reste lui-même : numéro, sexe, ball, shiny. Sans préciser lequel, le bot " +
          "garde tes Pokémon les plus précieux, et ne touche jamais à un verrouillé 🛡️."
      )
    )
  );
}

function eggs(rules) {
  if (!rules.eggs.enabled) return null;
  return card(
    "Œufs",
    {},
    facts(
      [
        `${fmt(rules.eggs.hatchHours)} h`,
        `ou ${fmt(rules.eggs.hatchMessages)} de tes messages pour éclore`,
      ],
      [`×${fmt(rules.eggs.shinyFactors[1])}`, "de shiny avec deux parents shiny"]
    ),
    list(
      rule(
        "Un mâle et une femelle d'une même famille à bébé — Métamorph peut remplacer l'un " +
          "des deux — pondent un œuf. Chaque parent ne pond qu'une fois. C'est la seule façon " +
          "d'obtenir les bébés 🥚."
      ),
      rule(
        `Il éclot au premier des deux seuils. **${fmt(rules.eggs.perDay)}** ponte` +
          `${rules.eggs.perDay > 1 ? "s" : ""} par jour au plus, compteur remis à zéro à minuit UTC.`
      ),
      rule(
        `Chances de shiny d'une apparition, **×${fmt(rules.eggs.shinyFactors[0])}** avec un ` +
          `parent shiny, **×${fmt(rules.eggs.shinyFactors[1])}** avec deux.`
      )
    )
  );
}

function lock(rules) {
  const arriving = [rules.lock.shiny && "shiny", rules.lock.legendary && "légendaires"].filter(
    Boolean
  );
  return card(
    "Verrou",
    {},
    list(
      arriving.length ? rule(`Les ${arriving.join(" et les ")} arrivent verrouillés 🛡️.`) : null,
      rule(
        "Un verrouillé ne part jamais : ni revente, ni échange, ni sacrifice. Il peut évoluer, " +
          "après confirmation, et pondre. /pk verrou le change."
      )
    )
  );
}

function items(rules) {
  return card(
    "Objets",
    { wide: true },
    h(
      "ul",
      { class: "items rules-items" },
      rules.items.map((item) => {
        const lot = item.lot.max > 1 ? ` (lot de ${fmt(item.lot.min)} à ${fmt(item.lot.max)})` : "";
        const details = [
          item.held > 0 ? `**${oneIn(item.held)}** Pokémon le tient` : null,
          item.lottery > 0 ? `loterie **${pct(item.lottery)}**${lot}` : null,
          item.sellValue > 0 ? `revente **${fmt(item.sellValue)} pts**` : null,
          item.maxHeld
            ? `**${fmt(item.maxHeld)}** en poche au plus, ` +
              (item.upgradesTo ? `devient une **${item.upgradesTo}** au-delà, ou ` : "") +
              `vendue **${fmt(item.overflowValue)} pts**${item.upgradesTo ? " si tu l'as déjà" : " au-delà"}`
            : null,
        ].filter(Boolean);
        return h(
          "li",
          { class: "item" },
          h("span", { class: "item-icon" }, itemIcon(item)),
          h(
            "span",
            { class: "item-text" },
            h("strong", {}, item.label),
            item.description ? h("span", { class: "muted small" }, item.description) : null,
            details.length ? h("span", { class: "small" }, richText(details.join(" · "))) : null
          )
        );
      })
    )
  );
}

// ---------------------------------------------------------------- Échanger

function trade(rules) {
  return card(
    "Échanges",
    {},
    facts([`${fmt(rules.trade.expiryHours)} h`, "pour répondre à une offre"]),
    list(
      rule(
        "Seuls les doublons partent : il te reste toujours un exemplaire de chaque espèce, shiny " +
          "ou non. /pk doublons les montre, chez toi ou chez un autre, et /pk comparer cherche les " +
          "échanges qui complètent le Pokédex des deux."
      ),
      rule("Un Pokémon, des points ou un objet de chaque côté ; les charmes ne s'échangent pas."),
      rules.trade.evolutions.length
        ? rule(
            `Reçus en échange, ils évoluent gratuitement (/pk evolution) : ${rules.trade.evolutions
              .map((entry) => `${entry.from} → ${entry.to}`)
              .join(", ")}. Tu peux te les échanger à toi-même.`
          )
        : null
    )
  );
}

function sale(rules) {
  const priced = rules.sell.byRarity.filter((entry) => entry.price);
  const refused = [
    ...rules.sell.byRarity
      .filter((entry) => !entry.price)
      .map((entry) => `les ${entry.label.toLowerCase()}s`),
    rules.sell.shinySellable ? null : "les shiny",
  ].filter(Boolean);
  return card(
    "Revente",
    {},
    priced.length
      ? table(
          ["Rareté", "Prix"],
          priced.map((entry) => [
            colorChip(entry.label, { className: `rarity-${entry.key}` }),
            `${fmt(entry.price)} pts`,
          ])
        )
      : null,
    list(
      rule("Seuls les doublons se revendent, avec /pk revendre."),
      refused.length ? rule(`Ne se revendent pas : ${refused.join(", ")}.`) : null
    )
  );
}

// ---------------------------------------------------------------- Commandes

// Le classement des commandes par thème, pour la présentation seulement : une
// commande que la liste ne connaît pas tombe dans « Autres », elle ne disparaît pas.
const COMMAND_GROUPS = [
  [
    "Collection",
    [
      "pokedex",
      "boite",
      "doublons",
      "vitrine",
      "renommer",
      "verrou",
      "info",
      "inventaire",
      "classement",
    ],
  ],
  ["Attraper", ["starter", "boutique", "pecher", "safari", "loterie"]],
  ["Évolution et œufs", ["evolution", "oeuf"]],
  ["Échanger et revendre", ["echange", "comparer", "revendre"]],
];

function commands(entries) {
  if (!entries.length) return null;
  const usage = (entry) =>
    [
      entry.name,
      ...entry.options.map((option) => (option.required ? `<${option.name}>` : `[${option.name}]`)),
    ].join(" ");
  const groupOf = (entry) =>
    COMMAND_GROUPS.find(([, names]) => names.includes(entry.name.split(" ")[1]))?.[0] ?? "Autres";
  const groups = [...COMMAND_GROUPS.map(([label]) => label), "Autres"]
    .map((label) => [label, entries.filter((entry) => groupOf(entry) === label)])
    .filter(([, members]) => members.length);
  return groups.map(([label, members]) =>
    card(
      label,
      {},
      h(
        "ul",
        { class: "rules-commands" },
        members.map((entry) =>
          h(
            "li",
            {},
            h("code", {}, usage(entry)),
            h("span", { class: "muted small" }, entry.description)
          )
        )
      )
    )
  );
}

// ---------------------------------------------------------------- Page

// La génération programmée, annoncée avec ce qu'elle apporte : une date à venir dit
// aux joueurs pourquoi certaines règles ne sont pas encore là.
function upcoming(rules) {
  const next = rules.nextGeneration;
  if (!next) return null;
  return h(
    "p",
    { class: "rules-banner" },
    richText(
      `🆕 La **${ordinal(next.generation)} génération** ouvre le ${dateTimeFr(next.opensAt)}. ` +
        "Ses règles s'ajouteront ici à l'ouverture."
    )
  );
}

export async function render() {
  const rules = await api("/api/rules");

  const themes = [
    theme(
      "infos-points",
      "Gagner des points",
      "Tes messages sur le serveur rapportent des points, qui paient presque tout le reste.",
      points(rules),
      lottery(rules)
    ),
    theme(
      "infos-attraper",
      "Attraper",
      "Un Pokémon apparaît dans le salon : le premier qui l'attrape le garde.",
      spawns(rules),
      capture(rules),
      shop(rules),
      charm(rules)
    ),
    theme(
      "infos-sorties",
      "Safari et pêche",
      "D'autres façons de rencontrer des Pokémon, rien que pour toi.",
      safari(rules),
      fishing(rules)
    ),
    theme(
      "infos-collection",
      "Faire grandir sa collection",
      "Faire évoluer, faire pondre, et protéger ce qui compte.",
      starters(rules),
      evolution(rules),
      eggs(rules),
      lock(rules),
      items(rules)
    ),
    theme(
      "infos-echanges",
      "Échanger et revendre",
      "Tes doublons servent à compléter le Pokédex des autres, ou à remplir ta bourse.",
      trade(rules),
      sale(rules)
    ),
    theme(
      "infos-commandes",
      "Commandes",
      "Tout se fait aussi sur Discord, avec /pk.",
      commands(rules.commands)
    ),
  ].filter(Boolean);

  // Un sommaire en tête : chaque bouton amène à son thème, sans changer
  // d'adresse (le routeur relirait la page à chaque ancre).
  const nav = h(
    "nav",
    { class: "rules-nav", "aria-label": "Sommaire" },
    themes.map((element) =>
      h(
        "button",
        {
          class: "button small",
          type: "button",
          onclick: () => element.scrollIntoView({ behavior: "smooth", block: "start" }),
        },
        element.querySelector("h2").textContent
      )
    )
  );

  return h(
    "section",
    { class: "view rules" },
    h(
      "div",
      { class: "view-head" },
      h("h1", {}, "Infos"),
      h(
        "p",
        { class: "muted" },
        "Les règles du jeu en bref, avec les réglages en cours. Tout se fait aussi sur Discord avec /pk."
      )
    ),
    upcoming(rules),
    nav,
    themes
  );
}
