[← Pokémon](README.md)

# 🎯 Capture & Pokédex

- **Spawns automatiques** : un Pokémon des générations ouvertes (voir
  [Générations](README.md#générations)) apparaît dans un salon dédié, un seul à la fois. Dès que le
  salon est vide — le précédent ayant été capturé ou s'étant enfui — le **message suivant** en fait
  apparaître un nouveau. Tant qu'un Pokémon est là, ce sont le seuil de messages et
  le délai minimum (~40 messages et 1 h) qui décident du moment où il s'enfuit, remplacé par le
  suivant. Un délai plancher après capture est disponible (`minDelayAfterEndMinutes`, à 0 par défaut)
  si l'enchaînement devient trop rapide.
- **Fuite autonome** : chaque apparition reçoit une durée de vie tirée au hasard entre 3 et 6 heures
  (`fleeAfterMinutes`). Passé ce délai, un Pokémon que personne n'a capturé s'enfuit de lui-même,
  sans dépendre de l'activité du serveur — un salon silencieux ne reste donc jamais figé sur le même
  Pokémon. La durée de vie n'est jamais affichée.
- **Course à un vainqueur** : tout le monde peut lancer autant de balls qu'il veut, le premier jet
  réussi remporte le Pokémon. Les balls ratées sont définitivement perdues.
- **Panneau de relance** : la réponse privée à un lancer porte elle-même les quatre balls et se
  **réécrit** à chaque jet, au lieu d'empiler un message par lancer. Plus besoin de remonter à
  l'annonce pour relancer — et si on y remonte quand même, le nouveau panneau remplace l'ancien :
  un dresseur n'en a jamais qu'un seul ouvert. Dès que le Pokémon n'est plus là, le panneau te le dit et retire ses
  boutons — au clic suivant : Discord ne permet pas de modifier un message privé sans que son
  destinataire n'agisse.
- **Depuis le site aussi** : l'onglet Capture du [site](../site.md) montre la même apparition et
  lance par le même chemin — même prix, même cooldown, même course.
- **4 balls** : Poké Ball (×1), Super Ball (×2), Hyper Ball (×4) et Master Ball (capture garantie,
  avec confirmation obligatoire). Les probabilités suivent la formule officielle de la génération 3,
  à partir du taux de capture réel de chaque espèce.
- **Shiny** (~1/500) : une variante de l'espèce, pas une entrée de Pokédex à part. Le Pokédex dit
  combien on en a.
- **Le sexe se voit dès l'apparition** : l'annonce le montre (« Un Pikachu ♀ sauvage apparaît ! »),
  et c'est celui qu'aura l'individu capturé. Même chose pour les rencontres du parc safari.
- **Chaque capture est un individu** : son sexe est tiré selon l'espèce, et la ball qui l'a emporté
  reste attachée à lui (voir [Individus](individus.md)).
- **🔒 Espèces hors pool** : celles dont le poids d'apparition est nul dans le pool sauvage **et**
  dans celui du parc ne peuvent s'obtenir que par évolution. Le Pokédex et les fiches les marquent d'un
  cadenas, sans quoi on peut chasser des mois un Mackogneur qui n'apparaîtra pas. Le marqueur est
  *calculé* à partir des mêmes poids que les tirages, jamais recopié : mettre `weightsByStage.3` à
  zéro verrouille les seize stades 3 et le cadenas suit.
- **Bouton « ℹ️ Infos du Pokémon »** sur chaque apparition : un message Discord étant identique
  pour tous ses lecteurs, ce bouton ouvre à chacun en privé la fiche de l'espèce — type, rareté,
  chances à la Poké Ball, et toute la lignée évolutive avec ce qu'il en possède déjà — suivie de
  **son solde de points et des balls qu'il a en poche**, l'autre question qu'on se pose devant une
  apparition. `/solde` affiche le même embed.
- À la capture comme à la fuite, l'embed affiche les **participants** avec les balls que chacun a
  lancées — `🥇 @Hoolan (1×🟡 2×🔵)` — et le total des points brûlés part en pied de page. La
  capture s'annonce par la ball qui l'a emportée et nomme son vainqueur dans la même ligne. Cette
  ligne est la *description* de l'embed et non son titre : Discord n'y rendrait ni les emoji du
  serveur ni les mentions.
