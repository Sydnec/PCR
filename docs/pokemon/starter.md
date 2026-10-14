[← Pokémon](README.md)

# 🌱 Starter de génération

À l'ouverture de la **2ᵉ génération** (la 1ʳᵉ n'en a pas : elle était là avant), chaque dresseur choisit **un starter parmi trois** — Germignon, Héricendre ou Kaiminus — avec `/pk starter`.

- **Le choix est définitif**, un par dresseur et par génération. La commande demande une confirmation avant de le prendre.
- **Le stade 1 est donné tout de suite**, comme premier Pokémon de la génération (origine « starter de génération »).
- **Les trois starters restent capturables à l'état sauvage** : les apparitions sont les mêmes pour tout le serveur, elles ne dépendent pas du choix de chacun. Ils s'échangent comme les autres.

## Les récompenses

Compléter le **Pokédex de la génération**, hors légendaires et fabuleux — la même mesure que le [Charme Chroma](charme.md) —, donne les évolutions du starter choisi :

| Pokédex de la génération | Récompense |
|---|---|
| 33 % | le stade 2 de la lignée |
| 66 % | le stade 3 de la lignée |
| 100 % | le stade 1, en **shiny** ✨ |

- Chaque palier se donne **une seule fois**, annoncé dans le salon des apparitions.
- Les récompenses comptent elles-mêmes au Pokédex : un palier peut en déclencher le suivant.
- **Choix tardif, rattrapage** : si le Pokédex a déjà atteint des paliers quand on choisit, ils sont donnés tous d'un coup. Au démarrage du bot, un contrôle donne aussi ce qu'une coupure aurait laissé.
- Les pourcentages, les paliers et les starters sont dans `pokemon.starters` de `modules/config.js` : la génération 3 se prépare en y ajoutant ses trois starters.

`/pk starter` sans option montre où l'on en est : le starter choisi, la progression du Pokédex et les paliers (✅ reçu, ⏳ atteint, · à venir).
