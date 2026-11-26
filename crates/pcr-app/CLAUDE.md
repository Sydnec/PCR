# pcr-app — cas d'usage

- `App` (clonable) porte `Db`, `Clock`, `Instance`, `Health` et la config de jeu ; c'est l'état partagé par
  Discord et le site. Lire la config par `app.game_config()` (copie cohérente), la modifier par `config::set`.
- Un cas d'usage = une fonction qui ouvre **une** transaction, applique les règles de `pcr-core`, et renvoie
  `(Outcome, Vec<Event>)` ; l'appelant publie les événements après le commit.
- Jamais d'appel Discord ou HTTP pendant une transaction. Les besoins Discord (MP, messages publics,
  membres) passent par des traits (« ports ») implémentés dans `pcr-discord`.
- Tâches de calendrier : `jobs::all()`, échéance `pcr_core::schedule::Schedule` (quotidienne ou annuelle,
  heure de Paris, jamais entre 2 h et 3 h) revendiquée dans `job_runs` : une fois par période, rattrapée au
  démarrage tant que la période dure. Pas de `croner` : il tire chrono, écarté du projet. Les balayages
  (fuites, rappels échus…) sont des boucles idempotentes par l'état en base, hors `jobs`.
- Les stats sont mises en tampon et écrites par lots (~15 s) dans la base de l'année.
