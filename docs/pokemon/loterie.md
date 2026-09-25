[← Pokémon](README.md)

# 🎰 Loterie

`/pk loterie` offre **un tirage par dresseur et par jour**. Sept fois sur dix il donne quelque
chose, et **un gain sur deux est une ou deux Poké Balls, ou une Super Ball** : le tirage doit se
sentir généreux sans l'être, d'où beaucoup de petits lots et très peu de gros.

**La quantité décroît géométriquement** : chaque exemplaire de plus est deux fois moins probable
que le précédent (`lotDecay`). Le tirage était uniforme à l'origine, et c'était son défaut — cinq
Poké Balls tombaient aussi souvent qu'une seule, si bien que le gros lot n'avait rien
d'exceptionnel. À `lotDecay: 1` on retrouve exactement l'ancien comportement.

| Résultat | Proba | Un jour sur |
|---|---|---|
| **Rien** | 30,00 % | 3 |
| 1× Poké Ball | 17,91 % | 6 |
| 1× Super Ball | 10,22 % | 10 |
| 2× Poké Ball | 8,96 % | 11 |
| 2× Super Ball | 5,11 % | 20 |
| 🔮 Évolyte | 4,88 % | 20 |
| 3× Poké Ball | 4,48 % | 22 |
| 🍬 1× Super Bonbon | 4,34 % | 23 |
| 1× Hyper Ball | 2,89 % | 35 |
| 3× Super Ball | 2,56 % | 39 |
| 4× Poké Ball | 2,24 % | 45 |
| 🍬 2× Super Bonbon | 2,17 % | 46 |
| 2× Hyper Ball | 1,45 % | 69 |
| 5× Poké Ball | 1,12 % | 89 |
| 💎 Pépite | 1,08 % | 92 |
| 🎟️ Ticket Safari | 0,43 % | 231 |
| **Master Ball** | **0,16 %** | **615** |

Vérifié sur 400 000 tirages réels : écart maximal de **0,10 point** avec ce tableau.

**Dès la 2ᵉ génération**, la ☀️ Pierre Soleil, la 👑 Roche Royale et le ⚙️ Catalyseur s'ajoutent
(1,52 % chacun, un jour sur 66), et chaque autre lot recule d'un quinzième.

**La loterie a ses propres poids** (`lotteryWeight`, qui retombe sur `dropWeight` quand le
catalogue n'en dit rien). Les deux tables ont été la même jusqu'à ce que la loterie doive donner
quelque chose sept fois sur dix : ouvrir sa porte rendait du même coup les lots rares 1,4× plus
fréquents, alors qu'un Pokémon sur quinze tient toujours un objet. Les balls y pèsent donc plus
lourd — 640 et 330 contre 400 et 200, pour un total de 1 291 contre 921 — ce qui ramène la Pépite
et la Master Ball à la cadence qu'elles avaient à 50 %, **sans toucher à ce que tiennent les
Pokémon**. `/admin poids` affiche les deux tables côte à côte : c'est là, et nulle part ailleurs,
qu'on voit qu'elles ont divergé.

La fourchette d'un lot vit dans le catalogue (`lot: { min, max }`) : un objet sans `lot` se gagne à
l'unité, ce qui évite d'écrire `1` à `1` sur les deux tiers des lignes.

À ces réglages, un tirage rapporte **~267 points de valeur par jour et par dresseur** — un
dixième d'une journée de messages. C'est un rituel, pas un revenu.

- **La journée est UTC**, comme le classement des messages : deux découpages du mot « jour » dans
  le même bot seraient une source de bugs sans fin. L'embed annonce l'heure exacte du prochain
  tirage plutôt qu'un « reviens demain », pour que personne n'ait à deviner le fuseau.
- **Le tirage du jour se revendique**, comme un spawn ou un objet au sol : un INSERT gardé sur la
  journée déjà jouée, dont on inspecte `this.changes`. Dix commandes lancées en même temps n'en
  obtiennent qu'un seul.
- **Un crédit qui échoue rend la journée.** Personne ne perd son tirage à cause d'une panne de
  base ; le lot, lui, sera retiré au sort — c'est une loterie.
