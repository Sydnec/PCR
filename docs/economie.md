[← README](../README.md)

# 💰 Économie & Pot commun

Les points se gagnent au fil des messages, sur le serveur comme en message privé au bot
(`messagePointsDistribution` : les premiers de la journée rapportent plus, avec une heure de carence
entre deux messages récompensés, `messagePoints.cooldownMinutes`) et se dépensent dans les paris, les
Pokémon et le parc safari. La journée commence à minuit, heure de Paris : le premier message après
minuit rapporte le premier palier, même moins d'une heure après celui de la veille. Les bots ne
gagnent rien. La commande `/solde` affiche le solde actuel, les balls en poche et un compte à rebours
(`<t:...:R>`) indiquant dans combien de temps on peut à nouveau gagner des points (ou confirme qu'ils
sont disponibles dès maintenant) ; ce compte à rebours se calcule avec la règle même du gain. Sur son
propre solde, elle rappelle aussi la [loterie](pokemon/loterie.md) du jour tant qu'elle n'a pas été
tentée. `/classement` montre les dix plus gros soldes.

**Le pot commun** corrige ce que cette économie a de cumulatif. Une fois par semaine, chacun cotise
un pourcentage de sa fortune et la cagnotte repart en **parts égales** entre tous les porteurs du
rôle par défaut — un impôt sur le capital : les gros soldes financent, tout le monde reçoit la
même chose. Le rôle par défaut est `default_role_id` dans `instance.toml` (`DEFAULT_ROLE_ID` en v1),
les bots en sont exclus.

- **Obligatoire, automatique et silencieux.** Aucune annonce, aucune notification, aucune commande
  pour s'y soustraire. Les soldes évoluent, c'est tout. Seuls les administrateurs en voient le
  détail, en éphémère.
- **La masse monétaire est conservée au point près.** Chaque membre reçoit un unique mouvement net
  (part reçue moins cotisation) : aucun solde ne plonge le temps du calcul, et le reste de la
  division entière est distribué au hasard plutôt que brûlé.
- **Les soldes négatifs ou nuls ne cotisent pas** mais touchent leur part : le pot est aussi une
  bouée.
- **L'échéance vit en base**, pas dans un cron. Le tick horaire (et un premier au démarrage) ne fait
  rien tant qu'elle n'est pas atteinte. La liste des membres se lit sur Discord d'abord : une panne
  de Discord laisse l'échéance intacte, le tick suivant réessaie. Puis une seule transaction
  revendique l'échéance, applique les mouvements et journalise le pot : une panne en cours de route
  défait tout, et un pot qui a payé ne se rejoue jamais. La suivante se calcule **à partir de
  l'ancienne** : aucune dérive, et une panne de trois semaines donne un seul pot de rattrapage, pas
  trois. Un pot vide (personne n'a de quoi cotiser) consomme l'échéance.
- **Réglages** (modifiables à chaud via `/admin config`) : `redistribution.enabled`,
  `redistribution.intervalHours` (168 par défaut), `redistribution.contributionPercent` (5, borné
  entre 0 et 100 — une faute de frappe y serait irréversible).

## Paris

`/bet question option1 option2 [option3…5]` ouvre un pari classique, `/estimate question` un pari
d'estimation (le plus proche gagne). La réponse à la commande est le message du pari, posté dans le
salon et qui appelle le rôle des paris (`bet_role_id` dans `instance.toml`, `DISCORD_BET_ROLE_ID` en
v1 ; absent, personne n'est appelé).

- **Miser** : un bouton par option ouvre une modale (le solde y est rappelé). On mise sur une seule
  option et l'on peut y rajouter des points, jamais changer de camp ; le créateur ne parie pas sur son
  propre pari. Une estimation se modifie tant que le pari est ouvert : seule la différence de mise est
  débitée, ou remboursée si elle baisse. Le message montre en direct la part de chaque option (ou la
  liste des estimations).
- **Saisie** : un nombre entier, les espaces sont ignorées (« 1 000 » vaut mille). La v1 s'arrêtait
  au premier blanc et misait 1 point ; « 12abc » ou « 1e3 », qu'elle lisait 12 et 1, sont refusés.
- **Terminer** (créateur seul, « Déclarer le résultat ») : pour un pari classique, un menu propose
  l'option gagnante, la clôture des mises (le résultat viendra plus tard) ou l'annulation (chacun est
  remboursé) ; pour une estimation, une modale demande la bonne réponse. Le résultat est publié dans le
  salon du pari.
- **Gains** : les gagnants (l'option gagnante, ou les estimations les plus proches, ex æquo compris)
  se partagent toute la cagnotte au prorata de leur mise, arrondi vers le bas ; ce que la division
  laisse, et toute la cagnotte quand personne n'a gagné, revient à la banque. Le calcul est entier et
  exact : la v1, en flottant, perdait un point quand une part tombait juste (29 et 71 points seuls sur
  l'option gagnante recevaient 28 et 71).
- **Une seule fin** : annuler ou résoudre revendique le pari dans la transaction qui rembourse ou
  paie. Deux résolutions croisées (deux menus ouverts, une modale envoyée deux fois) ne paient jamais
  deux fois : la seconde répond « Ce pari vient d'être terminé. ». Une modale de mise envoyée après la
  clôture ne prend rien.
- **`/betstats [user]`** : total misé et plus gros gain d'un membre, volume misé et record du serveur,
  pour l'année en cours (la base de stats bascule au 1er janvier, comme en v1). Une mise compte à la
  résolution du pari, pas à l'annulation.
- Un pari ouvert à la bascule garde son message v1 : ses boutons marchent, mais le message n'est plus
  réécrit (une modification ne fait pas passer un message existant aux composants v2) ; son résultat
  est publié.

## Journal des points

Chaque mouvement de solde laisse une ligne dans `points_log` (dresseur, mouvement, solde après,
origine, date) : messages, paris, lancers, parc, évolutions, pot commun, `/admin points`. Une seule
fonction du code bouge un solde, et elle écrit le journal dans la transaction du mouvement : aucun
chemin ne peut l'oublier, et un mouvement annulé n'y laisse rien. L'historique de la v1 y est repris
par `pcr migrate-v1`, sous l'origine `v1`.

Le journal alimente la [courbe des points](site.md#administration) de la page Admin du site.
