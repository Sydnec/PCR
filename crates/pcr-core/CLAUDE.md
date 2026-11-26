# pcr-core — règles pures

- Aucune I/O, aucun async, aucune dépendance aux autres crates du projet. Tout se teste sans base.
- Temps : `clock::Clock` (`now`, `today` = date de Paris). `SystemClock` est le seul à lire l'horloge
  (clippy l'impose) ; `FixedClock` pour les tests.
- Hasard : un `rand::Rng` passé en paramètre, jamais tiré en interne (tests à graine fixe).
- `instance` : config non secrète d'une instance (IDs Discord, URL, écoute), lue depuis `instance.toml`.
- À venir : `config` (GameConfig : macro clé/type/défaut/bornes/libellé), `refusal` (textes FR des refus),
  `ids` (codec `custom_id`, grammaire v1), un module par fonctionnalité (`lottery`, `safari`…).
- Données Pokémon : `data/pokemon.json` (251 espèces : `id`, `name` FR, `generation`, `catchRate`, `stage`,
  `isLegendary`, `isMythical`, `isBaby`, `genderRate`, `evolvesFrom/Into`, `sprite`, `forms`) et
  `data/fishing.json` (`rods.{old,good,super}` = paires `[speciesId, poids]`) : converties en tableaux
  statiques par `build.rs` (P4). Ne pas lire ces fichiers en entier : la forme ci-dessus suffit.
- Tests : valeurs de référence reprises des tests v1 (`git show origin/main:test/<fichier>`).
