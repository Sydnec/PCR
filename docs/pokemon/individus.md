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
change jamais, même quand le Pokémon évolue ou change de dresseur. Taper `#123` dans une commande
qui désigne un Pokémon — `/pk echange`, `/pk oeuf pondre`, `/pk revendre pokemon`, `/pk evolution`
— vise ce Pokémon précis plutôt qu'un groupe ; l'autocomplétion propose les numéros dès qu'on tape
`#`.

## Toujours au moins un

Avoir capturé un Pokémon ne suffit pas à le garder au Pokédex, il faut le posséder. Il reste donc
**toujours au moins un individu de chaque entrée** (espèce + variante, un shiny comptant à part).
Aucun n'est réservé pour autant : n'importe lequel peut partir, même le plus ancien, tant qu'il
n'est pas le dernier. Le dernier est marqué 📌 dans `/pk boite`.

## Qui part quand on cède

On choisit un **groupe** — espèce, variante et sexe, plus la fertilité pour un échange — et le bot
choisit l'individu : les **stériles d'abord**, puis **les plus récents**. On cède ce qui vaut le
moins. Pour céder un individu précis, on donne son numéro.

- **Revente** : par espèce et sexe (`Pikachu ♀`).
- **Fusion** : le sexe choisi est celui de l'individu qui **évolue** ; il garde son sexe, sa ball et
  sa fertilité. Les autres doublons consommés, de n'importe quel sexe, disparaissent.
- **Échange** : par espèce, sexe et fertilité (`Pikachu ♀ (fertile)`) — qui reçoit une femelle
  fertile doit pouvoir compter dessus. L'individu change de dresseur sans cesser d'être lui-même.

## Migration

Au premier démarrage, chaque compteur de l'ancienne collection devient autant d'individus. Le sexe
est tiré comme pour une capture (aucun pour une espèce asexuée) ; la ball est retrouvée dans l'historique des captures (apparitions
et parc), du plus ancien au plus récent. Ce que l'historique n'explique pas — évolutions, échanges —
reste marqué « ball inconnue ». L'ancienne table est conservée telle quelle, en sauvegarde.
