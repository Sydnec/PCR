# pcr-discord — adaptateur Discord (twilight)

- `lib.rs` : connexion, enregistrement des commandes de guilde (réessaie si Discord est indisponible,
  sans jamais arrêter le site), boucle d'événements. Chaque interaction tourne dans sa propre tâche.
- `interactions.rs` route commandes et composants ; tout `custom_id` inconnu répond « panneau expiré ».
- `ui.rs` : `ephemeral_panel` (composants v2, éphémère), `update_panel` (même message), `ephemeral_text`.
  Builders : `twilight_util::builder::message::*` et `builder::interaction_response::*`.
- Commandes : `commands/<nom>.rs` avec `#[derive(CommandModel, CreateCommand)]`, déclarées dans `commands::all()`.
- Jeu Pokémon (P4) : `pokemon/<panneau>.rs`, préfixe `pk:` ; les messages publics gardent leurs préfixes v1.
- Un handler décode, appelle `pcr-app`, rend le résultat. Pas de règle de jeu ici.
- Délai de 3 s : différer (`defer`) avant tout travail lent ; images dans `spawn_blocking`.
- Intents : seulement ceux qu'une fonctionnalité utilise (membres et contenu des messages sont privilégiés).
- `announce.rs` : au premier READY, annonce de version (prod) ou aperçu des fragments en attente (dev).
