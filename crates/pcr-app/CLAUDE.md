# pcr-app — cas d'usage

- `App` (clonable) porte `Db`, `Clock`, `Instance`, `Health` ; c'est l'état partagé par Discord et le site.
- Un cas d'usage = une fonction qui ouvre **une** transaction, applique les règles de `pcr-core`, et renvoie
  `(Outcome, Vec<Event>)` ; l'appelant publie les événements après le commit.
- Jamais d'appel Discord ou HTTP pendant une transaction. Les besoins Discord (MP, messages publics,
  membres) passent par des traits (« ports ») implémentés dans `pcr-discord`.
- Jobs planifiés (P2) : `croner` en heure de Paris + table `job_runs(job, period_key)` pour rattraper
  une échéance manquée et ne jamais l'exécuter deux fois. Aucun job entre 02 h et 03 h (changements d'heure).
- Les stats sont mises en tampon et écrites par lots (~15 s) dans la base de l'année.
