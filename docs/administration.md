[← README](../README.md)

# 🛡️ Modération & Administration

- `/autodel` : configuration de la suppression automatique des messages dans un salon.
- `/edit` : permet au bot d'éditer un de ses propres messages. Ouverte à l'auteur du sondage comme
  aux administrateurs, elle reste donc hors de `/admin`.
- **`/admin`** : toutes les commandes d'administration sont regroupées sous une commande unique, que
  Discord masque aux non-administrateurs (`setDefaultMemberPermissions`). Le masquage n'est que du
  confort — un serveur peut rouvrir la permission — et la vérification faite à l'exécution, écrite
  une seule fois dans le routeur, fait foi. Toutes les réponses sont privées.
  - `/admin points <cible> <montant>` : crédite, ou débite avec un montant négatif. La **cible** est
    un dresseur, ou un **rôle** pour servir d'un coup tous ceux qui le portent — `@everyone` pour
    tout le serveur, les bots toujours exclus. Pour un dresseur, la réponse rappelle l'ancien et le
    nouveau solde ; un solde négatif est autorisé — il bloque les achats jusqu'à ce qu'il remonte —
    et signalé comme tel. Pour un rôle, elle donne le nombre de bénéficiaires et le total distribué,
    en une seule transaction.
  - `/admin item <cible> <objet> [quantite]` : donne un objet, ou le retire avec une quantité
    négative, à un dresseur ou à tout un rôle, comme `/admin points`. Contrairement aux points, le
    retrait a un plancher : un inventaire ne descend pas sous zéro. Sur un dresseur, la commande
    refuse plutôt que de creuser ; sur un rôle, elle épargne ceux qui n'en ont pas assez et les
    compte.
  - `/admin config <cle> <valeur>` : modifie un réglage **à chaud**, sans redémarrage (voir
    [Configuration](configuration.md)). L'autocomplétion propose les chemins avec leur
    valeur courante et leur type ; le type attendu vient de la valeur par défaut, une clé hors
    schéma est refusée, les réglages dangereux sont bornés, et l'écriture est atomique (fichier
    temporaire relu puis renommé) pour que le bot n'en voie jamais une version tronquée.
  - `/admin poids [table]` : convertit les poids de tirage en probabilités réelles — apparitions
    sauvages, rencontres du parc, butin des Pokémon. Un poids n'est pas un pourcentage mais une part
    d'un total qui bouge à chaque ligne ajoutée, et la table se construit avec les **mêmes**
    fonctions que les tirages : elle ne peut pas diverger de ce qu'elle décrit.
  - `/admin config-voir [cle]` : valeur courante face à la valeur par défaut. Sans clé, le fichier
    entier.
  - `/admin potcommun [simulation]` : déclenche un pot commun hors calendrier, ou simule le
    prochain sans toucher aux soldes. L'échéance hebdomadaire n'en est pas décalée.
  - `/admin purge [lien] [nombre]` : suppression de messages en masse.
  - `/admin pokespawn [espece] [shiny] [annonce] [ping]` : déclenche une apparition (voir [Pokémon](pokemon/README.md)).
  - `/admin safarispawn [joueur] [pause]` : ouvre un parc safari (voir [Parc Safari](pokemon/safari.md)).
  - `/admin restart` : redémarre le bot.
