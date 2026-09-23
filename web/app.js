// Le site PokéPCR : une page, quatre vues, et l'API du bot derrière.
//
// Aucune règle de jeu ici : le site affiche ce que l'API renvoie et lui confie
// chaque action. Ce qu'elle refuse revient avec un message déjà rédigé pour le
// joueur, qu'on affiche tel quel. Tout ce qui se fait ici reste faisable sur
// Discord avec /pk.
import { api, avatarUrl, emoji, errorBox, fmt, h } from "./lib.js";
import * as boite from "./views/boite.js";
import * as pokedex from "./views/pokedex.js";
import * as sac from "./views/sac.js";
import * as oeuf from "./views/oeuf.js";

const ROUTES = { "/": boite, "/boite": boite, "/pokedex": pokedex, "/sac": sac, "/oeuf": oeuf };

// Les raisons qu'un échec de connexion laisse dans l'adresse (?connexion=…).
const LOGIN_ERRORS = {
  expiree: "La connexion a expiré, recommence.",
  refusee: "Connexion annulée sur Discord.",
  discord: "Discord n'a pas confirmé la connexion, réessaie.",
  membre: "Le site est réservé aux membres du serveur Discord.",
};

const app = document.getElementById("app");

// Ce que toutes les vues partagent : le dresseur connecté, et les données
// fixes du jeu (espèces, balls), chargées une fois.
const ctx = {
  me: null,
  species: new Map(),
  balls: new Map(),
  refreshMe,
  navigate,
};

async function refreshMe() {
  try {
    ctx.me = await api("/api/me");
  } catch (error) {
    if (error.status !== 401) throw error;
    ctx.me = null;
  }
  renderAccount();
}

function navigate(path) {
  history.pushState(null, "", path);
  render();
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  ctx.me = null;
  renderAccount();
  navigate("/");
}

function renderAccount() {
  const account = document.getElementById("account");
  document.getElementById("nav").hidden = !ctx.me;
  if (!ctx.me) return account.replaceChildren();
  const { user, balance, balls } = ctx.me;
  account.replaceChildren(
    h("span", { class: "chip", title: "Ton solde" }, `${fmt(balance)} pts`),
    ...balls.map((ball) =>
      h(
        "span",
        { class: "chip chip-ball", title: ball.label },
        emoji(ball.emoji, ball.label),
        fmt(ball.count)
      )
    ),
    h("img", { class: "avatar", src: avatarUrl(user), alt: "", width: 32, height: 32 }),
    h("span", { class: "username" }, user.username),
    h("button", { class: "button ghost", onclick: logout }, "Déconnexion")
  );
}

function loginView() {
  const params = new URLSearchParams(location.search);
  const reason = LOGIN_ERRORS[params.get("connexion")];
  // L'erreur a été lue : on la retire de l'adresse, pour qu'un rechargement ne
  // la répète pas.
  if (params.has("connexion")) history.replaceState(null, "", location.pathname);
  const back = location.pathname === "/" ? "/boite" : location.pathname;
  return h(
    "section",
    { class: "hero" },
    h("img", { class: "hero-ball", src: "/favicon.svg", alt: "" }),
    h("h1", {}, "Le PC des dresseurs de PCR"),
    h(
      "p",
      { class: "muted" },
      "Ta boîte, ton Pokédex, ton sac et ton œuf, depuis le navigateur. Tout reste faisable sur Discord avec /pk."
    ),
    reason ? h("p", { class: "notice error" }, reason) : null,
    h(
      "a",
      { class: "button primary big", href: `/api/auth/login?back=${encodeURIComponent(back)}` },
      "Se connecter avec Discord"
    )
  );
}

function highlightNav() {
  const current = location.pathname === "/" ? "/boite" : location.pathname;
  for (const link of document.querySelectorAll("#nav a")) {
    link.classList.toggle("active", link.getAttribute("href") === current);
  }
}

// Un rendu lent ne doit pas écraser celui d'une page ouverte entre-temps.
let renderId = 0;

async function render() {
  const id = ++renderId;
  highlightNav();
  if (!ctx.me) return app.replaceChildren(loginView());
  const view = ROUTES[location.pathname];
  if (!view) {
    return app.replaceChildren(
      h(
        "section",
        { class: "empty" },
        h("h1", {}, "Page introuvable"),
        h("a", { href: "/boite", "data-link": true }, "Retour à la boîte")
      )
    );
  }
  app.replaceChildren(h("p", { class: "loading" }, "Chargement…"));
  try {
    const content = await view.render(ctx);
    if (id === renderId) app.replaceChildren(content);
  } catch (error) {
    if (id !== renderId) return;
    if (error.status === 401) {
      ctx.me = null;
      renderAccount();
      return render();
    }
    app.replaceChildren(errorBox(error));
  }
}

// Les liens internes changent de vue sans recharger la page. Un clic du milieu
// ou avec Ctrl garde son sens : ouvrir un onglet.
document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-link]");
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  navigate(link.getAttribute("href"));
});
window.addEventListener("popstate", render);

async function boot() {
  const [, species, catalogue] = await Promise.all([
    refreshMe(),
    api("/api/species"),
    api("/api/catalogue"),
  ]);
  for (const entry of species.species) ctx.species.set(entry.id, entry);
  for (const ball of catalogue.balls) ctx.balls.set(ball.key, ball);
  await render();
}

boot().catch((error) => {
  app.replaceChildren(errorBox(new Error(`Le site ne répond pas : ${error.message}`)));
});
