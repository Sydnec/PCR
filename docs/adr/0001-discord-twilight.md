# 0001 — Discord : twilight

**Décision.** twilight 0.18 (gateway, http, model, cache en mémoire restreint) et `twilight-interactions`
pour déclarer les commandes.

**Pourquoi.**
- La quasi-totalité des interactions passe par nos propres `custom_id` et des éditions de messages :
  un framework de commandes (poise) n'apporte que la déclaration des slash commands.
- Cache limité à ce qui sert (membres, rôles, salons, invitations, vocal) : mémoire maîtrisée.
- serenity prépare une réécriture majeure ; twilight est stable et modulaire.
- Composants v2, modals avec menus et commandes de clic droit sont dans `twilight-model` 0.18 (vérifié en P0).

**Conséquence.** Plus de code explicite pour répondre : compensé par les aides de `pcr-discord/src/ui.rs`.
