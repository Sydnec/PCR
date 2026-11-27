# pcr-app — cas d'usage

- `App` (clonable) porte `Db`, `Clock`, `Instance`, `Health` et la config de jeu ; c'est l'état partagé par
  Discord et le site. Lire la config par `app.game_config()` (copie cohérente), la modifier par `config::set`.
- Un cas d'usage = une fonction qui ouvre **une** transaction, applique les règles de `pcr-core`, et renvoie
  `(Outcome, Vec<Event>)` ; l'appelant publie les événements après le commit.
- Jamais d'appel Discord ou HTTP pendant une transaction. Les besoins Discord (MP, messages publics,
  membres) passent par des traits (« ports ») implémentés dans `pcr-discord`.
- Tâches de calendrier : `jobs::all()`, échéance `pcr_core::schedule::Schedule` (quotidienne ou annuelle,
  heure de Paris, jamais entre 2 h et 3 h) revendiquée dans `job_runs` : une fois par période, rattrapée au
  démarrage tant que la période dure. L'échéance se relit à chaque tour (`Job::schedule(&App)`, `None` :
  coupée) ; `run` reçoit les `outbox::Ports` (Discord, web). La boucle est lancée par `pcr-discord`. Pas
  de `croner` : il tire chrono, écarté du projet. Les balayages (fuites, rappels échus…) sont des boucles
  idempotentes par l'état en base, hors `jobs`.
- Stats : `app.stats.add(instant, Counter, delta)` (compteurs de `pcr_db::stats`), écrites par lots toutes les
  15 s et à l'arrêt dans `stats-<année de Paris de l'instant>.db` : la bascule du 1er janvier n'a besoin de
  rien d'autre. Un nouveau compteur s'ajoute à `pcr_db::stats::Counter` avec son upsert.
- Messages publics : dans la transaction du cas d'usage, `pcr_db::public_messages::create` / `touch` ; après
  le commit, `app.public_messages_changed()`. Le worker (`public_messages::run`, lancé par `pcr-discord`)
  écrit un message à la fois, rattrape au démarrage puis toutes les 5 min (grâce et fenêtre de GameConfig).
  Quand la réponse d'interaction est le message (un pari), sa ligne naît après elle, avec son `message_id`
  (`public_messages::posted`, `bets::posted`).
- Hasard : les cas d'usage reçoivent `rng: &mut impl Rng` ; en service `App::rng()`, en test une graine fixe.
- Membres d'un rôle : port `members::MembersPort` (liste complète lue sur Discord), tri pur `role_members`.
- Ce que les tâches de fond envoient : port `outbox::Outbox` (salon, fil, MP d'un rappel, pseudo) ; une
  erreur est une panne passagère, un membre injoignable se dit (`Delivery::Unreachable`). Pages web :
  `outbox::Web`, servi par `http::Http` (la pile hyper + rustls de twilight, aucune crate de plus).
- Communauté : `reminders` (balayage chaque minute, `run`), `birthdays`, `cotd`, `advent` (tâches de
  calendrier), `randomizabaise`. Salon : `links` (boutons et traduction, sur `outbox::Web`), `voice` et
  `reactions` (stats de l'année), `App::request_restart` (`/admin restart` : `main` s'arrête proprement).
  Refus : `error::UseCaseError`. Faux ports : `testing::FakeOutbox`, `FakeWeb`.
- Pokémon : `pokemon` (`generation`, la génération jouable à l'horloge de l'`App` ; `weight_tables`).
- Points : `points` (gain d'un message, `/solde`, classement, `/admin points`), `redistribution` (pot
  commun : boucle horaire `run`, lancée par `pcr-discord`). Paris : `bets` (création, `stake`, `resolve`…,
  `View` et `gains` partagés par le paiement et les rendus ; les stats comptent après le commit).
- Un compteur « record » (`Counter::combine`, ex. `BetMaxWin`) garde le maximum au lieu d'additionner, dans
  le tampon comme en base. `Stats::bet_stats` vide le tampon avant de lire l'année en cours.
- Tests : `testing::TestApp` (base jetable, horloge figée, `sql` pour provoquer une panne).
