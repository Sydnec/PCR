[← README](../../README.md)

# 🔴 Pokémon

Système de capture qui sert de **puits à points** : chaque lancer de ball débite des points,
que la capture réussisse ou non. Toutes ses commandes vivent sous **`/pk`**.

- [Capture & Pokédex](capture.md) — apparitions, balls, shiny, fiche d'espèce.
- [Individus](individus.md) — sexe, ball de capture, fertilité, `#numéro`, toujours un exemplaire.
- [Œufs](oeufs.md) — la seule façon d'obtenir les bébés.
- [Objets](objets.md) — ce que tiennent les Pokémon, balls offertes, pierres.
- [Loterie](loterie.md) — un tirage par jour et par dresseur.
- [Revente](revente.md) — doublons et objets contre des points.
- [Parc Safari](safari.md) — l'événement où les actions ne coûtent rien.

## Commandes

- `/pk pokedex [membre]` : collection, doublons, shinies et progression. Réponse privée. Une entrée
  est une **espèce**, shiny ou non. Un 🔒 marque les espèces qu'aucune apparition ne donnera
  jamais — elles ne s'obtiennent que par évolution ou par échange —, un 🥚 celles qui ne sortent
  que d'un œuf.
- `/pk boite [pokemon] [membre]` : les Pokémon un par un, page par page — `#numéro`, sexe, ball,
  date, fertilité, et 🛡️ les verrouillés (voir [Individus](individus.md)).
- `/pk doublons [membre] [pokemon]` : les espèces qu'un dresseur a en plusieurs exemplaires, dans
  l'ordre du Pokédex, et combien peuvent s'échanger ou se revendre — tout sauf un par espèce, hors
  verrouillés 🛡️. Avec une espèce, l'inverse : les dresseurs qui l'ont en double, ceux qui peuvent
  en céder le plus d'abord. Réponse privée, page par page.
- `/pk verrou <espece> <individu>` : verrouille ou déverrouille un Pokémon. **Verrouillé, il ne part
  jamais** — ni revente, ni échange, ni sacrifice — mais peut encore évoluer, après confirmation,
  et pondre. Les shiny et les légendaires arrivent verrouillés (`pokemon.lockByDefault`), y compris
  reçus en échange. Réponse privée.
- `/pk oeuf pondre <parent1> <parent2>` / `/pk oeuf voir` : faire pondre un couple d'une famille à bébé,
  suivre l'œuf (voir [Œufs](oeufs.md)).
- `/pk classement` : classement des dresseurs par espèces distinctes.
- `/pk info <pokemon>` : la même fiche que le bouton des apparitions — type, rareté,
  difficulté, répartition mâle/femelle, et la lignée évolutive stade par stade avec ce que le
  dresseur en a déjà.
- `/pk evolution <espece> [individu]` : fait évoluer un Pokémon de l'espèce. L'individu est
  facultatif : sans lui, le bot prend les sacrifices parmi les moins précieux — les normaux avant
  les shiny, puis les stériles, puis les plus récents —, fait évoluer le suivant, et ne touche
  jamais à un verrouillé. Celui qui évolue reste lui-même : même numéro, même ball, même sexe,
  même fertilité, shiny s'il l'était, et verrouillé s'il l'était — un verrouillé évolue après une
  confirmation, s'il est choisi. Les autres Pokémon de l'évolution sont des **sacrifices** : des
  exemplaires de l'espèce, shiny ou non (les normaux partent d'abord), jamais un verrouillé, et il
  en reste toujours un. Avec un Salamèche et un Salamèche shiny, on peut faire évoluer le shiny
  avec des bonbons ou des Métamorph : le normal garde l'entrée. Les lignées à embranchement (Évoli)
  peuvent évoluer au hasard, ou vers une cible choisie pour plus cher. La commande ne propose que
  les chemins réellement praticables, objets d'évolution compris.
  **Métamorph sert de joker** : quand il manque des sacrifices, un bouton propose de les remplacer
  par des Métamorph, shiny ou non (les normaux d'abord), un par sacrifice
  (`pokemon.evolution.dittosPerCopy`). Les exemplaires de l'espèce partent d'abord, et il reste
  toujours un Métamorph. Il n'est jamais pris sans qu'on le demande, et le choix de la forme
  (Évoli) reste possible avec lui.
- `/pk echange <membre> <je_donne> <mon_individu> <je_recois> <son_individu>` : échange entre
  dresseurs, d'un Pokémon précis contre un autre, chacun choisi après son espèce : qui reçoit sait
  exactement ce qu'il aura, fertilité comprise. **Seuls les doublons s'échangent** : contrairement
  aux jeux, avoir capturé un Pokémon ne suffit pas à le garder au Pokédex, il faut le posséder. Il
  en reste toujours au moins un de chaque espèce, shiny ou non, et l'autocomplétion ne propose que
  ce qu'on a en trop — `/pk doublons membre` le montre avant de proposer.
  **Kadabra, Machopeur, Gravalanch et Spectrum évoluent en changeant de dresseur**, comme en
  première génération : c'est celui qui *reçoit* le Pokémon qui reçoit sa forme évoluée. La
  proposition l'annonce avant le clic, et un shiny reste shiny en évoluant.
- `/pk safari` : paie l'entrée du parc safari (voir [Parc Safari](safari.md)). Réponse privée.
- `/pk inventaire [membre]` : les objets qu'un dresseur a en poche (voir [Objets](objets.md)).
- `/pk loterie` : un tirage par jour et par dresseur (voir [Loterie](loterie.md)). Réponse privée.
- `/pk web` : le lien du [site](../site.md), en réponse privée.
- `/pk revendre pokemon <espece> [individu] [quantite]` / `/pk revendre objet <objet> [quantite]` :
  convertit en points ce qu'on a en trop. Sans individu précis, `quantite` normaux de l'espèce
  partent, les moins précieux d'abord ; un shiny se choisit. Un exemplaire de chaque espèce est
  **toujours** conservé.

`/pk evolution`, `/pk echange` et `/pk revendre pokemon` demandent l'espèce, puis l'individu parmi
les siens — facultatif pour l'évolution et la revente. `/pk oeuf pondre` accepte un groupe de la liste ou **`#numéro`** — le numéro qu'affiche
`/pk boite` — pour désigner un Pokémon précis.
- `/admin pokespawn` *(Admin)* : déclenche une apparition pour organiser un événement. Donne accès aux
  espèces hors pool naturel (légendaires et évolutions par échange), avec forçage du shiny, texte
  d'annonce et mention de rôle.
- `/admin safarispawn` *(Admin)* : ouvre un parc safari à la demande, pour un événement ou pour offrir
  une visite à un dresseur en particulier.

## Réglages

Tous les nombres (prix, multiplicateurs, taux de shiny, cadence, poids de rareté,
coûts d'évolution, et l'intégralité du parc safari dans `pokemon.safari`) vivent dans le bloc
`pokemon` de `config.json`, relu à l'exécution — ils sont donc modifiables **sans redémarrer le
bot**. Le curseur `capture.globalMultiplier` rend l'ensemble du jeu
plus ou moins difficile tout en préservant la hiérarchie entre espèces. Le `duplicates` d'un stade
d'évolution (`pokemon.evolution.2.duplicates`…) compte l'individu qui évolue : il sacrifie un
exemplaire de moins.

## Générations

Le jeu tourne sur la **1ʳᵉ génération**, et la **2ᵉ est prête** : ses 100 espèces sont déjà dans
les données, cachées. Pour l'ouvrir, une seule commande, sans release ni redémarrage :

```
/admin config pokemon.generation 2
```

Apparitions, parc safari, Pokédex (251 espèces), recherche, fiches, évolutions et échanges la
prennent en compte immédiatement. Ce qu'elle change :

- **Des lignées s'allongent** : Nosferalto → Nostenfer, Leveinard → Leuphorie, Évoli → Mentali et
  Noctali, Ortide → Joliflor, et les bébés en amont (Pichu → Pikachu, Mélo, Toudoudou, Élekid,
  Magby, Lippouti, Debugant → Kicklee, Tygnon ou Kapoera). Les bébés n'apparaissent pas : ils
  sortent des [œufs](oeufs.md), qui n'ont donc rien à pondre tant que la génération 2 est fermée.
- **Six nouvelles évolutions par échange**, dont la source est souvent de 1ʳᵉ génération : Onix →
  Steelix, Insécateur → Cizayox, Hypocéan → Hyporoi, Ramoloss → Roigada, Têtarte → Tarpaud, Porygon
  → Porygon2. Comme les quatre premières, elles n'apparaissent jamais à l'état sauvage (🔒).
- **Six légendaires** de plus : Raikou, Entei, Suicune, Lugia, Ho-Oh et Celebi.
- **Les raretés de la 1ʳᵉ génération ne bougent pas.** Un bébé est de stade 1, sa forme adulte
  aussi : Pikachu reste commun et Raichu peu commun, là où compter Pichu en ferait un rare.
  L'évolution d'un bébé vers sa forme adulte coûte comme une première évolution d'adulte :
  le tarif du stade 2 (`pokemon.evolution.2`).

Refermer une génération (`pokemon.generation 1`) cache ses espèces sans les retirer des
collections ; elles réapparaissent à la réouverture.

## Données

`modules/pokemon-data.json` contient toutes les espèces jusqu'à la dernière génération préparée.
Il est généré par `npm run gen:pokemon` (`-- --gen N` pour préparer la génération N) depuis le
dataset PokéAPI et commité — la production ne fait aucun appel réseau. Le plafond de
`pokemon.generation` se lit dans ce fichier : préparer une génération, c'est le régénérer.

## Statistiques annuelles

Le jeu alimente en continu `botdata-<ANNÉE>.db` (tables `pokemon_stats`,
`pokemon_ball_stats`, `pokemon_species_stats`, `pokemon_highlights`, `pokemon_daily_stats`). Comme ce
fichier change au 1ᵉʳ janvier, la base **est** le périmètre de l'année : un récap de fin d'année n'a
qu'à lire ces tables, sans aucun filtre de date. La ligne `__global__` porte les totaux du serveur,
comme pour `message_stats`. Points brûlés, captures attendues contre captures réelles (donc la chance
de chacun), records personnels, shinies et légendaires capturés : tout y est.
