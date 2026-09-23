[← Pokémon](README.md)

# 🥚 Œufs

Les bébés — Pichu, Mélo, Toudoudou, Togepi, Debugant, Lippouti, Élekid et Magby — n'apparaissent
jamais, ni à l'état sauvage ni au parc : ils ne sortent que d'un œuf. Ils arrivent donc avec la
génération 2 (voir [Générations](README.md#générations)).

- **Seules les familles qui ont un bébé pondent**, et l'œuf donne toujours ce bébé : un Bulbizarre
  ne pond rien.
- `/oeuf pondre <parent1> <parent2>` : un **mâle** et une **femelle** fertiles de la même famille —
  Pikachu ♂ et Raichu ♀ donnent un Pichu. **Métamorph**, qui n'a pas de sexe, **remplace l'un des
  deux parents, quel que soit le sexe de l'autre** — jamais les deux. C'est la seule façon de faire
  pondre Kicklee, Tygnon et Kapoera (tous mâles), ou Lippoutou (toujours femelle). Une fois le
  premier parent choisi, l'autocomplétion ne propose que ses partenaires possibles.
- **Les parents restent**, mais **chacun ne pond qu'une fois dans sa vie** : il devient stérile.
- **Un seul œuf à la fois** par dresseur.
- **Éclosion au premier des deux seuils** : **5 jours**, ou **200 messages** de son propriétaire —
  comme des pas dans le jeu. Le bébé naît avec un sexe, peut être shiny comme une apparition
  sauvage, et s'annonce dans le salon des apparitions.
- `/oeuf voir` : l'œuf en cours et ce qu'il lui manque.

Réglages : `pokemon.eggs` (`enabled`, `hatchHours`, `hatchMessages`). Les seuils sont figés à la
ponte : les retoucher ne change que les œufs suivants.
