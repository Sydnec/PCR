# PCR 2.0 — consignes du projet

## Carte
- `crates/pcr-core` : règles pures (formules, refus, GameConfig, Clock, codec `custom_id`). Ni I/O ni async.
- `crates/pcr-db` : SQLite (sqlx). Requêtes `sqlx::query!` vérifiées à la compilation contre `migrations/`.
- `crates/pcr-app` : cas d'usage partagés Discord + site, jobs, événements.
- `crates/pcr-discord` : gateway twilight, commandes, panneaux. `crates/pcr-web` : axum, API, SSE, front.
- `crates/pcr` : binaire. `xtask/` : automatisation. `deploy/` : VM et systemd. `data/` : données statiques.
- Une fonctionnalité porte le **même nom de module dans chaque crate** (`lottery`, `bets`…) : `rg` la retrouve.
- Chaque crate a son `CLAUDE.md` court ; `docs/architecture.md` et `docs/adr/` expliquent les choix.

## Spécification
- Comportement attendu : `docs/` (pages joueurs) et `docs/parity.md` (checklist v1 → v2, à cocher).
- Code v1 : `git show origin/main:<chemin>` (tag `v1-final` après la bascule). Ne jamais le recopier dans l'arbre.
- Textes joueurs : repris **mot pour mot** de la v1, regroupés par fonctionnalité.

## Vérifier
- `cargo xtask check` : fmt, clippy `-D warnings`, tests (et typecheck du site). N'affiche que les échecs.
- `cargo fmt --all` corrige le formatage (un hook le fait déjà après chaque édition de `.rs`).

## Règles de code
- Commentaires en français qui disent **pourquoi** (décision, piège, règle de jeu), jamais une paraphrase.
- **Aucun nombre en dur** : prix, taux, durées vivent dans GameConfig ; ce qui s'affiche se calcule avec les
  mêmes fonctions que ce qui se tire.
- **Pas d'état de jeu en mémoire** : tout vit en base, les boutons marchent après un redémarrage. Seuls les
  caches (membres, config, sprites) et les anti-spam restent en mémoire.
- Une opération en plusieurs étapes tient dans **une transaction** ; jamais d'`await` Discord ou HTTP pendant
  qu'elle est ouverte. Les événements se publient **après** le commit.
- Le temps se lit via `pcr_core::clock::Clock` (jour = jour de Paris) ; le hasard via un RNG injecté.
- Erreurs : `thiserror` dans les crates, `anyhow` dans le binaire. Refus joueur = type `Refusal` avec son texte.
- Fichiers ≤ ~400 lignes, doc de module en tête.

## Discord
- Jeu Pokémon : un panneau = un module (`pcr-discord/src/pokemon/`). Seules `/pokemon`, `/pokedex` et `/zarbi`
  sont des commandes. Toute action du site a son bouton côté Discord, sauf le rangement du PC.
- `custom_id` : grammaire `action|arg|…` ; les préfixes v1 des messages publics restent décodables.
- Refus et réponses personnelles en éphémère, avec les chiffres (« tu en as 1, il en faut 2 »), au tutoiement.
- Emoji serveur et mentions jamais dans un titre. Nombres au format français.
- Lecture ratée : omettre l'information plutôt qu'afficher une valeur fausse.

## Tests (uniquement les nécessaires)
- Tables de valeurs de référence pour les formules, un test par refus, un test d'atomicité par cas d'usage
  multi-étapes (panne provoquée), autorisations du site. Pas de mock Discord, pas de snapshot d'embed.

## Livraison
- Branche de travail → PR vers `dev` (bot de dev). `dev` → `main` (prod) seulement quand le mainteneur dit
  **« là, on release »**. Ne pousse et n'ouvre de PR que sur demande.
- Chaque changement visible ajoute `changelog/unreleased/<slug>.toml` (`type`, `name`, `description` joueur,
  `announce`) ; `cargo xtask release` (P2) les replie et monte la version. Ne jamais toucher la version à la main.
- Mettre à jour la page `docs/` concernée quand le comportement visible change.
