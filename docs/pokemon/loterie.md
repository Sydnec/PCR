[← Pokémon](README.md)

# 🎰 Loterie

`/pk loterie` offre **un tirage par dresseur et par jour**. Trois fois sur quatre il donne quelque
chose, et **un gain sur deux est une ou deux Poké Balls, ou une Super Ball** : le tirage doit se
sentir généreux sans l'être, d'où beaucoup de petits lots et très peu de gros.

**La quantité décroît géométriquement** : chaque exemplaire de plus est deux fois moins probable
que le précédent (`lotDecay`). Le tirage était uniforme à l'origine, et c'était son défaut — cinq
Poké Balls tombaient aussi souvent qu'une seule, si bien que le gros lot n'avait rien
d'exceptionnel. À `lotDecay: 1` on retrouve exactement l'ancien comportement.

| Résultat | Proba | Un jour sur |
|---|---|---|
| **Rien** | 25,00 % | 4 |
| 1× Poké Ball | 19,63 % | 5 |
| 1× Super Ball | 11,21 % | 9 |
| 2× Poké Ball | 9,82 % | 10 |
| 2× Super Ball | 5,60 % | 18 |
| 3× Poké Ball | 4,91 % | 20 |
| 🍬 1× Super Bonbon | 4,08 % | 25 |
| 1× Hyper Ball | 3,17 % | 32 |
| 💎 Pépite | 2,97 % | 34 |
| 3× Super Ball | 2,80 % | 36 |
| 4× Poké Ball | 2,45 % | 41 |
| 🍬 2× Super Bonbon | 2,04 % | 49 |
| 2× Hyper Ball | 1,58 % | 63 |
| 5× Poké Ball | 1,23 % | 82 |
| 🔮 Évolyte | 1,19 % | 84 |
| 🎟️ Ticket Safari | 1,19 % | 84 |
| 🍬 3× Super Bonbon | 1,02 % | 98 |
| **Master Ball** | **0,12 %** | **841** |

**Dès la 2ᵉ génération**, la ☀️ Pierre Soleil, la 👑 Roche Royale et le ⚙️ Catalyseur s'ajoutent
(1,19 % chacun, un jour sur 84) **en prenant leur place sur « Rien »**, qui tombe à 21,43 % : aucun
autre lot ne devient plus rare. `winChance` vaut en effet pour les objets de la 1ʳᵉ génération, et
ceux d'une génération suivante s'y ajoutent.

**La loterie a ses propres poids** (`lotteryWeight`, qui retombe sur `dropWeight` quand le
catalogue n'en dit rien). Les deux tables ont été la même jusqu'à ce que la loterie doive donner
quelque chose sept fois sur dix : ouvrir sa porte rendait du même coup les lots rares 1,4× plus
fréquents, sans rien changer à ce que tiennent les Pokémon. Les balls y pèsent donc plus lourd —
640 et 330 contre 400 et 200 —, ce qui garde la Pépite et la Master Ball rares à la loterie **sans
toucher à ce que tiennent les Pokémon**. `/admin poids` affiche les deux tables côte à côte : c'est là, et nulle part ailleurs,
qu'on voit qu'elles ont divergé.

La fourchette d'un lot vit dans le catalogue (`lot: { min, max }`) : un objet sans `lot` se gagne à
l'unité, ce qui évite d'écrire `1` à `1` sur les deux tiers des lignes.

À ces réglages, un tirage rapporte **~339 points de valeur par jour et par dresseur** (~357 dès la
2ᵉ génération), en comptant les balls à leur prix et les objets à leur revente. C'est un rituel,
pas un revenu.

- **La journée est UTC**, comme le classement des messages : deux découpages du mot « jour » dans
  le même bot seraient une source de bugs sans fin. L'embed annonce l'heure exacte du prochain
  tirage plutôt qu'un « reviens demain », pour que personne n'ait à deviner le fuseau.
- **Le tirage du jour se revendique**, comme un spawn ou un objet au sol : un INSERT gardé sur la
  journée déjà jouée, dont on inspecte `this.changes`. Dix commandes lancées en même temps n'en
  obtiennent qu'un seul.
- **Un crédit qui échoue rend la journée.** Personne ne perd son tirage à cause d'une panne de
  base ; le lot, lui, sera retiré au sort — c'est une loterie.
