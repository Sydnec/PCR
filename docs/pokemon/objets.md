[← Pokémon](README.md)

# 🎒 Objets

**Un Pokémon sur quinze tient quelque chose** (7 %), tiré à l'apparition et figé dans sa ligne, comme
le shiny et le taux de capture : ce qu'il porte lui appartient et ne se rejoue pas à chaque lancer.
L'annonce n'en dit rien — sinon un objet rare ferait monter les enchères sur un Roucool — et tout le
monde le découvre à la fin. Le parc safari, lui, ne fait rien tomber : 25 rencontres par visite
noieraient la table.

| Objet | Part des trouvailles | Ce qu'il fait | Revente |
|---|---|---|---|
| Poké Ball | 43 % | un lancer offert | — |
| Super Ball | 22 % | un lancer offert | — |
| 🍬 Super Bonbon | 13 % | **trois** tiennent lieu d'un sacrifice dans une évolution | 300 |
| Hyper Ball | 8,7 % | un lancer offert | — |
| 🔮 Évolyte | 9,8 % | un Évoli qui évolue avec lui prend la forme de son choix, sans supplément ; il tient lieu d'un sacrifice | 500 |
| ☀️ Pierre Soleil | 3 %, dès la 2ᵉ gén. | Ortide devient Joliflor plutôt que Rafflesia ; tient lieu d'un sacrifice | 500 |
| 👑 Roche Royale | 3 %, dès la 2ᵉ gén. | Têtarte devient Tarpaud, Ramoloss devient Roigada ; tient lieu d'un sacrifice | 500 |
| ⚙️ Catalyseur | 3 %, dès la 2ᵉ gén. | le seul moyen de faire évoluer Onix, Insécateur, Hypocéan et Porygon ; tient lieu d'un sacrifice | 500 |
| 💎 Pépite | 2,2 % | rien, sinon se revendre | 2 000 |
| 🎟️ Ticket Safari | 0,9 % | une entrée du parc, sans passer par la caisse | — |
| Master Ball | **0,33 %** | la capture garantie, offerte | — |

`dropWeight` est un **poids**, pas un pourcentage : la part d'un objet vaut son poids divisé par la
somme de tous (921 pour le butin, 1 011 dès la 2ᵉ génération : les autres parts y reculent d'un
onzième). `/admin poids` fait la conversion pour les quatre tables de tirage du jeu, cadence
comprise — la Master Ball tombe une fois sur 4 386 apparitions. La loterie tire dans sa propre table
(`lotteryWeight`, voir [Loterie](loterie.md)) ; celle-ci ne décrit que le butin.

**Une fois sur cinq, il le lâche en partant.** Capturé ou enfui, un Pokémon qui tenait quelque chose
a 20 % de chances de le laisser par terre plutôt que de le céder à son vainqueur. Un message public
s'affiche alors avec un bouton **« 🤚 Ramasser »**, et c'est une seconde course — ouverte à tous
les autres, y compris à qui n'a pas lancé une seule ball, mais pas à celui qui vient de gagner la
première : ce qu'un Pokémon capturé lâche revient aux autres. L'annonce dit alors « Il a lâché »
plutôt que « Il tenait ». C'est la seule récompense du jeu qui ne demande pas d'avoir gagné quoi
que ce soit, et la seule chose qu'une apparition perdue peut encore donner. Le verrou est en base,
comme toujours : deux clics simultanés, un seul ramasseur, et un crédit qui échoue repose l'objet
par terre plutôt que de le faire disparaître.

- **Un objet est une clé et un compteur.** Nom, icône et description vivent dans `pokemon.items` —
  réglables à chaud, comme les balls. Une entrée `ball: "poke"` lui fait *emprunter* le libellé et
  l'icône de la ball correspondante, si bien que changer l'emoji d'une ball suffit.
- **Trois attributs décident du reste** : `sellValue` le rend revendable, `dropWeight` le fait
  tomber, `evolution` le rend utilisable dans une évolution — combien d'exemplaires de l'objet
  valent combien de sacrifices, s'ils dispensent des points, et à quelle lignée ils sont
  réservés : une Évolyte jetée sur un Chenipan est refusée, elle ne part pas. Un quatrième,
  `generation`, garde un objet hors du jeu tant que sa génération est fermée : il ne tombe pas, ne
  sort pas à la loterie et ne sert à rien avant.
- **Les balls offertes partent d'elles-mêmes.** Lancer une Poké Ball en en ayant une dans son
  inventaire ne coûte rien : l'objet passe avant le solde, parce qu'un objet posé dans un sac ne
  doit pas dormir pendant qu'on prend la monnaie de son propriétaire. Le panneau de lancer, privé,
  l'annonce *Poké Ball (offerte ×2)*, et ce bouton-là ne prend jamais de points : si la ball est
  partie entre-temps (lancée depuis le site), le lancer est refusé sans rien débiter. L'annonce
  publique, la même pour tous, garde le prix. La Master Ball garde sa
  confirmation — elle ne coûte rien mais ne se retrouve pas. Le Ticket Safari suit la même règle
  dans `/pk safari`, et il ignore le délai de 24 h : ce délai borne ce qu'on peut s'**acheter**.
- **Une ball offerte se rend en ball.** Battu à la milliseconde sur un Pokémon, on récupère l'objet,
  jamais sa valeur en points : la convertir en monnaie ferait d'un Pokémon disputé une petite
  imprimerie. Le lancer est alors journalisé à coût nul, ce qui garde honnête le total des points
  brûlés. Même chose pour un ticket dont la visite n'a pas pu s'ouvrir.
- **Une évolution aidée rend tout ce qu'elle a pris si elle échoue** : l'aide d'abord, puis les
  exemplaires, dans l'ordre inverse où ils ont été réservés.
- **Une seule écriture retire un objet**, et elle est gardée (`count >= ?`, puis `this.changes`).
- **Tout mouvement est journalisé** dans `pokemon_item_log` avec sa provenance (`lancer`,
  `capture:42`, `sol:8`, `fusion`, `safari`, `vente`, `admin:…`).
- **La ligne survit à zéro**, comme dans le Pokédex : `first_obtained_at` ne se retrouve pas après
  coup. Toute lecture filtre donc sur `count > 0`.

## Objets d'évolution

**Un objet d'évolution tient lieu d'un sacrifice**, et le prix en points reste celui du stade :
l'objet ne dispense de rien d'autre. `/pk evolution` propose un bouton par objet utilisable qu'on a
en poche, et le site une image à cliquer dans la bande d'évolution.

- **L'Évolyte laisse choisir.** Sur Évoli, choisir sa forme coûte d'ordinaire le tarif du choix
  (`pokemon.evolution.branchChoicePoints`) ; avec une Évolyte, on la choisit au tarif du stade,
  hasard ou pas. Elle remplace les Pierres Feu, Foudre et Eau, qui ne servaient qu'à Évoli : celles
  qu'on avait ont été converties une pour une au démarrage du bot, y compris celles qui attendaient
  par terre ou que tenait le Pokémon du salon.
- **Certaines formes ne s'obtiennent qu'avec leur objet** (`evolution.targets` :
  `{ espèce: forme }`). Sans Pierre Soleil, Ortide devient Rafflesia ; sans Roche Royale, Têtarte
  devient Tartard et Ramoloss Flagadoss — l'objet change la forme, il ne débloque pas l'évolution.
  Sans Catalyseur, Onix, Insécateur, Hypocéan et Porygon n'évoluent pas du tout. Dans les jeux, ces
  quatre-là évoluent en changeant de dresseur avec un objet tenu : ici, l'objet suffit, et
  l'échange ne les fait plus évoluer. Kadabra, Machopeur, Gravalanch et Spectrum évoluent toujours
  par échange, sans objet.
- **Les trois objets de la 2ᵉ génération** (`generation: 2`) n'entrent dans les mains des Pokémon
  et dans la loterie qu'à son ouverture (voir [Générations](README.md#générations)).
