# 0007 — Panneaux Pokémon à la place de `/pk`

**Décision.** Le jeu se joue depuis un **Centre Pokémon** (message permanent du salon Pokémon), `/pokemon`
(« Mon aventure »), `/pokedex` et des commandes de clic droit sur un membre (Pokédex, Vitrine, Comparer,
Échanger). On agit depuis la fiche de ce qu'on voit. Les règles du jeu ne changent pas.

**Pourquoi.**
- `/pk` comptait 21 sous-commandes et 3 groupes : il fallait connaître la commande pour l'utiliser.
- Agir sur un Pokémon demandait de taper l'espèce puis le numéro d'individu.
- Chaque action était un aller-retour isolé, sans lien vers la suite (voir un doublon ≠ pouvoir le revendre).

**Conséquence.** La parité se vérifie par action, pas par commande (`docs/parity.md`, section 2). Les
messages publics (spawn, échange, objet au sol, safari) gardent leurs `custom_id` v1.
