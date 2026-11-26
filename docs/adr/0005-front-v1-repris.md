# 0005 — Reprise du front v1, typé contre l'API

**Décision.** Le site v1 (JS sans étape de build) est repris et embarqué dans le binaire. Deux
adaptations : les mises à jour en direct passent par SSE (polling conservé en secours), et le JS est
vérifié par `tsc --noEmit` (JSDoc) contre des types générés depuis Rust avec `ts-rs`.

**Pourquoi.**
- Aucun framework à l'exécution : la page la plus légère possible.
- Même rendu pour les joueurs, sans dépenser du temps (et des tokens) à réécrire 6 000 lignes à l'identique.
- Le contrat front/API devient vérifié en CI : un champ renommé côté Rust casse le typecheck.
- L'API garde les formes JSON v1 : un script compare les réponses v1 et v2 sur la même base.

**Conséquence.** Une réécriture (Svelte…) reste possible après la bascule, sans être planifiée.
