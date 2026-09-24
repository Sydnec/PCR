[← Pokémon](README.md)

# 🌟 Charme Chroma

Un charme par génération, pour qui en a complété le Pokédex. Son porteur voit **deux fois plus de
shiny** parmi les Pokémon de cette génération (`pokemon.shinyCharm.multiplier`).

- **L'obtenir** : posséder toutes les espèces de la génération, **hors légendaires et fabuleux** —
  146 pour la 1re (sans Artikodin, Électhor, Sulfura, Mewtwo ni Mew), 94 pour la 2e (bébés compris).
  L'objet arrive dans l'inventaire dès que la dernière espèce rejoint une boîte, quelle que soit la
  porte (capture, parc safari, œuf, échange, évolution), et le salon des apparitions l'annonce. Il
  est gardé pour de bon : le dernier exemplaire d'une espèce ne part jamais. Il ne se revend pas, ne
  tombe pas et ne sort pas à la loterie (`charme_chroma_1`, `charme_chroma_2` dans
  `pokemon.items`, reconnus par leur `charm.generation`).
- **Les apparitions** sont communes à tout le salon, d'où un seul tirage par apparition : sous
  1/500 elle brille pour tout le monde, entre 1/500 et 2/500 pour les seuls porteurs du charme de sa
  génération. Chaque porteur a ainsi 1 chance sur 250, les autres toujours 1 sur 500. L'annonce le
  dit (« ✨ Il brille pour les porteurs du Charme Chroma ») et mentionne le rôle du charme. Le
  vainqueur d'une telle apparition reçoit un shiny s'il porte le charme, un Pokémon normal sinon.
  Le site montre l'apparition shiny aux porteurs.
- **Le parc safari et les œufs** sont privés : les chances de shiny du porteur y sont doublées pour
  les espèces de sa génération (1 sur 125 au parc, et ×2 en plus des parents shiny dans un œuf,
  affiché par `/pk oeuf voir`).
- **Les rôles** : `SHINY_CHARM_ROLE_ID_1`, `SHINY_CHARM_ROLE_ID_2` (`.env`). Le bot donne celui
  de sa génération aux porteurs qui ont le rôle Pokémon (`POKEMON_ROLE_ID`), et le retire à qui
  quitte ce dernier : ne pas vouloir des pings du jeu, c'est ne pas vouloir ceux du charme non plus.
  L'inventaire fait foi, le rôle n'en est que le reflet : le bot le répare au démarrage et à chaque
  changement de rôle. Sans ces variables, le charme joue quand même, sans rôle ni ping. Le bot doit
  pouvoir gérer ces rôles (placés sous le sien).
