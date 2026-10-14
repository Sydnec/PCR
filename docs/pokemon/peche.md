[← Pokémon](README.md)

# 🎣 Pêche

À l'ouverture de la **2ᵉ génération**, on peut lancer sa ligne : `/pk pecher canne:<nom>` (ou la section *Pêche* de la page Capture du site).

- **Le lancer coûte le prix de la canne**, débité tout de suite : **Canne 50 points**, **Super Canne 100**, **Méga Canne 200**. Une canne ne baisse pas son tarif : la Méga Canne pêche à 200, jamais à 50.
- **Les cannes** : la Canne est donnée à tous (une seule fois, jamais échangeable). La Super Canne et la Méga Canne **tombent sur les Pokémon capturés** et se gagnent à la **loterie**.
- **Un Pokémon mord, il est pour toi seul.** La touche est privée (un éphémère sur Discord, une carte sur le site) : personne d'autre ne peut lancer dessus. Elle s'enfuit au bout de **`fishing.fleeSeconds`** (2 minutes), et on n'a qu'**une touche à la fois** : tant qu'elle est là, une nouvelle pêche est refusée sans rien débiter.
- **Les balls se paient comme sur une apparition du salon**, contrairement au safari. L'objet tenu suit le Pokémon capturé, sans course.
- Une touche pêchée porte le drapeau « pêché » : c'est lui qui donne son bonus de ×3 à l'[Appât Ball](boutique.md).

## Les tables : les taux officiels

Chaque canne tire dans sa table, issue des **rencontres officielles** d'Or, Argent et Cristal (PokéAPI), moyennées sur toutes les zones. Le Magicarpe est dans les trois, mais pas dans les mêmes proportions :

| Canne | Table |
|---|---|
| Canne | 7 espèces, **Magicarpe 86 %**, puis Poissirène, Ptitard, Tentacool, Krabby… |
| Super Canne | 14 espèces, Magicarpe 38 %, Poissirène 19 %, Ptitard 15 %… |
| Méga Canne | 20 espèces, Poissirène 20 %, Ptitard 19 %, Magicarpe 16 %… |

Les tables sont dans `modules/pokemon-fishing.json`, produit par `npm run gen:fishing` (aucun appel réseau en production).

## Plus rares à l'état sauvage

Les espèces qui se pêchent sont **plus rares dans la nature** : leur poids d'apparition est multiplié par `fishing.wildRarityFactor` (×0,7), pour les apparitions du salon **et** le parc safari. Avant l'ouverture de la génération 2, rien ne change. C'est un facteur de config, retouchable à chaud avec `/admin config`.
