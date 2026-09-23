// Le site PokéPCR : une page, une vue par onglet, et l'API du bot derrière.
//
// Aucune règle de jeu ici : le site affiche ce que l'API renvoie et lui confie
// chaque action. Ce qu'elle refuse revient avec un message déjà rédigé pour le
// joueur, qu'on affiche tel quel. Tout ce qui se fait ici reste faisable sur
// Discord avec /pk.
import { api, avatarUrl, errorBox, fmt, h, itemIcon, registerItemImages } from "./lib.js";
import * as capture from "./views/capture.js";
import * as safari from "./views/safari.js";
import * as boite from "./views/boite.js";
import * as pokedex from "./views/pokedex.js";
import * as sac from "./views/sac.js";
import * as oeuf from "./views/oeuf.js";
import * as admin from "./views/admin.js";

// L'accueil est la capture : c'est là que le jeu se passe en direct. Le parc
// safari s'ouvre depuis elle, sans onglet à lui.
const ROUTES = {
  "/": capture,
  "/capture": capture,
  "/safari": safari,
  "/boite": boite,
  "/pokedex": pokedex,
  "/sac": sac,
  "/oeuf": oeuf,
  "/admin": admin,
};

// Les raisons qu'un échec de connexion laisse dans l'adresse (?connexion=…).
const LOGIN_ERRORS = {
  expiree: "La connexion a expiré, recommence.",
  refusee: "Connexion annulée sur Discord.",
  discord: "Discord n'a pas confirmé la connexion, réessaie.",
  membre: "Le site est réservé aux membres du serveur Discord.",
  role: "Ton compte Discord n'a pas le rôle du serveur qui donne accès au site.",
};

const app = document.getElementById("app");

// Ce que toutes les vues partagent : le dresseur connecté, et les données
// fixes du jeu (espèces, balls), chargées une fois.
const ctx = {
  me: null,
  species: new Map(),
  balls: new Map(),
  // Couleur de chaque type, celle des embeds Discord.
  types: {},
  refreshMe,
  setWallet,
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

// Le solde et les balls relus par une page (la Capture les reçoit avec chaque
// apparition) : l'en-tête suit sans relire /api/me.
function setWallet({ balance, balls }) {
  if (!ctx.me) return;
  if (ctx.me.balance === balance && JSON.stringify(ctx.me.balls) === JSON.stringify(balls)) return;
  ctx.me = { ...ctx.me, balance, balls };
  renderAccount();
}

// Changer de page relit aussi le solde, sans attendre : des points gagnés sur
// Discord entre-temps apparaissent dans l'en-tête.
function navigate(path) {
  history.pushState(null, "", path);
  refreshMe().catch(() => {});
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
  // Le lien n'est qu'un confort : l'API refuse l'administration à tout autre.
  document.getElementById("nav-admin").hidden = !ctx.me?.user.admin;
  if (!ctx.me) return account.replaceChildren();
  const { user, balance, balls } = ctx.me;
  account.replaceChildren(
    h("span", { class: "chip", title: "Ton solde" }, `${fmt(balance)} pts`),
    ...balls.map((ball) =>
      h("span", { class: "chip chip-ball", title: ball.label }, itemIcon(ball), fmt(ball.count))
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
  const back = location.pathname === "/" ? "/capture" : location.pathname;
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

// L'onglet allumé : celui de la page, ou celui d'où elle s'ouvre.
const NAV_PARENTS = { "/": "/capture", "/safari": "/capture" };

function highlightNav() {
  const current = NAV_PARENTS[location.pathname] ?? location.pathname;
  for (const link of document.querySelectorAll("#nav a")) {
    link.classList.toggle("active", link.getAttribute("href") === current);
  }
}

// Un rendu lent ne doit pas écraser celui d'une page ouverte entre-temps.
let renderId = 0;

// Ce qu'une page doit arrêter en la quittant (la capture relit l'apparition à
// intervalle régulier). Chaque rendu reçoit son propre `onLeave` ; ctx reste son
// prototype, donc `ctx.me` y est toujours à jour.
let leaving = [];
const leave = (callbacks) => callbacks.splice(0).forEach((callback) => callback());

async function render() {
  const id = ++renderId;
  leave(leaving);
  const callbacks = [];
  leaving = callbacks;
  const viewCtx = Object.create(ctx);
  viewCtx.onLeave = (callback) => callbacks.push(callback);
  highlightNav();
  if (!ctx.me) return app.replaceChildren(loginView());
  const view = ROUTES[location.pathname];
  if (!view) {
    return app.replaceChildren(
      h(
        "section",
        { class: "empty" },
        h("h1", {}, "Page introuvable"),
        h("a", { href: "/capture", "data-link": true }, "Retour à l'accueil")
      )
    );
  }
  app.replaceChildren(h("p", { class: "loading" }, "Chargement…"));
  try {
    const content = await view.render(viewCtx);
    if (id === renderId) app.replaceChildren(content);
    // Une autre page s'est ouverte pendant ce rendu : il n'est pas affiché, et
    // ce qu'il a lancé s'arrête aussitôt.
    else leave(callbacks);
  } catch (error) {
    leave(callbacks);
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

// Une requête a répondu 401 alors qu'on se croyait connecté : la session a
// expiré, ou le rôle qui donne accès au site a été retiré.
window.addEventListener("session-perdue", () => {
  if (!ctx.me) return;
  ctx.me = null;
  renderAccount();
  render();
});

async function boot() {
  const [, species, catalogue] = await Promise.all([
    refreshMe(),
    api("/api/species"),
    api("/api/catalogue"),
  ]);
  for (const entry of species.species) ctx.species.set(entry.id, entry);
  for (const ball of catalogue.balls) ctx.balls.set(ball.key, ball);
  ctx.types = catalogue.types ?? {};
  // Les messages du jeu citent les objets par leur emoji : le site montre leur
  // image à la place.
  registerItemImages([...catalogue.balls, ...catalogue.items]);
  await render();
}

boot().catch((error) => {
  app.replaceChildren(errorBox(new Error(`Le site ne répond pas : ${error.message}`)));
});
