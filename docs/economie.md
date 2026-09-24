[← README](../README.md)

# 💰 Économie & Pot commun

Les points se gagnent au fil des messages (`messagePointsDistribution` : les premiers de la journée
rapportent plus) et se dépensent dans les paris, les Pokémon et le parc safari.

**Le pot commun** corrige ce que cette économie a de cumulatif. Une fois par semaine, chacun cotise
un pourcentage de sa fortune et la cagnotte repart en **parts égales** entre tous les porteurs de
`DEFAULT_ROLE_ID` — un impôt sur le capital : les gros soldes financent, tout le monde reçoit la
même chose.

- **Obligatoire, automatique et silencieux.** Aucune annonce, aucune notification, aucune commande
  pour s'y soustraire. Les soldes évoluent, c'est tout. Seuls les administrateurs en voient le
  détail, en éphémère.
- **La masse monétaire est conservée au point près.** Chaque membre reçoit un unique mouvement net
  (part reçue moins cotisation) : aucun solde ne plonge le temps du calcul, et le reste de la
  division entière est distribué au hasard plutôt que brûlé.
- **Les soldes négatifs ou nuls ne cotisent pas** mais touchent leur part : le pot est aussi une
  bouée.
- **L'échéance vit en base**, pas dans un cron. Le tick horaire ne fait rien tant qu'elle n'est pas
  atteinte, la revendique par un `UPDATE` gardé (deux ticks simultanés ne peuvent pas déclencher
  deux pots), et calcule la suivante **à partir de l'ancienne** : aucune dérive, et une panne de
  trois semaines donne un seul pot de rattrapage, pas trois.
- **Réglages** (modifiables à chaud via `/admin config`) : `redistribution.enabled`,
  `redistribution.intervalHours` (168 par défaut), `redistribution.contributionPercent` (5, borné
  entre 0 et 100 — une faute de frappe y serait irréversible).

## Journal des points

Chaque mouvement de solde laisse une ligne dans `points_log` (dresseur, mouvement, solde après,
date) : messages, paris, lancers, parc, évolutions, pot commun, `/admin points`. Ce sont des
déclencheurs SQLite sur la table des points qui l'écrivent, dans la transaction du mouvement : aucun
chemin ne peut l'oublier, et un mouvement annulé n'y laisse rien. Les soldes d'avant le journal y
entrent d'une ligne de départ, au premier démarrage.

Le journal alimente la [courbe des points](site.md#administration) de la page Admin du site.
