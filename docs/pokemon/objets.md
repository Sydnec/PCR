[← Pokémon](README.md)

# 🎒 Objets

**Un Pokémon sur quinze tient quelque chose** (7 %), tiré à l'apparition et figé dans sa ligne, comme
le shiny et le taux de capture : ce qu'il porte lui appartient et ne se rejoue pas à chaque lancer.
L'annonce n'en dit rien — sinon un objet rare ferait monter les enchères sur un Roucool — et tout le
monde le découvre à la fin. Le parc safari, lui, ne fait rien tomber : 25 rencontres par visite
noieraient la table.

| Objet | Part des trouvailles | Ce qu'il fait | Revente |
|---|---|---|---|
| Poké Ball | 43 % | un lancer offert | — |
| Super Ball | 22 % | un lancer offert | — |
| 🍬 Super Bonbon | 13 % | **trois** tiennent lieu d'un exemplaire manquant dans une fusion | 300 |
| Hyper Ball | 8,7 % | un lancer offert | — |
| 🔥⚡💧 Pierres | 3,3 % chacune | font évoluer un Évoli vers *leur* forme, sans exemplaire ni point en plus | 500 |
| 💎 Pépite | 2,2 % | rien, sinon se revendre | 2 000 |
| 🎟️ Ticket Safari | 0,9 % | une entrée du parc, sans passer par la caisse | — |
| Master Ball | **0,33 %** | la capture garantie, offerte | — |

`dropWeight` est un **poids**, pas un pourcentage : la part d'un objet vaut son poids divisé par la
somme de tous (921 pour le butin). `/admin poids` fait la conversion pour les quatre tables de
tirage du jeu, cadence comprise — la Master Ball tombe une fois sur 4 386 apparitions. La loterie
tire dans sa propre table (`lotteryWeight`, voir [Loterie](loterie.md)) ; celle-ci ne décrit que le butin.

**Une fois sur cinq, il le lâche en partant.** Capturé ou enfui, un Pokémon qui tenait quelque chose
a 20 % de chances de le laisser par terre plutôt que de le céder à son vainqueur. Un message public
s'affiche alors avec un bouton **« 🤚 Ramasser »**, et c'est une seconde course — ouverte à tout le
monde, y compris à qui n'a pas lancé une seule ball, et y compris à celui qui vient de gagner la
première. C'est la seule récompense du jeu qui ne demande pas d'avoir gagné quoi que ce soit, et la
seule chose qu'une apparition perdue peut encore donner. Le verrou est en base, comme toujours :
deux clics simultanés, un seul ramasseur, et un crédit qui échoue repose l'objet par terre plutôt
que de le faire disparaître.

- **Un objet est une clé et un compteur.** Nom, icône et description vivent dans `pokemon.items` —
  réglables à chaud, comme les balls. Une entrée `ball: "poke"` lui fait *emprunter* le libellé et
  l'icône de la ball correspondante, si bien que changer l'emoji d'une ball suffit.
- **Trois attributs décident du reste** : `sellValue` le rend revendable, `dropWeight` le fait
  tomber, `evolution` le rend utilisable dans une fusion — combien d'exemplaires de l'objet valent
  combien d'exemplaires du Pokémon, s'ils dispensent des points, et à quelle lignée ils sont
  réservés. C'est ce dernier point qui fait des pierres des objets à Évoli : une Pierre Feu jetée
  sur un Chenipan est refusée, elle ne part pas.
- **Les balls offertes partent d'elles-mêmes.** Cliquer sur *Poké Ball (120)* en ayant une Poké Ball
  dans son inventaire ne coûte rien : l'objet passe avant le solde, parce qu'un objet posé dans un
  sac ne doit pas dormir pendant qu'on prend la monnaie de son propriétaire. La Master Ball garde sa
  confirmation — elle ne coûte rien mais ne se retrouve pas. Le Ticket Safari suit la même règle
  dans `/pk safari`, et il ignore le délai de 24 h : ce délai borne ce qu'on peut s'**acheter**.
- **Une ball offerte se rend en ball.** Battu à la milliseconde sur un Pokémon, on récupère l'objet,
  jamais sa valeur en points : la convertir en monnaie ferait d'un Pokémon disputé une petite
  imprimerie. Le lancer est alors journalisé à coût nul, ce qui garde honnête le total des points
  brûlés. Même chose pour un ticket dont la visite n'a pas pu s'ouvrir.
- **Une fusion aidée rend tout ce qu'elle a pris si elle échoue** : les exemplaires d'abord, l'aide
  ensuite, dans l'ordre inverse où ils ont été réservés.
- **Une seule écriture retire un objet**, et elle est gardée (`count >= ?`, puis `this.changes`).
- **Tout mouvement est journalisé** dans `pokemon_item_log` avec sa provenance (`lancer`,
  `capture:42`, `sol:8`, `fusion`, `safari`, `vente`, `admin:…`).
- **La ligne survit à zéro**, comme dans le Pokédex : `first_obtained_at` ne se retrouve pas après
  coup. Toute lecture filtre donc sur `count > 0`.
