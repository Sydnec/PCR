[← Pokémon](README.md)

# 📦 Chaque Pokémon est un individu

La collection n'est plus un compteur par espèce : chaque Pokémon est une ligne à part, avec ce qui
le distingue des autres.

- **Un sexe**, tiré à l'arrivée selon la proportion des jeux : Nidoran♀ et Lippoutou sont toujours
  femelles, Kicklee et Tygnon toujours mâles, Évoli mâle sept fois sur huit. Les espèces asexuées des
  jeux (Magnéti, les légendaires, Métamorph…) tirent à pile ou face : ici, tout Pokémon a un sexe.
- **La ball de capture**, mémorisée pour de bon — y compris la Safari Ball du parc. Un Pokémon éclos
  d'un œuf n'en a pas.
- **La fertilité** : un individu ne pond qu'un œuf dans sa vie, puis il devient stérile (voir
  [Œufs](oeufs.md)).
- **Sa date d'arrivée** chez son dresseur actuel.

`/boite [pokemon] [membre]` les montre un par un : les plus récents, ou ceux d'une espèce.

## L'exemplaire gardé

Avoir capturé un Pokémon ne suffit pas à le garder au Pokédex, il faut le posséder. **Le plus ancien
individu de chaque entrée** (espèce + variante, un shiny comptant à part) est donc verrouillé : 📌
dans `/boite`. Aucune revente, fusion ni échange ne peut le prendre.

## Qui part quand on cède

On choisit un **groupe** — espèce, variante et sexe, plus la fertilité pour un échange — et le bot
choisit l'individu : jamais l'exemplaire gardé, les **stériles d'abord**, puis **les plus récents**.
On cède ce qui vaut le moins.

- **Revente** : par espèce et sexe (`Pikachu ♀`).
- **Fusion** : le sexe choisi est celui de l'individu qui **évolue** ; il garde son sexe, sa ball et
  sa fertilité. Les autres doublons consommés, de n'importe quel sexe, disparaissent.
- **Échange** : par espèce, sexe et fertilité (`Pikachu ♀ (fertile)`) — qui reçoit une femelle
  fertile doit pouvoir compter dessus. L'individu change de dresseur sans cesser d'être lui-même.

## Migration

Au premier démarrage, chaque compteur de l'ancienne collection devient autant d'individus. Le sexe
est tiré comme pour une capture ; la ball est retrouvée dans l'historique des captures (apparitions
et parc), du plus ancien au plus récent. Ce que l'historique n'explique pas — évolutions, échanges —
reste marqué « ball inconnue ». L'ancienne table est conservée telle quelle, en sauvegarde.
