[← README](../../README.md)

# 🔴 Pokémon

Système de capture qui sert de **puits à points** : chaque lancer de ball débite des points,
que la capture réussisse ou non. Toutes ses commandes vivent sous **`/pk`**.

- [Capture & Pokédex](capture.md) — apparitions, balls, shiny, fiche d'espèce.
- [Individus](individus.md) — sexe, ball de capture, fertilité, `#numéro`, toujours un exemplaire.
- [Charme Chroma](charme.md) — un Pokédex de génération complété, deux fois plus de shiny.
- [Œufs](oeufs.md) — la seule façon d'obtenir les bébés.
- [Objets](objets.md) — ce que tiennent les Pokémon, balls offertes, objets d'évolution.
- [Loterie](loterie.md) — un tirage par jour et par dresseur.
- [Revente](revente.md) — doublons et objets contre des points.
- [Parc Safari](safari.md) — l'événement où les actions ne coûtent rien.

## Commandes

- `/pk pokedex [membre]` : collection, doublons, shinies et progression. Réponse privée. Une entrée
  est une **espèce**, shiny ou non. Un 🔒 marque les espèces qu'aucune apparition ne donnera
  jamais — elles ne s'obtiennent que par évolution, avec un objet ou par échange —, un 🥚 celles
  qui ne sortent que d'un œuf.
- `/pk boite [pokemon] [membre]` : les Pokémon un par un, page par page — `#numéro`, sexe, ball,
  date, fertilité, et 🛡️ les verrouillés (voir [Individus](individus.md)).
- `/pk renommer <espece> <individu> [surnom]` : donne un surnom à un de tes Pokémon, ou le retire
  (`surnom` vide). Le même que sur le [site](../site.md), par la même fonction : limite
  `pokemon.pc.nicknameLength`, rognage signalé dans la réponse, ancien surnom rappelé pour pouvoir le
  remettre. Il apparaît devant l'espèce dans `/pk boite` et dans la vitrine, et suit le Pokémon
  quand il évolue ou change de dresseur. Réponse privée.
- `/pk doublons [membre] [pokemon] [evolutions]` : les espèces qu'un dresseur a en plusieurs
  exemplaires, dans l'ordre du Pokédex, et combien peuvent s'échanger — tout sauf un par espèce,
  hors verrouillés 🛡️. Avec une espèce, l'inverse : les dresseurs qui l'ont en double, ceux qui
  peuvent en céder le plus d'abord. Dans les deux sens, un doublon dont tous les exemplaires en trop
  sont verrouillés n'apparaît pas. Réponse privée, page par page.
  - `evolutions` met de côté 🧬 ce qu'il faut pour les évolutions qui manquent au Pokédex du
    dresseur affiché, lignée entière : s'il manque Florizarre, assez d'Herbizarre pour le faire
    évoluer, et assez de Bulbizarre pour faire ces Herbizarre. Le compte suit le tarif des
    évolutions sans objet ni Métamorph — avec le sien pour une forme qui n'existe qu'avec un objet
    (Steelix) —, une évolution par forme manquante (Évoli), et laisse de côté les évolutions par
    échange, qu'on obtient en recevant le premier stade. Les verrouillés servent
    d'abord à évoluer et à rester au Pokédex, seuls les libres se sacrifient. Ce qui est mis de côté
    reste échangeable : l'option ne change que ce que la liste montre.
- `/pk vitrine voir [membre]` / `/pk vitrine ajouter <espece> <individu> [place]` /
  `/pk vitrine retirer <pokemon>` : la **vitrine**, où chacun expose jusqu'à six Pokémon
  (`pokemon.showcase.slots`) aux autres, en un seul bloc : une image que le bot dessine, trois
  Pokémon par ligne dans des cases de taille fixe (`pokemon.showcase.imageCell` pixels), puis une
  ligne par Pokémon avec son surnom, sa rareté, sa ball et son identifiant. C'est du décor : un Pokémon exposé reste jouable, mais le bot le sacrifie ou le
  revend en dernier quand il choisit lui-même. Revendu, échangé ou sacrifié, il quitte la vitrine ;
  s'il évolue, il y reste. Sa propre vitrine porte un bouton **« 📤 Montrer à tout le monde »** qui
  la publie dans le salon, une fois par heure au plus (`pokemon.showcase.shareCooldownMinutes`).
  Réponses privées.
- `/pk verrou <espece> <individu>` : verrouille ou déverrouille un Pokémon. **Verrouillé, il ne part
  jamais** — ni revente, ni échange, ni sacrifice — mais peut encore évoluer, après confirmation,
  et pondre. Les shiny et les légendaires arrivent verrouillés (`pokemon.lockByDefault`), y compris
  reçus en échange. Réponse privée.
- `/pk oeuf pondre <parent1> <parent2>` / `/pk oeuf voir` : faire pondre un couple d'une famille à bébé,
  suivre l'œuf (voir [Œufs](oeufs.md)).
- `/pk classement` : classement des dresseurs par espèces distinctes.
- `/pk info <pokemon>` : la même fiche que le bouton des apparitions — type, rareté,
  difficulté, répartition mâle/femelle, et la lignée évolutive stade par stade avec ce que le
  dresseur en a déjà.
- `/pk evolution <espece> [individu]` : fait évoluer un Pokémon de l'espèce. L'individu est
  facultatif : sans lui, le bot prend les sacrifices parmi les moins précieux — hors vitrine, les
  normaux avant les shiny, puis les stériles, puis les plus récents —, fait évoluer le suivant, et ne touche
  jamais à un verrouillé. Celui qui évolue reste lui-même : même numéro, même ball, même sexe,
  même fertilité, shiny s'il l'était, et verrouillé s'il l'était — un verrouillé évolue après une
  confirmation, s'il est choisi. Les autres Pokémon de l'évolution sont des **sacrifices** : des
  exemplaires de l'espèce, shiny ou non (les normaux partent d'abord), jamais un verrouillé, et il
  en reste toujours un. Avec un Salamèche et un Salamèche shiny, on peut faire évoluer le shiny
  avec des bonbons ou des Métamorph : le normal garde l'entrée. Les lignées à embranchement (Évoli)
  peuvent évoluer au hasard, ou vers une cible choisie pour plus cher — gratuitement avec une
  Évolyte. Certaines formes ne s'obtiennent qu'avec leur objet : Joliflor, Tarpaud, Roigada,
  Steelix… (voir [Objets](objets.md#objets-dévolution)). La commande ne propose que les chemins
  réellement praticables, objets d'évolution compris.
  **Métamorph sert de joker** : quand il manque des sacrifices, un bouton propose de les remplacer
  par des Métamorph, shiny ou non (les normaux d'abord), un par sacrifice
  (`pokemon.evolution.dittosPerCopy`). Les exemplaires de l'espèce partent d'abord, et il reste
  toujours un Métamorph. Il n'est jamais pris sans qu'on le demande, et le choix de la forme
  (Évoli) reste possible avec lui.
- `/pk echange <membre>` + de quoi remplir **chaque côté** : un Pokémon, des points ou un objet.
  - **Sans autre option**, `/pk echange membre:@x` ouvre un **brouillon privé** : « Ce que je donne »
    et « Ce que je demande » proposent un Pokémon, un objet, des points ou rien, avec des menus et
    des fenêtres de saisie (recherche d'une espèce ou d'un objet, montant, quantité, individu qu'on
    donne). « Proposer » publie la même offre que la commande, après avoir revérifié les deux côtés.
    Le brouillon est privé et dure 15 minutes (`pokemon.trade.draftMinutes`).
  - Chaque côté tient en une seule option, `je_donne` / `je_recois`, qui accepte une espèce, un objet
    ou des points. Un **nombre tapé** vaut des points : `je_donne: 3000`. Une quantité d'objet se
    tape devant son nom : `je_donne: 3 bonbon` (1 par défaut quand on choisit l'objet dans la
    liste). `mon_individu` désigne un individu précis de l'espèce que tu donnes. Pas de mélange
    dans un côté. `0` (ou « Rien ») fait un cadeau : `je_donne: 0` pour demander sans rien donner,
    `je_recois: 0` pour offrir sans rien demander.
  - Sans `mon_individu`, c'est le moins précieux de l'espèce qui part, le plus récent à égalité.
    Le Pokémon demandé ne se désigne que par son espèce : **le destinataire choisit lequel**,
    parmi ses Pokémon libres, dans un menu privé qui s'ouvre quand il clique sur « Accepter ».
  - Tous les objets s'échangent, sauf les charmes : ils se gagnent en complétant un Pokédex, et un
    échange les dupliquerait.
  - Rien ne bouge avant l'acceptation, et tout se revérifie à ce moment : points, objets et
    Pokémon doivent toujours être là, sinon l'offre échoue en disant ce qui manque (« tu en as 1,
    il en faut 2 »), sans rien perdre ni créer.
  - **Contre-offre** : le destinataire d'une offre en cours peut cliquer sur **« Contre-offre »**.
    Un brouillon privé s'ouvre avec les côtés inversés (il donne ce qu'on lui demandait, il demande
    ce qu'on lui offrait), et il change ce qu'il veut des deux côtés avant d'envoyer. L'offre
    d'origine devient **« ↩️ Contre-offre »**, boutons retirés, et la nouvelle part dans l'autre sens,
    avec son échéance neuve, en mentionnant l'ancien auteur. Il peut accepter, refuser ou contrer à
    son tour, sans limite. Si l'offre d'origine a été acceptée, refusée, annulée ou a expiré entre-temps,
    la contre-offre est refusée et rien n'est créé.
  - **« 🎁 À son choix »** : pour ce qu'on reçoit (`je_recois`, ou « Ce que je demande » du brouillon),
    on peut ne rien préciser. L'offre se lit « @A propose X à @B, contre ce qu'il voudra » et ne
    s'accepte pas telle quelle : à la place d'« Accepter », le destinataire clique sur **« Faire une
    proposition »**, ce qui ouvre la même contre-offre, avec ce qu'on lui offrait déjà demandé et ce
    qu'il donne à choisir (Pokémon, objet ou points, avec les mêmes contrôles qu'un échange
    ordinaire). L'auteur de l'offre accepte, refuse ou contre ensuite. Il faut offrir quelque chose :
    « à son choix » contre rien n'a pas de sens.
  - Une offre sans réponse à son échéance (`trade.expiryHours`) passe en **« ⌛ Échange expiré »**,
    boutons retirés, d'elle-même (un passage toutes les cinq minutes) ou au premier clic. Deux clics
    simultanés sur « Accepter » n'en concluent qu'un : le second l'apprend en privé, sans toucher
    au message.
  - Chaque Pokémon échangé garde son identité : même numéro, même sexe, même ball, même surnom.
    Qui reçoit sait exactement ce qu'il aura, fertilité comprise, quand l'offre le désigne.
  **Seuls les doublons s'échangent** : contrairement
  aux jeux, avoir capturé un Pokémon ne suffit pas à le garder au Pokédex, il faut le posséder. Il
  en reste toujours au moins un de chaque espèce, shiny ou non, et l'autocomplétion ne propose que
  ce qu'on a en trop — `/pk doublons membre` le montre avant de proposer, et `/pk comparer`
  cherche les échanges qui servent aux deux.
  **Kadabra, Machopeur, Gravalanch et Spectrum** arrivent tels quels : l'échange ne les fait plus
  évoluer. Reçus en échange, ils évoluent ensuite **gratuitement** avec `/pk evolution` — ni points ni
  sacrifice, à condition qu'il en reste un derrière lui, comme pour toute évolution : l'entrée du
  Pokédex n'est jamais perdue. Sans individu choisi, `/pk evolution` prend d'abord un reçu en échange
  (le moins précieux, jamais un verrouillé) : c'est lui qui évolue gratuitement. Le dresseur choisit
  donc s'il évolue, et quand. Un Pokémon jamais échangé garde l'évolution payante ordinaire. La
  proposition l'annonce avant le clic.
- `/pk comparer [membre] [pokemon] [evolutions]` : cherche les échanges **qui servent aux deux** —
  une espèce contre une espèce, chacune absente du Pokédex de celui qui la reçoit. Réponse privée,
  page par page. Trois usages, selon l'option :
  - `membre` compare les doublons de deux dresseurs : ce que tu peux donner, ce que l'autre peut
    te donner, et combien d'échanges 1 contre 1 en sortent. Un shiny déverrouillé reste proposé,
    signalé ✨. Deux menus choisissent un côté de l'échange chacun, puis **« Proposer cet
    échange »** publie l'offre dans le salon, avec le destinataire mentionné : même offre, mêmes
    boutons et même acceptation que `/pk echange`. Le bot choisit l'individu que tu donnes, le
    moins précieux d'abord (voir [Individus](individus.md#qui-part-quand-on-cède)), et le
    destinataire choisit le sien en acceptant. Une
    offre identique encore ouverte n'est pas republiée (« tu as déjà proposé cet échange »), et une
    offre que le salon n'a pas pu publier est annulée plutôt que laissée sans message.
  - sans option : **avec qui échanger**, le dresseur qui permet le plus d'échanges d'abord.
  - `pokemon` (n'importe quelle espèce, possédée ou non) : **à qui elle manque**. Si tu en as un
    en trop, chacun est accompagné de ce qu'il peut te donner en retour — un échange passe avant un
    cadeau ; sinon, la liste dit seulement qui n'en a pas.
  - Dans les trois cas, `evolutions` (actif par défaut) met de côté, de chaque côté, ce qu'il faut
    pour les évolutions qui manquent au Pokédex (voir `/pk doublons`). Ces Pokémon restent
    échangeables avec `/pk echange`.
- `/pk safari` : paie l'entrée du parc safari (voir [Parc Safari](safari.md)). Réponse privée.
- `/pk inventaire [membre]` : les objets qu'un dresseur a en poche (voir [Objets](objets.md)).
- `/pk loterie` : un tirage par jour et par dresseur (voir [Loterie](loterie.md)). Réponse privée.
- `/pk pecher [canne]` : lance ta ligne avec une [canne](peche.md) (100 points le lancer) : un Pokémon
  mord, réservé à toi, et s'enfuit au bout de 2 minutes. Sans option, tes cannes et ta touche en
  cours. Ouverte avec la 2ᵉ génération. Réponse privée.
- `/pk boutique [ball] [quantite]` : la [boutique des balls spéciales](boutique.md), ouverte avec la 2ᵉ
  génération. Sans option, le catalogue et ton solde ; avec une ball, l'achat. Réponse privée.
- `/pk starter [pokemon]` : choisis ton [starter de génération](starter.md) — définitif, avec confirmation —
  ou, sans option, vois ta progression et tes paliers. Réponse privée.
- `/pk web` : le lien du [site](../site.md), en réponse privée.
- `/pk revendre pokemon <espece> [individu] [quantite]` / `/pk revendre objet <objet> [quantite]` :
  convertit en points ce qu'on a en trop. Sans individu précis, `quantite` normaux de l'espèce
  partent, les moins précieux d'abord ; un shiny se choisit. Un exemplaire de chaque espèce est
  **toujours** conservé.

`/pk evolution`, `/pk echange` et `/pk revendre pokemon` demandent l'espèce, puis l'individu parmi
les siens — facultatif pour l'évolution, l'échange et la revente. `/pk oeuf pondre` accepte un groupe de la liste ou **`#numéro`** — le numéro qu'affiche
`/pk boite` — pour désigner un Pokémon précis.
- `/admin pokespawn` *(Admin)* : déclenche une apparition pour organiser un événement. Donne accès aux
  espèces hors pool naturel (légendaires, évolutions par échange ou par objet), avec forçage du shiny, texte
  d'annonce et mention de rôle.
- `/admin safarispawn` *(Admin)* : ouvre un parc safari à la demande, pour un événement ou pour offrir
  une visite à un dresseur en particulier.
- `/admin saison` *(Admin)* : l'aperçu du [bilan de saison](#bilan-de-saison) en cours, de l'ouverture de
  la génération à maintenant. Réponse privée : rien n'est publié ni enregistré.

## Réglages

Tous les nombres (prix, multiplicateurs, taux de shiny, cadence, poids de rareté,
coûts d'évolution, et l'intégralité du parc safari dans `pokemon.safari`) vivent dans le bloc
`pokemon` de la [configuration](../configuration.md), relu à l'exécution — ils sont donc
modifiables **sans redémarrer le bot**. Le curseur `capture.globalMultiplier` rend l'ensemble du jeu
plus ou moins difficile tout en préservant la hiérarchie entre espèces. Le `duplicates` d'un stade
d'évolution (`pokemon.evolution.2.duplicates`…) compte l'individu qui évolue : il sacrifie un
exemplaire de moins.

## Générations

Le jeu tourne sur la **1ʳᵉ génération**, et la **2ᵉ s'ouvre d'elle-même le vendredi 30 octobre
2026 à 18 h** (heure de Paris) : ses 100 espèces sont déjà dans les données, cachées. La date vit
dans `pokemon.generationOpenings` (`{ "2": "2026-10-30T18:00:00+01:00" }`), relue à chaque
instant : ni release ni redémarrage. La génération jouable est la plus haute de `pokemon.generation`
et des dates passées.

Pour avancer ou repousser l'ouverture, puis pour ouvrir tout de suite :

```
/admin config pokemon.generationOpenings.2 2026-10-30T18:00:00+01:00
/admin config pokemon.generation 2
```

À l'ouverture, le salon des apparitions reçoit **une annonce**, rôle Pokémon mentionné : les
nouvelles espèces, les légendaires, les bébés, les objets et le Charme Chroma. Elle ne part qu'une
fois (la base en garde la trace), même si le bot redémarre, et un bot éteint à l'heure dite
l'envoie à son retour. Le [bilan de la saison](#bilan-de-saison) qui se ferme la suit.

Apparitions, parc safari, Pokédex (251 espèces), recherche, fiches, évolutions et échanges la
prennent en compte immédiatement. Ce qu'elle change :

- **Des lignées s'allongent** : Nosferalto → Nostenfer, Leveinard → Leuphorie, Évoli → Mentali et
  Noctali, et les bébés en amont (Pichu → Pikachu, Mélo, Toudoudou, Élekid, Magby, Lippouti,
  Debugant → Kicklee, Tygnon ou Kapoera). Les bébés n'apparaissent pas : ils sortent des
  [œufs](oeufs.md), qui n'ont donc rien à pondre tant que la génération 2 est fermée.
- **Des formes qui demandent un objet** : Ortide → Joliflor (☀️ Pierre Soleil, sinon Rafflesia),
  Têtarte → Tarpaud et Ramoloss → Roigada (👑 Roche Royale, sinon Tartard et Flagadoss), Onix →
  Steelix, Insécateur → Cizayox, Hypocéan → Hyporoi et Porygon → Porygon2 (⚙️ Catalyseur, sans
  lequel ils n'évoluent pas). Ces trois objets entrent dans les mains des Pokémon et dans la loterie
  à l'ouverture (voir [Objets](objets.md#objets-dévolution)). Ces formes n'apparaissent jamais à
  l'état sauvage (🔒).
- **Les nouvelles espèces sortent plus souvent** : deux fois plus qu'une espèce de la 1ʳᵉ génération
  au même stade (`spawn.generationBoost`, voir [Capture & Pokédex](capture.md)), aux apparitions du
  salon seulement.
- **Le parc safari demande quelles générations on vise** (voir [Parc Safari](safari.md)).
- **Six légendaires** de plus : Raikou, Entei, Suicune, Lugia, Ho-Oh et Celebi.
- **Zarbi et ses 26 lettres** : une seule entrée de Pokédex, mais chaque Zarbi porte la sienne,
  avec son image (voir [Individus](individus.md)).
- **Un Charme Chroma de 2ᵉ génération** (voir [Charme Chroma](charme.md)).
- **Les raretés de la 1ʳᵉ génération ne bougent pas.** Un bébé est de stade 1, sa forme adulte
  aussi : Pikachu reste commun et Raichu peu commun, là où compter Pichu en ferait un rare.
  L'évolution d'un bébé vers sa forme adulte coûte comme une première évolution d'adulte :
  le tarif du stade 2 (`pokemon.evolution.2`).

Refermer une génération (`pokemon.generation 1`, avec une date d'ouverture repoussée) cache ses
espèces sans les retirer des collections ; elles réapparaissent à la réouverture.

## Bilan de saison

Une **saison** court d'une ouverture de génération à la suivante : la saison 1 va du début du jeu à
l'ouverture de la 2ᵉ génération, la saison 2 de là à l'ouverture de la 3ᵉ. Quand la génération
suivante s'ouvre, le salon des apparitions reçoit, juste après l'annonce, le **« Bilan de la saison N »** :
deux embeds, *Les Pokémon* et *Les dresseurs*. Les podiums citent les dresseurs sans en notifier aucun.
Une rubrique sans donnée n'est pas affichée, et un classement n'est tenu que sur assez de matière.

- **Les Pokémon** : apparitions (pêche comprise), lancers (dont ceux du safari), points dépensés par
  source (lancers, évolutions, safari, pêche, boutique — les sources à zéro sont omises), évolutions ;
  les espèces les plus apparues, **les plus timides** (celles qui pouvaient apparaître, légendaires
  exclus, le zéro compte), les plus capturées, **les plus boudées** (taux de fuite, à partir de 5
  apparitions) et les plus vendues ; les shiny et les légendaires capturés, et par qui ; la capture la
  plus improbable, la série de ratés la plus improbable (« 1 chance sur X »), la plus longue résistance
  et la ball préférée du serveur.
- **Les dresseurs** : les **champions** (le plus d'espèces du Pokédex de la saison, légendaires exclus ;
  chaque espèce est datée de son acquisition — capture, éclosion, starter, échange, évolution —, et le
  plus rapide l'emporte à égalité), les plus et les moins chanceux à la capture (captures réelles sur
  captures attendues, au moins 30 lancers : les plus chanceux sont au-dessus de ×1, les moins chanceux
  en dessous, un podium sans personne est omis), les plus chanceux en objets (somme de la rareté de ce
  qu'ils ont obtenu sur un Pokémon, au sol ou à la loterie), les moins chanceux à la loterie (au moins
  5 tirages et un taux de victoires sous celui de la saison : qui n'a jamais perdu n'y est pas), puis
  les meilleurs nettoyeurs, visiteurs du safari, pêcheurs et échangeurs.

Les statistiques sont celles de la **génération qui se ferme** : le bilan de la saison 1 se calcule
quand la 2ᵉ est ouverte, mais avec le Pokédex, les apparitions possibles et les objets de la 1ʳᵉ.

Pour les administrateurs :

- Le bilan part **exactement une fois**, même si deux passages du minuteur se croisent ou si le bot
  redémarre : la table `pokemon_season_recaps` garde une ligne par saison (bornes, heure d'envoi,
  message, statistiques en JSON). Un envoi qui échoue est retenté, après une attente qui grandit à
  chaque essai (`retryMinutes` × le nombre d'essais) ; le bail d'un envoi interrompu par un arrêt
  expire de la même façon. Une rubrique dont la lecture en base échoue est aussi une panne : le bilan
  n'est ni publié amputé ni classé « rien à raconter », il est retenté de la même façon. Une fois le
  message parti, l'écriture qui le note est retentée `recordRetries` fois (attente `recordRetryDelayMs`,
  doublée à chaque essai) ; si elle échoue toujours, le journal le dit (« publié mais non
  enregistré ») et le bilan sera renvoyé à l'expiration du bail.
- Une visite au safari compte dans la saison où elle a **commencé** (`started_at`), telle qu'elle est au
  moment où le bilan est calculé : ses balls et son entrée, y compris les balls lancées après la fin de
  la saison par une visite encore en cours à l'ouverture de la génération.
- Une touche de pêche dont l'échéance est passée à la fin de la saison compte comme une fuite (taux de
  fuite, issue de la plus longue résistance), même si sa ligne n'a pas encore été refermée.
- La saison 1 de la loterie lit les compteurs cumulés, dont on retire les tirages du journal datés de
  la fin de la saison ou d'après : un bilan publié en retard ne compte pas la saison suivante.
- Une saison finie depuis plus de `publishWithinHours` heures n'est plus publiée, ni une saison où il
  n'y a rien à dire : elle est marquée sautée. Une installation neuve ne publie donc pas de vieilles
  nouvelles.
- Les réglages sont dans `pokemon.seasonRecap` : `enabled`, `topSize` (5), `podiumSize` (3),
  `minThrowsForLuck` (30), `minLotteryDraws` (5), `minSpawnsForFleeRate` (5), `publishWithinHours`
  (168), `retryMinutes` (10), `recordRetries` (3) et `recordRetryDelayMs` (500). `/admin saison` montre
  le bilan de la saison en cours avec les réglages du moment, et signale les rubriques qu'il n'a pas pu
  lire.
- Trois choses sont suivies **à partir de la sortie de cette fonctionnalité** : les achats de la
  boutique (`pokemon_shop_purchases`), le coût de chaque pêche (`pokemon_spawns.cast_cost`) et les
  tirages de la loterie (`pokemon_lottery_draws`, un tirage rendu en est retiré). La saison 1 lit donc
  les compteurs cumulés de la loterie, qui disent tout son historique ; les suivantes lisent le journal.

## Données

`modules/pokemon-data.json` contient toutes les espèces jusqu'à la dernière génération préparée.
Il est généré par `npm run gen:pokemon` (`-- --gen N` pour préparer la génération N) depuis le
dataset PokéAPI et commité — la production ne fait aucun appel réseau. Le plafond de
`pokemon.generation` se lit dans ce fichier : préparer une génération, c'est le régénérer.

## Statistiques annuelles

Le jeu alimente en continu `botdata-<ANNÉE>.db` (tables `pokemon_stats`,
`pokemon_ball_stats`, `pokemon_species_stats`, `pokemon_highlights`, `pokemon_daily_stats`). Comme ce
fichier change au 1ᵉʳ janvier, la base **est** le périmètre de l'année : un récap de fin d'année n'a
qu'à lire ces tables, sans aucun filtre de date. La ligne `__global__` porte les totaux du serveur,
comme pour `message_stats`. Points brûlés, captures attendues contre captures réelles (donc la chance
de chacun), records personnels, shinies et légendaires capturés : tout y est.
