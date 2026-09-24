// Infos : les règles du jeu en bref. Chaque chiffre vient de l'API (/api/rules),
// qui le lit dans les réglages en cours ou le calcule avec la fonction même qui
// tire au sort : la page ne recalcule rien, elle ne fait que mettre en forme.
import { api, colorChip, fmt, h, itemIcon, percent, richText } from "../lib.js";

// Une ligne de règle : le gras (**…**) et les emoji comme dans les messages du
// jeu.
const rule = (text) => h("li", {}, richText(text));

// Une part réglée (7 %, 20 %, 66,7 %) : une décimale au plus. Sous 1 %, les
// chances comme sur les annonces (0,36 %).
const pct = (probability) =>
  probability < 0.01 ? percent(probability) : `${fmt(Math.round(probability * 1000) / 10)} %`;

// « 1 sur 33 » plutôt que « 3,03 % » : plus parlant pour ce qui est rare.
const oneIn = (probability) => `1 sur ${fmt(Math.round(1 / probability))}`;

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

function rarityTable(rarities) {
  return h(
    "table",
    { class: "rules-table" },
    h(
      "thead",
      {},
      h("tr", {}, h("th", {}, "Rareté"), h("th", {}, "Chance"), h("th", {}, "Espèces"))
    ),
    h(
      "tbody",
      {},
      rarities.map((rarity) =>
        h(
          "tr",
          {},
          h("td", {}, colorChip(rarity.label, { className: `rarity-${rarity.key}` })),
          h("td", {}, pct(rarity.share)),
          h("td", {}, fmt(rarity.species))
        )
      )
    )
  );
}

const section = (id, title, ...content) =>
  h("section", { class: "rules-section", id }, h("h2", {}, title), content);

function commands(entries) {
  const usage = (entry) =>
    [
      entry.name,
      ...entry.options.map((option) => (option.required ? `<${option.name}>` : `[${option.name}]`)),
    ].join(" ");
  return h(
    "ul",
    { class: "rules-commands" },
    entries.map((entry) =>
      h(
        "li",
        {},
        h("code", {}, usage(entry)),
        h("span", { class: "muted small" }, entry.description)
      )
    )
  );
}

function capture(rules) {
  // La Master Ball n'a pas de colonne : elle capture à coup sûr.
  const balls = rules.capture.balls.filter((ball) => !ball.guaranteed);
  const sure = rules.capture.balls.filter((ball) => ball.guaranteed);
  return [
    list(
      rule(
        `Le premier lancer réussi l'emporte. **${fmt(rules.capture.cooldownSeconds)} s** entre ` +
          `deux lancers. Une ball de ton sac passe avant tes points.`
      ),
      h(
        "li",
        {},
        rules.capture.balls.map((ball, index) => [
          index ? " · " : "",
          itemIcon(ball),
          " ",
          h("strong", {}, ball.label),
          ` ${fmt(ball.price)} pts`,
          ball.guaranteed ? ", capture garantie" : ` (×${fmt(ball.multiplier)})`,
        ])
      )
    ),
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
    ),
    h(
      "p",
      { class: "muted small" },
      "Chances d'une capture au premier lancer, selon l'espèce. L'apparition affiche les siennes" +
        (sure.length ? `, et la ${sure.map((ball) => ball.label).join(", ")} ne rate jamais.` : ".")
    ),
  ];
}

function items(rules) {
  return h(
    "ul",
    { class: "items" },
    rules.items.map((item) => {
      const lot = item.lot.max > 1 ? ` (lot de ${fmt(item.lot.min)} à ${fmt(item.lot.max)})` : "";
      const facts = [
        item.held > 0 ? `**${oneIn(item.held)}** Pokémon le tient` : null,
        item.lottery > 0 ? `loterie **${pct(item.lottery)}**${lot}` : null,
        item.sellValue > 0 ? `revente **${fmt(item.sellValue)} pts**` : null,
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
          facts.length ? h("span", { class: "small" }, richText(facts.join(" · "))) : null
        )
      );
    })
  );
}

function evolution(rules) {
  const { stages, branches, dittosPerCopy, metamorph } = rules.evolution;
  const ordinal = (stage) => (stage === 2 ? "1re" : `${stage - 1}e`);
  return list(
    ...stages.map((stage) =>
      rule(
        `${ordinal(stage.stage)} évolution : **${fmt(stage.sacrifices)} sacrifice` +
          `${stage.sacrifices > 1 ? "s" : ""}** et **${fmt(stage.points)} pts**. Il t'en faut ` +
          `**${fmt(stage.required)}** : celui qui évolue, les sacrifices et un qui reste.`
      )
    ),
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
  );
}

function tradeAndSale(rules) {
  const priced = rules.sell.byRarity.filter((entry) => entry.price);
  const unpriced = rules.sell.byRarity.filter((entry) => !entry.price);
  const refused = [
    ...unpriced.map((entry) => `les ${entry.label.toLowerCase()}s`),
    rules.sell.shinySellable ? null : "les shiny",
  ].filter(Boolean);
  return list(
    rule(
      "Seuls les doublons partent : il te reste toujours un exemplaire de chaque espèce, shiny " +
        "ou non. /pk doublons les montre, chez toi ou chez un autre."
    ),
    rule(
      `Une offre d'échange expire après **${fmt(rules.trade.expiryHours)} h**.` +
        (rules.trade.evolutions.length
          ? ` Évoluent en changeant de dresseur : ${rules.trade.evolutions
              .map((entry) => `${entry.from} → ${entry.to}`)
              .join(", ")}.`
          : "")
    ),
    rule(
      `Revente : ${priced.map((entry) => `${entry.label} **${fmt(entry.price)} pts**`).join(", ")}` +
        (refused.length ? ` ; ${refused.join(" et ")} ne se revendent pas.` : ".")
    )
  );
}

function safari(rules) {
  const park = rules.safari;
  const [first, ...more] = park.bait;
  const last = park.bait[park.bait.length - 1];
  return [
    list(
      rule(
        `Il s'ouvre au hasard (**${pct(park.chancePerHour)}** par heure, au moins ` +
          `**${fmt(park.minHoursBetween)} h** entre deux) pour **${fmt(park.durationHours)} h**, et ` +
          `suspend les apparitions **${fmt(park.spawnPauseHours)} h**.`
      ),
      rule(
        `Entrée gratuite pendant un parc ; sinon un Ticket Safari ou **${fmt(park.entryPrice)} pts**, ` +
          `une fois par **${fmt(park.entryCooldownHours)} h**.`
      ),
      h(
        "li",
        {},
        richText(`**${fmt(park.actions)} actions** gratuites par visite :`),
        h(
          "ul",
          {},
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
          rule(`🏃 Fuir : passer au suivant, **${pct(park.fleeFailChance)}** d'échec.`)
        )
      ),
      rule(`**1 sur ${fmt(park.shinyOdds)}** est shiny ✨. Les évolutions y sont plus fréquentes :`)
    ),
    rarityTable(park.rarities),
  ];
}

export async function render() {
  const rules = await api("/api/rules");
  const { spawn } = rules;

  const sections = [
    section(
      "infos-points",
      "Points",
      list(
        rule(
          `Chaque jour, tes messages récompensés rapportent ` +
            `${rules.points.ranks.map((points) => `**${fmt(points)}**`).join(", ")} points` +
            (rules.points.then ? `, puis **${fmt(rules.points.then)}** chacun.` : ".")
        ),
        rule("Ils paient les balls, les évolutions et l'entrée du parc safari.")
      )
    ),
    section(
      "infos-apparitions",
      "Apparitions",
      list(
        rule(
          `Un Pokémon capturé ou enfui est remplacé au message suivant` +
            (spawn.afterEndMinutes ? ` (après ${duration(spawn.afterEndMinutes)})` : "") +
            `. Sinon, il laisse sa place au bout de **${fmt(spawn.messages)} messages** (et au ` +
            `moins ${duration(spawn.minDelayMinutes)}), ou s'enfuit seul après ` +
            `**${duration(spawn.fleeMinutes.min)} à ${duration(spawn.fleeMinutes.max)}**.`
        ),
        rule(`**1 sur ${fmt(spawn.shinyOdds)}** est shiny ✨.`),
        rule(
          `**${pct(spawn.heldItemChance)}** tiennent un objet, qui revient au capteur — sauf ` +
            `**${pct(spawn.itemDropChance)}** du temps : il tombe, capturé ou enfui, et le ` +
            `premier autre dresseur à cliquer « Ramasser » le prend.`
        )
      ),
      rarityTable(spawn.rarities)
    ),
    rules.charm?.generations.length
      ? section(
          "infos-charme",
          "Charme Chroma",
          list(
            rule(
              `Complète le Pokédex d'une génération, légendaires et fabuleux à part : ` +
                rules.charm.generations
                  .map(
                    (entry) =>
                      `**${fmt(entry.required)} espèces** pour la ` +
                      `${entry.generation === 1 ? "1re" : `${entry.generation}e`}`
                  )
                  .join(", ") +
                `. Tu reçois son 🌟 Charme Chroma, pour de bon.`
            ),
            rule(
              `Tes chances de shiny sont alors **×${fmt(rules.charm.multiplier)}** sur les Pokémon ` +
                `de sa génération : **1 sur ${fmt(Math.round(spawn.shinyOdds / rules.charm.multiplier))}** ` +
                `en apparition, et ×${fmt(rules.charm.multiplier)} aussi au parc safari et dans les œufs.`
            ),
            rule(
              "Une apparition peut ne briller que pour les porteurs : l'annonce le dit et mentionne " +
                "leur rôle. Attrapée avec le charme, c'est un shiny ; sans, un Pokémon normal."
            )
          )
        )
      : null,
    section("infos-capture", "Capture", capture(rules)),
    section("infos-objets", "Objets", items(rules)),
    rules.lottery.enabled
      ? section(
          "infos-loterie",
          "Loterie",
          list(
            rule(
              `Un tirage par jour avec /pk loterie : **${pct(rules.lottery.winChance)}** de ` +
                `gagner un objet (chances de chacun dans Objets).`
            ),
            rules.lottery.lotDecay > 0 && rules.lottery.lotDecay < 1
              ? rule(
                  `Dans un lot, chaque exemplaire de plus est **${fmt(1 / rules.lottery.lotDecay)} ` +
                    `fois** moins probable.`
                )
              : null
          )
        )
      : null,
    section("infos-evolution", "Évolution", evolution(rules)),
    rules.eggs.enabled
      ? section(
          "infos-oeufs",
          "Œufs",
          list(
            rule(
              "Un mâle et une femelle d'une même famille à bébé — Métamorph peut remplacer l'un " +
                "des deux — pondent un œuf. Chaque parent ne pond qu'une fois. C'est la seule façon " +
                "d'obtenir les bébés 🥚."
            ),
            rule(
              `Il éclot après **${fmt(rules.eggs.hatchHours)} h** ou ` +
                `**${fmt(rules.eggs.hatchMessages)} de tes messages**, au premier des deux.`
            ),
            rule(
              `Chances de shiny d'une apparition, **×${fmt(rules.eggs.shinyFactors[0])}** avec un ` +
                `parent shiny, **×${fmt(rules.eggs.shinyFactors[1])}** avec deux.`
            )
          )
        )
      : null,
    section("infos-echanges", "Échanges et revente", tradeAndSale(rules)),
    section(
      "infos-verrou",
      "Verrou",
      list(
        rules.lock.shiny || rules.lock.legendary
          ? rule(
              `Les ${[rules.lock.shiny && "shiny", rules.lock.legendary && "légendaires"]
                .filter(Boolean)
                .join(" et les ")} arrivent verrouillés 🛡️.`
            )
          : null,
        rule(
          "Un verrouillé ne part jamais : ni revente, ni échange, ni sacrifice. Il peut évoluer, " +
            "après confirmation, et pondre. /pk verrou le change."
        )
      )
    ),
    rules.safari.enabled ? section("infos-safari", "Parc Safari", safari(rules)) : null,
    rules.commands.length
      ? section("infos-commandes", "Commandes", commands(rules.commands))
      : null,
  ].filter(Boolean);

  // Un sommaire en tête : chaque bouton amène à sa section, sans changer
  // d'adresse (le routeur relirait la page à chaque ancre).
  const nav = h(
    "nav",
    { class: "rules-nav", "aria-label": "Sommaire" },
    sections.map((element) =>
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
    nav,
    sections
  );
}
