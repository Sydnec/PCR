[← README](../../README.md)

# 🔴 Pokémon

Système de capture qui sert de **puits à points** : chaque lancer de ball débite des points,
que la capture réussisse ou non.

- [Capture & Pokédex](capture.md) — apparitions, balls, shiny, fiche d'espèce.
- [Objets](objets.md) — ce que tiennent les Pokémon, balls offertes, pierres.
- [Loterie](loterie.md) — un tirage par jour et par dresseur.
- [Revente](revente.md) — doublons et objets contre des points.
- [Parc Safari](safari.md) — l'événement où les actions ne coûtent rien.

## Commandes

- `/pokedex [membre]` : collection, doublons, shinies et progression. Réponse privée. Un 🔒 marque
  les espèces qu'aucune apparition ne donnera jamais — elles ne s'obtiennent que par fusion ou
  par échange.
- `/pokeclassement` : classement des dresseurs par espèces distinctes.
- `/pokeinfo <pokemon>` : la même fiche que le bouton des apparitions — type, rareté,
  difficulté, et la lignée évolutive stade par stade avec ce que le dresseur en a déjà.
- `/evolution <pokemon>` : fait évoluer un Pokémon en sacrifiant des doublons. Les lignées à
  embranchement (Évoli) peuvent évoluer au hasard, ou vers une cible choisie pour plus cher. La
  commande ne propose que les chemins réellement praticables, objets d'évolution compris.
- `/echange <membre> <je_donne> <je_recois>` : échange entre dresseurs. **Seuls les doublons
  s'échangent** : contrairement aux jeux, avoir capturé un Pokémon ne suffit pas à le garder au
  Pokédex, il faut le posséder. Le premier exemplaire de chaque entrée — un shiny compte à part —
  reste donc verrouillé dans la collection, et l'autocomplétion ne propose que ce qu'on a en trop.
  **Kadabra, Machopeur, Gravalanch et Spectrum évoluent en changeant de dresseur**, comme en
  première génération : c'est celui qui *reçoit* le Pokémon qui reçoit sa forme évoluée. La
  proposition l'annonce avant le clic, et un shiny reste shiny en évoluant.
- `/safari` : paie l'entrée du parc safari (voir [Parc Safari](safari.md)). Réponse privée.
- `/inventaire [membre]` : les objets qu'un dresseur a en poche (voir [Objets](objets.md)).
- `/loterie` : un tirage par jour et par dresseur (voir [Loterie](loterie.md)). Réponse privée.
- `/revendre pokemon <doublon> [quantite]` / `/revendre objet <objet> [quantite]` : convertit
  en points ce qu'on a en trop. Un exemplaire est **toujours** conservé.
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

## Données

`modules/pokemon-gen1.json` est généré une fois par `npm run gen:pokemon` depuis le
dataset PokéAPI et commité — la production ne fait aucun appel réseau.

## Statistiques annuelles

Le jeu alimente en continu `botdata-<ANNÉE>.db` (tables `pokemon_stats`,
`pokemon_ball_stats`, `pokemon_species_stats`, `pokemon_highlights`, `pokemon_daily_stats`). Comme ce
fichier change au 1ᵉʳ janvier, la base **est** le périmètre de l'année : un récap de fin d'année n'a
qu'à lire ces tables, sans aucun filtre de date. La ligne `__global__` porte les totaux du serveur,
comme pour `message_stats`. Points brûlés, captures attendues contre captures réelles (donc la chance
de chacun), records personnels, shinies et légendaires capturés : tout y est.
