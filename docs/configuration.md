[← README](../README.md)

# ⚙️ Configuration en deux couches

Les réglages se lisent en empilant deux sources, la seconde écrasant la première :

1. **`DEFAULTS`** (`modules/config.js`) — **toutes les valeurs de base**, décidées en revue de code.
   C'est aussi le schéma : une clé qui n'y figure pas n'existe pas, et le type de sa valeur par
   défaut impose celui qu'on peut écrire. Il sert enfin de repli : un fichier illisible ne fait
   jamais tomber le bot.
2. **`config.json`** — les ajustements à chaud : ce qu'écrit `/admin config` depuis Discord (ou
   l'[administration du site](site.md#administration)). **Ignoré par git**, et absent tant que
   personne n'a rien réglé.

Un ajustement durable se décide donc dans le code, en changeant la valeur de `DEFAULTS` ; un
ajustement du moment se fait à chaud, sans release. Supprimer `config.json` revient exactement aux
valeurs du code : la propriété « clé absente = valeur de la couche du dessous » tient à chaque étage.

`config.json` est hors de git pour une raison de déploiement : le serveur enchaîne
`git checkout main && git pull` sous `set -e`, et une commande qui écrirait dans un fichier suivi
laisserait le serveur avec un arbre modifié, ferait échouer le déploiement suivant et bloquerait
`pcr release`, qui refuse de partir d'un arbre sale.

**Migration.** Le fichier des réglages à chaud s'appelait `config.local.json`, et `config.json` était
le réglage versionné. Au premier démarrage, s'il existe encore, `config.local.json` est repris comme
`config.json` : aucun réglage posé depuis Discord ne se perd.

Tout est relu à chaque accès : une modification prend effet immédiatement, sans redémarrage.
