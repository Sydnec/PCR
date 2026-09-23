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

- `/pk pokedex [membre]` : collection, doublons, shinies et progression. Réponse privée. Un 🔒 marque
  les espèces qu'aucune apparition ne donnera jamais — elles ne s'obtiennent que par fusion ou
  par échange —, un 🥚 celles qui ne sortent que d'un œuf.
- `/pk boite [pokemon] [membre]` : les Pokémon un par un, page par page — `#numéro`, sexe, ball,
  date, fertilité, et 📌 le dernier d'une espèce (voir [Individus](individus.md)).
- `/pk oeuf pondre <parent1> <parent2>` / `/pk oeuf voir` : faire pondre un couple d'une famille à bébé,
  suivre l'œuf (voir [Œufs](oeufs.md)).
- `/pk classement` : classement des dresseurs par espèces distinctes.
- `/pk info <pokemon>` : la même fiche que le bouton des apparitions — type, rareté,
  difficulté, et la lignée évolutive stade par stade avec ce que le dresseur en a déjà.
- `/pk evolution <pokemon>` : fait évoluer un Pokémon en sacrifiant des doublons. On choisit le sexe
  de l'individu qui évolue ; il le garde, avec sa ball. Les lignées à embranchement (Évoli) peuvent
  évoluer au hasard, ou vers une cible choisie pour plus cher. La commande ne propose que les
  chemins réellement praticables, objets d'évolution compris.
- `/pk echange <membre> <je_donne> <je_recois>` : échange entre dresseurs, par espèce, sexe et
  fertilité. **Seuls les doublons s'échangent** : contrairement aux jeux, avoir capturé un Pokémon
  ne suffit pas à le garder au Pokédex, il faut le posséder. Il en reste toujours au moins un de
  chaque entrée, et l'autocomplétion ne propose que ce qu'on a en trop.
  **Kadabra, Machopeur, Gravalanch et Spectrum évoluent en changeant de dresseur**, comme en
  première génération : c'est celui qui *reçoit* le Pokémon qui reçoit sa forme évoluée. La
  proposition l'annonce avant le clic, et un shiny reste shiny en évoluant.
- `/pk safari` : paie l'entrée du parc safari (voir [Parc Safari](safari.md)). Réponse privée.
- `/pk inventaire [membre]` : les objets qu'un dresseur a en poche (voir [Objets](objets.md)).
- `/pk loterie` : un tirage par jour et par dresseur (voir [Loterie](loterie.md)). Réponse privée.
- `/pk web` : le lien du [site](../site.md), en réponse privée.
- `/pk revendre pokemon <doublon> [quantite]` / `/pk revendre objet <objet> [quantite]` : convertit
  en points ce qu'on a en trop, par espèce et sexe. Un exemplaire est **toujours** conservé.

Partout où une commande désigne un Pokémon (`/pk echange`, `/pk oeuf pondre`, `/pk revendre
pokemon`, `/pk evolution`), on peut choisir un groupe dans la liste ou taper **`#numéro`** — le
numéro qu'affiche `/pk boite` — pour désigner un Pokémon précis.
- `/admin pokespawn` *(Admin)* : déclenche une apparition pour organiser un événement. Donne accès aux
  espèces hors pool naturel (légendaires et évolutions par échange), avec forçage du shiny, texte
  d'annonce et mention de rôle.
- `/admin safarispawn` *(Admin)* : ouvre un parc safari à la demande, pour un événement ou pour offrir
  une visite à un dresseur en particulier.

## Réglages

Tous les nombres (prix, multiplicateurs, taux de shiny, cadence, poids de rareté,
coûts de fusion, et l'intégralité du parc safari dans `pokemon.safari`) vivent dans le bloc
`pokemon` de `config.json`, relu à l'exécution — ils sont donc modifiables **sans redémarrer le
bot**. Le curseur `capture.globalMultiplier` rend l'ensemble du jeu
plus ou moins difficile tout en préservant la hiérarchie entre espèces.

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
  aussi : Pikachu reste commun et Raichu peu commun, là où compter Pichu en ferait un rare. La
  fusion d'un bébé vers sa forme adulte a son propre tarif, `pokemon.evolution.1` (2 doublons et
  250 points par défaut).

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
