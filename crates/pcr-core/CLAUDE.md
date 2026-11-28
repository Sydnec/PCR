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
- Administration et salon : `links` (réécriture vers les miroirs, `links::translation` : bouton
  « Traduire », noms de langues, échappement), `purge` (lien de message, âge d'un identifiant, bilan),
  `roles` (libre-service, message des rôles, couleur), `threads` (liste des fils).
- À venir : un module par fonctionnalité (`lottery`, `safari`…).
- Données Pokémon : `data/pokemon.json` (251 espèces : `id`, `name` FR, `slug`, `generation`, `catchRate`,
  `stage`, `isLegendary`, `isMythical`, `isBaby`, `genderRate`, `tradeEvolution`, `types`,
  `evolvesFrom/Into`, `sprite`, `forms`) et `data/fishing.json` (`rods.{old,good,super}` = paires
  `[speciesId, poids]`) : converties en tableaux statiques par `build.rs`, qui refuse une donnée mal formée.
  Ne pas lire ces fichiers en entier : la forme ci-dessus suffit.
- `pokemon` : `species` (lecture brute `get`, jouable `available`/`all(génération)`, sexe, formes,
  images), `generation::active` (à calculer une fois par action et à passer aux règles), `rarity`,
  `lineage`, `weights::Draw` (poids d'apparition, tirage `pick_at(roll)`, 🔒/🥚), `capture` (formule,
  plancher, difficulté, prix de la Master Ball, shiny), `items` (catalogue, tables `Held`/`Lottery`),
  `fishing`, `tables` (`/admin poids`, mêmes fonctions que les tirages). Un tirage prend un `roll` dans
  [0, 1) ou un RNG : les tests figent le premier, comme `withRandom` en v1.
- `pokemon::spawn` : revendication (`claims`, par message, capture ou administrateur), échéance de fuite,
  tirage d'une apparition (`roll`, `Forced`), mention du rôle, boutons du message public (`Button` :
  `poke_throw`, `poke_special`, `poke_owned`) et textes de refus. `pokemon::display` : nom d'un individu
  (shiny, forme, sexe), couleur, numéro de Pokédex, chance en pourcentage. `species::search` : recherche
  par nom sans accents (autocomplétion).
- `pokemon::throw` : la ball lancée (`ball`, boutique comprise, ouverte par génération) et sa chance
  contre une apparition (bonus compris), le délai entre deux lancers, les issues (`Outcome`, textes
  v1, `is_final`) et les boutons des panneaux (`Button` : `poke_rethrow`, `poke_master_ok`…,
  `Promise`). `pokemon::charms` : espèces requises, charmes mérités, charmes portés, annonce.
- `pokemon::drop` : tirage du lâcher, bouton `poke_drop`, refus du ramassage. `pokemon::bag` : ce que
  devient un gain au-delà de `maxHeld` (`Overflow`, `Granted`, `upgrade`, phrase v1) et les refus de
  `/admin item`.
- Tests : valeurs de référence reprises des tests v1 (`git show origin/main:test/<fichier>`).
