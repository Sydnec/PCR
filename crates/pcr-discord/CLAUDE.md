# pcr-discord — adaptateur Discord (twilight)

- `lib.rs` : connexion, enregistrement des commandes de guilde (réessaie si Discord est indisponible,
  sans jamais arrêter le site), boucle d'événements. Chaque interaction tourne dans sa propre tâche.
- `interactions.rs` route commandes et composants ; tout `custom_id` inconnu répond « panneau expiré ».
- `ui.rs` : `ephemeral_panel` (composants v2, éphémère), `update_panel` (même message), `ephemeral_text`.
  Builders : `twilight_util::builder::message::*` et `builder::interaction_response::*`.
- Commandes : `commands/<nom>.rs` avec `#[derive(CommandModel, CreateCommand)]`, déclarées dans `commands::all()`.
- Jeu Pokémon (P4) : `pokemon/<panneau>.rs`, préfixe `pk:` ; les messages publics gardent leurs préfixes v1.
- Un handler décode, appelle `pcr-app`, rend le résultat. Pas de règle de jeu ici.
- Délai de 3 s : un handler lent renvoie `Reply::later(éphémère, travail)` (commande, bouton, modale) ou
  `Reply::later_update` (un menu, remplacé par le résultat) ; le routeur diffère puis remplace la réponse
  (texte ou panneau v2, sans notifier personne ; `Edit::Panels` quand un message ne suffit pas : les
  suivants partent en suites, même visibilité). Une modale ne se diffère pas : le clic qui l'ouvre lit
  vite et répond `Now`. `Reply::Posted` : réponse publique immédiate qui devient un message public (un
  rôle n'est appelé que dans une réponse immédiate). Images dans `spawn_blocking`.
- Paris : `bets/` (routage `bet_*` des composants et modales, `forms`, `render` des messages publics),
  commandes `bet`, `estimate`, `betstats`.
- Communauté : `reminders.rs` (bouton `rappel|`, panneaux), `polls.rs` (numérotation : `THREAD_CREATE` du
  forum des sondages, `/week`, `/edit`), `outbox.rs` (le port `Outbox` : salons, fils de l'Avent, MP des
  rappels). Les tâches de calendrier et le balayage des rappels sont lancés dans `lib.rs`, avec la
  connexion. Un texte de membre relayé n'appelle que membres et rôles (`ui::relayed`), jamais `@everyone`.
- Salon : `links.rs` (copie des liens, bouton `tweet_translate|`), `roles.rs` (message des rôles, réactions,
  rôles du serveur), `arrivals.rs` (rôle d'arrivée, cache des invitations), `threads.rs` (liste des fils,
  `delete` par lots), `reactions.rs`, `voice.rs`. Commandes `/admin purge`, `purge-membre` (tâche de fond,
  `purge_member/scan.rs`), `restart`, `/color`, `/help`, `/admin poids`.
- Intents : seulement ceux qu'une fonctionnalité utilise. Contenu des messages (privilégié) : stats de
  mots et liens ; membres (privilégié, « Server Members ») : arrivées, et la liste par l'API
  (`members.rs`) ; réactions, vocal, invitations.
- `messages.rs` : chaque message d'un membre (pas d'un bot, MP compris) → `pcr_app::points::on_message`.
- `announce.rs` : au premier READY, annonce de version (prod) ou aperçu des fragments en attente (dev).
- `public_messages.rs` : le port d'écriture des messages publics. Un type de message = un rendu dans
  `renderer()`, qui relit la base au moment d'écrire et désigne les rôles qu'il peut appeler (`Rendered`) :
  toute autre mention reste muette ; codes Discord « disparu » repris de la v1.
