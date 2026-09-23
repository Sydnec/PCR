[← README](../README.md)

# ⚙️ Configuration en trois couches

Les réglages se lisent en empilant trois sources, chacune écrasant la précédente :

1. **`DEFAULTS`** (`modules/config.js`) — le schéma. Une clé qui n'y figure pas n'existe pas, et le
   type de sa valeur par défaut impose celui qu'on peut écrire. Il sert aussi de repli : un fichier
   illisible ne fait jamais tomber le bot.
2. **`config.json`** — le réglage versionné, celui qu'on décide en revue de code.
3. **`config.local.json`** — ce qu'écrit `/admin config` depuis Discord (ou l'[administration du
   site](site.md#administration)), **ignoré par git**.

La troisième couche n'est pas un détail d'implémentation. `config.json` est suivi par git, et le
déploiement enchaîne `git checkout main && git pull` sous `set -e` : une commande qui écrirait
dedans laisserait le serveur avec un fichier suivi modifié, ferait échouer le déploiement suivant et
bloquerait `pcr release`, qui refuse de partir d'un arbre sale. La surcharge locale règle le
problème sans rien perdre : la propriété « clé absente = valeur de la couche du dessous » tient à
chaque étage, donc supprimer `config.local.json` revient exactement à revenir au réglage versionné.

Tout est relu à chaque accès : une modification prend effet immédiatement, sans redémarrage.
