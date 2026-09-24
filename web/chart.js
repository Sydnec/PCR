// Une courbe dans le temps, en SVG : quelques séries sur un même axe, un
// réticule qui suit le pointeur et une bulle qui donne la valeur de chacune.
// Le SVG se redessine à la largeur de son cadre, pour que traits et textes
// gardent leur taille au lieu d'être étirés.
//
// La couleur d'une série vient de sa classe (.series-1 à .series-8, voir
// style.css), attribuée par l'appelant : une série garde la sienne quand les
// autres vont et viennent. Les textes restent dans les couleurs du texte ; le
// trait coloré posé à côté dit à quelle série ils appartiennent.
import { fmt, h } from "./lib.js";

const SVG = "http://www.w3.org/2000/svg";
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// createElementNS n'a pas d'équivalent à h() : même forme, pour le SVG.
function s(tag, attributes = {}, ...children) {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined) element.setAttribute(key, String(value));
  }
  for (const child of children.flat()) if (child) element.append(child);
  return element;
}

// Des graduations rondes (1, 2, 2,5 ou 5 × 10ⁿ) qui couvrent [min, max] ; entières,
// puisque les points le sont.
function valueTicks(min, max, count) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / count;
  const magnitude = Math.max(1, 10 ** Math.floor(Math.log10(raw)));
  // 2,5 × 1 ne tomberait pas juste : sous 10, le pas saute de 2 à 5.
  const factors = magnitude === 1 ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const step = factors.map((factor) => factor * magnitude).find((value) => value >= raw);
  const ticks = [];
  for (let value = Math.floor(min / step) * step; value < max + step; value += step) {
    ticks.push(value);
    if (value >= max) break;
  }
  return ticks;
}

// Des dates rondes : heures pleines sur une journée, minuits au-delà. Heures et
// jours s'ajoutent au calendrier, pas en millisecondes, pour qu'un changement
// d'heure ne décale pas les graduations.
function timeTicks(from, to, count) {
  const hours = [1, 2, 3, 6, 12].find((n) => (to - from) / (n * HOUR) <= count);
  const ticks = [];
  const date = new Date(from);
  if (hours) {
    date.setHours(Math.ceil((date.getHours() + date.getMinutes() / 60) / hours) * hours, 0, 0, 0);
    for (; date.getTime() <= to; date.setHours(date.getHours() + hours)) {
      ticks.push({ time: date.getTime(), label: hourLabel(date) });
    }
    return ticks;
  }
  const days =
    [1, 2, 7, 14, 30, 61, 91, 182, 365].find((n) => (to - from) / (n * DAY) <= count) ?? 365;
  date.setHours(0, 0, 0, 0);
  if (date.getTime() < from) date.setDate(date.getDate() + 1);
  for (; date.getTime() <= to; date.setDate(date.getDate() + days)) {
    ticks.push({
      time: date.getTime(),
      label: date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }),
    });
  }
  return ticks;
}

// Minuit porte le jour, les autres heures seulement l'heure.
const hourLabel = (date) =>
  date.getHours() === 0
    ? date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })
    : `${date.getHours()} h`;

const pointLabel = (time) =>
  new Date(time).toLocaleString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

// Le petit trait qui porte la couleur d'une série, dans une légende ou une bulle.
export const lineKey = (slot) =>
  h("span", { class: `line-key series-${slot}`, "aria-hidden": "true" });

// `series` : [{ label, slot, values }], `values` alignées sur `times` (null :
// pas de valeur, le trait s'interrompt). `labels` pose le nom de chaque série
// au bout de son trait, quand elles sont peu nombreuses.
export function lineChart({ times, series, labels = false, height = 280 }) {
  const frame = h("div", { class: "chart" });
  const tooltip = h("div", { class: "chart-tip", hidden: true, role: "status" });
  let svg = null;
  let width = 0;

  function draw() {
    width = frame.clientWidth;
    if (!width) return;
    const values = series.flatMap((entry) => entry.values).filter((value) => value !== null);
    if (!values.length) values.push(0);
    const ticks = valueTicks(Math.min(...values), Math.max(...values), height < 260 ? 4 : 5);
    const low = ticks[0];
    const high = ticks[ticks.length - 1];
    // Les noms en bout de courbe demandent une marge ; sur un écran étroit, la
    // légende suffit.
    const named = labels && width >= 560;
    const tickWidth = Math.max(...ticks.map((tick) => fmt(tick).length)) * 7.5 + 12;
    const margin = { top: 12, right: named ? 110 : 12, bottom: 28, left: tickWidth };
    const plotWidth = Math.max(10, width - margin.left - margin.right);
    const plotHeight = height - margin.top - margin.bottom;
    const from = times[0];
    const to = times[times.length - 1];
    const x = (time) => margin.left + ((time - from) / (to - from)) * plotWidth;
    const y = (value) => margin.top + plotHeight - ((value - low) / (high - low)) * plotHeight;

    const grid = ticks.map((tick) =>
      s(
        "g",
        {},
        s("line", {
          class: "chart-grid",
          x1: margin.left,
          x2: margin.left + plotWidth,
          y1: y(tick),
          y2: y(tick),
        }),
        s(
          "text",
          {
            class: "chart-tick",
            x: margin.left - 8,
            y: y(tick),
            "text-anchor": "end",
            dy: "0.32em",
          },
          fmt(tick)
        )
      )
    );
    const dates = timeTicks(from, to, Math.max(2, Math.floor(plotWidth / 70))).map((tick) =>
      s(
        "text",
        { class: "chart-tick", x: x(tick.time), y: height - 8, "text-anchor": "middle" },
        tick.label
      )
    );

    // Un tracé par série, interrompu là où la valeur manque.
    const lines = series.map((entry) => {
      let d = "";
      let pen = false;
      entry.values.forEach((value, index) => {
        if (value === null) {
          pen = false;
          return;
        }
        d += `${pen ? "L" : "M"}${x(times[index]).toFixed(1)},${y(value).toFixed(1)}`;
        pen = true;
      });
      return s("path", { class: `chart-line series-${entry.slot}`, d });
    });

    // Les noms au bout des traits, écartés d'au moins une ligne quand deux
    // courbes finissent au même niveau.
    const ends = named
      ? series
          .map((entry) => {
            const last = entry.values.findLast((value) => value !== null);
            return last === undefined ? null : { entry, y: y(last) };
          })
          .filter(Boolean)
          .sort((a, b) => a.y - b.y)
      : [];
    for (let index = 1; index < ends.length; index++) {
      ends[index].y = Math.max(ends[index].y, ends[index - 1].y + 14);
    }
    const endLabels = ends.map(({ entry, y: top }) =>
      s(
        "text",
        { class: "chart-label", x: margin.left + plotWidth + 8, y: top, dy: "0.32em" },
        // Par caractère, pas par unité UTF-16 : un emoji ne se coupe pas en deux.
        [...entry.label].length > 14 ? `${[...entry.label].slice(0, 13).join("")}…` : entry.label
      )
    );

    const cross = s("line", {
      class: "chart-cross",
      y1: margin.top,
      y2: margin.top + plotHeight,
      visibility: "hidden",
    });
    const dots = series.map((entry) =>
      s("circle", { class: `chart-dot series-${entry.slot}`, r: 4, visibility: "hidden" })
    );

    // Le point le plus proche du pointeur, et la valeur de chaque série à cet
    // instant, de la plus haute à la plus basse, comme les traits.
    function show(index) {
      const left = x(times[index]);
      cross.setAttribute("x1", left);
      cross.setAttribute("x2", left);
      cross.setAttribute("visibility", "visible");
      const rows = [];
      series.forEach((entry, position) => {
        const value = entry.values[index];
        const dot = dots[position];
        if (value === null) {
          dot.setAttribute("visibility", "hidden");
          return;
        }
        dot.setAttribute("cx", left);
        dot.setAttribute("cy", y(value));
        dot.setAttribute("visibility", "visible");
        rows.push({ entry, value });
      });
      rows.sort((a, b) => b.value - a.value);
      tooltip.replaceChildren(
        h("div", { class: "chart-tip-time" }, pointLabel(times[index])),
        ...rows.map(({ entry, value }) =>
          h(
            "div",
            { class: "chart-tip-row" },
            lineKey(entry.slot),
            h("strong", {}, fmt(value)),
            h("span", { class: "muted" }, entry.label)
          )
        )
      );
      tooltip.hidden = false;
      // La bulle passe de l'autre côté du réticule sur la moitié droite, sans
      // jamais sortir du cadre : sur un écran étroit, elle déborderait.
      const tipWidth = tooltip.offsetWidth;
      const side = left > width / 2 ? left - 12 - tipWidth : left + 12;
      tooltip.style.left = `${Math.max(0, Math.min(width - tipWidth, side))}px`;
      tooltip.style.top = `${margin.top}px`;
    }
    function hide() {
      cross.setAttribute("visibility", "hidden");
      for (const dot of dots) dot.setAttribute("visibility", "hidden");
      tooltip.hidden = true;
    }
    const nearest = (clientX) => {
      const box = svg.getBoundingClientRect();
      const ratio = (clientX - box.left - margin.left) / plotWidth;
      return Math.min(times.length - 1, Math.max(0, Math.round(ratio * (times.length - 1))));
    };
    let current = null;

    const next = s(
      "svg",
      {
        class: "chart-svg",
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
        role: "img",
        tabindex: 0,
        "aria-label": `Courbe de ${series.map((entry) => entry.label).join(", ")}`,
      },
      grid,
      dates,
      lines,
      endLabels,
      cross,
      dots
    );
    const follow = (event) => {
      current = nearest(event.clientX);
      show(current);
    };
    next.addEventListener("pointerdown", follow);
    next.addEventListener("pointermove", follow);
    // Au doigt, la bulle reste après le toucher : on la lit une fois le doigt levé.
    next.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse") hide();
    });
    next.addEventListener("blur", hide);
    // Au clavier : les flèches promènent le réticule.
    next.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const shift = event.key === "ArrowLeft" ? -1 : 1;
      current = Math.min(times.length - 1, Math.max(0, (current ?? times.length - 1) + shift));
      show(current);
    });
    if (svg) svg.replaceWith(next);
    else frame.prepend(next);
    svg = next;
  }

  frame.append(tooltip);
  // Redessiné à chaque changement de largeur, et au premier affichage : avant,
  // le cadre n'a pas encore de taille.
  const observer = new ResizeObserver(() => {
    // Hors de la page, rien à mesurer ; retiré de la page, le cadre part avec
    // son observateur.
    if (!frame.isConnected) return;
    if (frame.clientWidth !== width) draw();
  });
  observer.observe(frame);
  return frame;
}
