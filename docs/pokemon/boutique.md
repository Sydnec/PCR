[← Pokémon](README.md)

# 🛒 Boutique et balls spéciales

À l'ouverture de la **2ᵉ génération**, deux balls spéciales arrivent. Elles ne se trouvent ni en drop ni à la loterie : on les **achète en points** avec `/pk boutique` (ou sur la page *Boutique* du site).

| Ball | Prix | Effet |
|---|---|---|
| 🎣 Appât Ball | 230 points | capture ×3 sur un Pokémon **pêché**, ×1 sur les autres |
| ⚙️ Catalyseur Ball | 300 points | capture ×4 sur les Pokémon qui évoluent avec le Catalyseur (Onix, Hypocéan, Insécateur, Porygon), ×1 sur les autres |

## Les règles

- **Une ball achetée ne sert qu'aux Pokémon qui apparaissent après son achat.** On n'achète pas pour le Pokémon en cours : chaque ball porte sa date d'achat, comparée à l'heure d'apparition. Un lancer sans ball antérieure est refusé en le disant, sans rien débiter.
- **10 de chaque au maximum** en poche. Un achat au-delà est refusé avec les chiffres (« tu en as 8 sur 10 : tu peux encore en acheter 2 »), et deux achats simultanés ne dépassent jamais le plafond.
- **10 achats de chaque par jour** au maximum, même si la poche a été vidée entre-temps : on ne rachète pas sans fin à mesure qu'on lance. Le compteur repart à **minuit UTC** (comme la loterie). Un achat au-delà est refusé avec les chiffres (« tu en as acheté 7 sur 10 aujourd'hui : tu peux encore en acheter 3 »). Ce qui est remboursé (poche pleine, panne) ne compte pas.
- **Rien à payer au lancer** : la ball est déjà payée. Elle est consommée au lancer, raté ou réussi. Si quelqu'un attrape le Pokémon avant, elle t'est **rendue** avec sa date d'achat.
- Elles se lancent depuis le bouton **Balls spéciales** (Discord et site). Sur Discord, ce menu ne montre que les balls qu'on a en poche et qui servent à ce Pokémon, et donne au-dessus la chance de capture de chacune contre lui, bonus compris. La **Master Ball** y a été déplacée : elle se paie toujours au lancer, avec sa confirmation et son prix progressif, que le menu affiche (le tien, puisqu'il monte à chaque achat).
- `/pk inventaire` montre les balls spéciales qu'on a en poche.

Les prix, bonus, plafond (`maxHeld`), quota du jour (`dailyLimit`) et la génération d'ouverture sont dans `capture.specialBalls` de `modules/config.js`.
