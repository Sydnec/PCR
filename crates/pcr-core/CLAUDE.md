# pcr-core — règles pures

- Aucune I/O, aucun async, aucune dépendance aux autres crates du projet. Tout se teste sans base.
- Temps : `clock::Clock` (`now`, `today` = date de Paris). `SystemClock` est le seul à lire l'horloge
  (clippy l'impose) ; `FixedClock` pour les tests.
- Hasard : un `rand::Rng` passé en paramètre, jamais tiré en interne (tests à graine fixe).
- `instance` : config non secrète d'une instance (IDs Discord, URL, écoute), lue depuis `instance.toml`.
- `config` : `GameConfig`, déclarée par `section!` (clé v1, type, défaut v1) ; `v1_defaults.json` (écrit par la
  v1) prouve l'égalité des défauts. `edit` : chemins, conversion de saisie (textes v1), surcharges ;
  `bounds` : bornes v1 ; `render` : affichage v1. Un réglage ajouté se déclare dans sa section (s'il est propre à la v2, l'exclure du test d'égalité v1).
- `refusal::Refusal` : le texte d'un refus montré à un membre.
- `format` : nombres à la française (U+202F). `points` (gain d'un message, délai de `/solde`),
  `redistribution` (pot commun), `stats` (mots et emoji d'un message, découpés comme en v1), `bets`
  (`custom_id` des paris, gains au quotient exact, plus proche estimation, saisies, refus).
- `ids` : codec `custom_id`, grammaire v1 `action|arg|…` ; chaque fonctionnalité y décode les siens.
- Communauté : `reminders` (date en heure de Paris, bouton `rappel|`, `encodeURIComponent`), `birthdays`,
  `polls` (numérotation des lignes, période de `/week`), `cotd` (nominis, page des fêtes, message),
  `advent` (les 24 questions), `ecaflip`, `randomizabaise`. Valeurs de référence des tests v1.
- À venir : un module par fonctionnalité (`lottery`, `safari`…).
- Données Pokémon : `data/pokemon.json` (251 espèces : `id`, `name` FR, `generation`, `catchRate`, `stage`,
  `isLegendary`, `isMythical`, `isBaby`, `genderRate`, `evolvesFrom/Into`, `sprite`, `forms`) et
  `data/fishing.json` (`rods.{old,good,super}` = paires `[speciesId, poids]`) : converties en tableaux
  statiques par `build.rs` (P4). Ne pas lire ces fichiers en entier : la forme ci-dessus suffit.
- Tests : valeurs de référence reprises des tests v1 (`git show origin/main:test/<fichier>`).
