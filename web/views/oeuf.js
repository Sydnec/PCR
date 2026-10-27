// L'œuf : celui qui couve, ou de quoi en pondre un — comme /pk oeuf voir et
// /pk oeuf pondre.
import { icon } from "../icons.js";
import { api, dateTimeFr, fmt, h, pokemonName, progressBar, toast } from "../lib.js";

export async function render(ctx) {
  const { egg } = await api("/api/me/egg");
  const content = egg ? incubating(ctx, egg) : await layForm(ctx);
  return h(
    "section",
    { class: "view" },
    h("div", { class: "view-head" }, h("h1", {}, "Œuf")),
    content
  );
}

function incubating(ctx, egg) {
  const baby = ctx.species.get(egg.speciesId);
  const father = ctx.species.get(egg.fatherSpeciesId);
  const mother = ctx.species.get(egg.motherSpeciesId);
  const left = Math.max(0, egg.hatchMessages - egg.messages);
  const elapsed = ((Date.now() - egg.laidAt) / (egg.hatchAt - egg.laidAt)) * 100;
  return h(
    "div",
    { class: "egg" },
    icon("egg", { className: "egg-shell" }),
    h(
      "p",
      {},
      "Un œuf de ",
      h("strong", {}, baby?.name ?? "?"),
      ", pondu par ",
      // Métamorph n'a pas de sexe, même quand il tient le rôle du père ou de la mère.
      pokemonName(father, false, father?.genderless ? null : "M"),
      " et ",
      pokemonName(mother, false, mother?.genderless ? null : "F"),
      "."
    ),
    h(
      "div",
      { class: "egg-bars" },
      h(
        "p",
        { class: "small" },
        `Messages : ${fmt(egg.messages)} / ${fmt(egg.hatchMessages)} (encore ${fmt(left)})`
      ),
      progressBar((egg.messages / egg.hatchMessages) * 100),
      h("p", { class: "small" }, `Temps : éclosion au plus tard ${dateTimeFr(egg.hatchAt)}`),
      progressBar(elapsed)
    ),
    egg.shinyParents > 0
      ? h(
          "p",
          { class: "small" },
          icon("sparkle", { label: "Shiny" }),
          ` ${egg.shinyParents > 1 ? "Ses deux parents sont shiny" : "Un parent shiny"} : ` +
            `chances de shiny ×${fmt(egg.shinyFactor)}.`
        )
      : null,
    egg.charmFactor > 1
      ? h(
          "p",
          { class: "small" },
          icon("sparkle", { label: "Charme Chroma" }),
          ` Ton Charme Chroma : chances de shiny ×${fmt(egg.charmFactor)}` +
            (egg.shinyParents > 0 ? `, ×${fmt(egg.shinyFactor * egg.charmFactor)} en tout.` : ".")
        )
      : null,
    h(
      "p",
      { class: "muted small" },
      "Il éclot au premier des deux seuils. Ce sont tes messages sur le serveur qui comptent."
    )
  );
}

// Les candidats : les parents possibles groupés par espèce, variante et sexe,
// comme dans /pk oeuf. L'API tranche à la ponte (même famille, un mâle et une
// femelle, un seul Métamorph) : la liste ne fait que dégrossir.
async function layForm(ctx) {
  const { parents } = await api("/api/me/egg/parents");
  const babies = [...ctx.species.values()]
    .filter((species) => species.baby)
    .map((species) => species.name);

  const intro = h(
    "p",
    { class: "muted" },
    "Aucun œuf ne couve. Un mâle et une femelle d'une famille qui a un bébé pondent un œuf de ce bébé ; ",
    "Métamorph peut remplacer l'un des deux. Chaque parent ne pond qu'une fois.",
    babies.length
      ? ` Familles qui pondent : ${babies.join(", ")}.`
      : " Aucun bébé n'existe encore dans les générations ouvertes."
  );
  if (parents.length < 2) {
    return h(
      "div",
      {},
      intro,
      h(
        "p",
        { class: "notice" },
        "Il te faut au moins deux parents fertiles possibles pour pondre."
      )
    );
  }

  const label = (group) =>
    `${pokemonName(ctx.species.get(group.speciesId), group.shiny, group.sex).textContent} ` +
    `×${fmt(group.count)} — ` +
    (group.babyId
      ? `donne ${ctx.species.get(group.babyId)?.name ?? "?"}`
      : "remplace n'importe quel parent");
  const picker = (name) =>
    h(
      "select",
      { name, required: true },
      h("option", { value: "" }, "Choisir un parent…"),
      parents.map((group, index) => h("option", { value: index }, label(group)))
    );
  const selector = (select) => {
    const group = parents[Number(select.value)];
    return { speciesId: group.speciesId, isShiny: group.shiny, sex: group.sex };
  };
  const first = picker("parent1");
  const second = picker("parent2");
  const submit = h("button", { class: "button primary", type: "submit" }, "Pondre");

  const form = h(
    "form",
    {
      class: "lay-form",
      onsubmit: async (event) => {
        event.preventDefault();
        submit.disabled = true;
        try {
          await api("/api/me/eggs", {
            method: "POST",
            body: { parent1: selector(first), parent2: selector(second) },
          });
          toast("Un œuf a été pondu !", "success");
          await ctx.refreshMe();
          ctx.navigate("/oeuf");
        } catch (error) {
          toast(error.message, "error");
          submit.disabled = false;
        }
      },
    },
    h("label", {}, "Premier parent", first),
    h("label", {}, "Second parent", second),
    submit
  );
  return h("div", {}, intro, form);
}
