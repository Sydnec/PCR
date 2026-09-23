[← Pokémon](README.md)

# 💱 Revente

`/pk revendre` convertit en points ce qu'on a en trop — un doublon de Pokémon, ou un objet dont le
catalogue fixe la valeur (`sellValue`). Rien d'autre ne se revend : une ball offerte se lance, elle
ne se monnaie pas.

- **L'entrée de Pokédex est intouchable.** On ne vend que des doublons : il reste toujours au moins
  un exemplaire (voir [Individus](individus.md)), et une seule instruction compte et retire, donc
  six ventes simultanées sur trois doublons en laissent passer exactement trois. On choisit
  l'espèce et le sexe — le bot vend les stériles d'abord, puis les plus récents — ou un `#numéro`.
- **Le barème suit la rareté** (`pokemon.sell.byRarity`) : **250** points pour un commun, **600**
  pour un peu commun, **1 500** pour un rare. La règle qui le gouverne : **aucun tarif ne doit
  dépasser le coût espéré d'une capture**, sans quoi la chasse devient une imprimerie à points. Ce
  coût, à l'Hyper Ball et au taux moyen de chaque tranche, vaut ~510, ~1 030 et ~1 690 points, soit
  une revente à 49 %, 58 % et 89 %.
- **Les légendaires et les shinies ne se revendent pas.** Les premiers n'ont pas de ligne au barème,
  les seconds un multiplicateur nul : ce sont des entrées de Pokédex qu'on ne retrouve pas, et
  personne ne doit pouvoir les brader d'un clic.
- **On retire d'abord, on crédite ensuite**, et on rend ce qu'on a retiré si le crédit échoue.
  L'inverse paierait deux fois celui qui clique deux fois.
- **Les ventes de Pokémon sont journalisées** dans `pokemon_sales` : une vente détruit des
  exemplaires pour de bon, et le compteur de la collection ne dira jamais qu'ils ont existé.
