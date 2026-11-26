# 0006 — jiff et l'heure de Paris

**Décision.** Toutes les dates passent par `jiff` (base des fuseaux embarquée dans le binaire) et
`pcr_core::clock::Clock`. Un jour de jeu est un jour calendaire à Paris.

**Pourquoi.**
- `chrono` est déclaré non maintenu (RUSTSEC-2026-0543), relevé par `cargo deny` en P0.
- La v1 mélangeait jours UTC (gains, loterie, boutique) et heure locale (anniversaires) : minuit à Paris
  pour tout le monde est plus lisible pour les joueurs (changement annoncé à la bascule).
- La base de fuseaux embarquée rend les calculs identiques quel que soit l'hôte (CI, VM).
- `clippy.toml` interdit toute lecture directe de l'horloge : les tests figent le temps.

**Conséquence.** Aucun job planifié entre 02 h et 03 h (heure sautée ou doublée aux changements d'heure).
