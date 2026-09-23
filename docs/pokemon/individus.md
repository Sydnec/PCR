[← Pokémon](README.md)

# 📦 Chaque Pokémon est un individu

La collection n'est plus un compteur par espèce : chaque Pokémon est une ligne à part, avec ce qui
le distingue des autres.

- **Un sexe**, tiré selon la proportion des jeux — dès l'apparition pour un Pokémon sauvage, dont
  l'annonce le montre, et à l'éclosion pour un œuf : Nidoran♀ et Lippoutou sont toujours
  femelles, Kicklee et Tygnon toujours mâles, Évoli mâle sept fois sur huit. Les espèces asexuées des
  jeux (Magnéti, Stari, Porygon, Métamorph, les légendaires…) n'en ont pas ici non plus.
- **La ball de capture**, mémorisée pour de bon — y compris la Safari Ball du parc. Un Pokémon éclos
  d'un œuf n'en a pas.
- **La fertilité** : un individu ne pond qu'un œuf dans sa vie, puis il devient stérile (voir
  [Œufs](oeufs.md)).
- **Sa date d'arrivée** chez son dresseur actuel.

`/pk boite [pokemon] [membre]` les montre un par un, page par page : les plus récents, ou ceux
d'une espèce.

## Le numéro

Chaque Pokémon a un **numéro** (`#123`), affiché en tête de sa ligne dans `/pk boite`. Il ne
change jamais, même quand le Pokémon évolue ou change de dresseur. `/pk evolution`, `/pk echange`
et `/pk revendre pokemon` demandent l'espèce, puis l'individu parmi les siens, désigné par son
numéro. `/pk oeuf pondre` accepte un groupe ou `#123` ; l'autocomplétion propose les numéros dès
qu'on tape `#`.

Sur le [site](../site.md#boîte-pc), chacun range aussi ses Pokémon dans les boîtes de son PC et
peut leur donner un surnom. C'est du rangement : ni la place ni le surnom ne changent quoi que ce
soit au jeu, et Discord continue d'afficher le nom de l'espèce.

## Toujours au moins un

Avoir capturé un Pokémon ne suffit pas à le garder au Pokédex, il faut le posséder. Il reste donc
**toujours au moins un individu de chaque espèce**, shiny ou non : une entrée de Pokédex est une
espèce. Aucun n'est réservé pour autant : n'importe lequel peut partir, même le plus ancien, tant
qu'il n'est pas le dernier. Avec un Salamèche et un Salamèche shiny, l'un ou l'autre peut partir.

## Le verrou

Pour qu'un Pokémon précis ne parte jamais, on le **verrouille** : `/pk verrou <espece> <individu>`,
ou le bouton « Verrouiller » de sa fiche sur le [site](../site.md#boîte-pc). Verrouillé, il ne se
revend pas, ne s'échange pas et n'est jamais sacrifié ; il peut encore évoluer, après une
confirmation, et pondre. Les **shiny et les légendaires arrivent verrouillés** — capture, parc,
œuf, échange —, et ceux qu'on avait déjà l'ont été une fois, à la mise à jour
(`pokemon.lockByDefault` : `shiny`, `legendary`). Il est marqué 🛡️ dans `/pk boite` et dans les
listes des commandes.

## Qui part quand on cède

Quand le bot choisit lui-même, il cède ce qui vaut le moins : les **normaux avant les shiny**, puis
les **stériles**, puis **les plus récents** — et jamais un verrouillé.

- **Revente** : un individu précis, ou `quantite` normaux de l'espèce choisis par le bot. Un shiny
  se choisit, il ne part jamais dans le lot.
- **Évolution** : on choisit l'individu qui **évolue** ; il reste lui-même — numéro, ball, sexe,
  fertilité, shiny. Les **sacrifices**, de n'importe quel sexe et de n'importe quelle variante, sont
  choisis par le bot et disparaissent.
- **Échange** : un individu précis de chaque côté, fertilité comprise — qui reçoit une femelle
  fertile doit pouvoir compter dessus : si elle pond ou est verrouillée entre-temps, l'échange
  échoue. L'individu change de dresseur sans cesser d'être lui-même : numéro, shiny, ball,
  fertilité, sexe et surnom le suivent. Il arrive avec la date de l'échange, à la première case
  libre du PC, et verrouillé s'il est shiny ou légendaire.

## Migration

Au premier démarrage, chaque compteur de l'ancienne collection devient autant d'individus. Le sexe
est tiré comme pour une capture (aucun pour une espèce asexuée) ; la ball est retrouvée dans l'historique des captures (apparitions
et parc), du plus ancien au plus récent. Ce que l'historique n'explique pas — évolutions, échanges —
reste marqué « ball inconnue ». L'ancienne table est conservée telle quelle, en sauvegarde.
