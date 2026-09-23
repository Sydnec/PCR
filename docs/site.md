[← README](../README.md)

# 🖥️ Site web

Première ébauche de l'interface web du jeu Pokémon, sur **pokepcr.simonbourlier.fr**. Il suffit de
se connecter avec son compte Discord ; seuls les membres du serveur entrent. `/pk web` en donne le
lien, en réponse privée (ou dit que le site n'est pas en ligne).

| Page | Contenu |
|---|---|
| **Capture** (accueil) | Le Pokémon qui apparaît dans le salon Discord, en direct, avec son sexe et ses balls juste en dessous : rareté, types et difficulté en couleur, chances par ball, ton solde et tes balls en poche, et sa lignée avec ce que tu en possèdes (la fiche du bouton « Infos du Pokémon »). Une ball hors de portée est grisée, sauf si tu en as en poche. Le journal des lancers est sur le côté. On lui **lance ses balls** comme depuis Discord, et on **ramasse** ce qu'un Pokémon laisse tomber. En haut, le bouton du **parc safari**. |
| **Parc safari** | La visite du parc, ouverte depuis la Capture : la rencontre, ses chances et le risque qu'elle détale, et les trois actions de Discord (Safari Ball, appât, fuite). Tes prises s'affichent sur le côté, et le bilan à la fin. |
| **Boîte** | Ton PC : des boîtes de cases où tu ranges tes Pokémon comme tu veux. Une case ne montre que le sprite ; un clic ouvre la fiche (provenance, place, lignée, valeur), d'où l'on **surnomme**, **déplace**, **revend** ou **fait évoluer** le Pokémon. |
| **Pokédex** | Toutes les espèces des générations ouvertes, celles qu'on possède en couleur. La fiche d'une espèce montre sa lignée et ce que tu en possèdes. |
| **Sac** | Le solde et les objets. |
| **Œuf** | L'œuf qui couve, ou le formulaire pour en **pondre** un. |

Le site ne fait rien que Discord ne fasse pas : tout reste faisable avec `/pk`, sauf le rangement
du PC (places, noms des boîtes, surnoms), réservé au site parce qu'il ne change rien au jeu. Il ne
gère pas encore les échanges, la loterie ni les objets d'aide aux fusions (bonbons, pierres), qui
se font sur Discord.

## Capture

C'est **la même apparition** que dans le salon, et la même course : un lancer du site passe par
le même chemin que les boutons Discord. Même prix, balls offertes utilisées d'abord, même
cooldown (alterner Discord et le site ne fait pas lancer plus vite), et un seul vainqueur quelle
que soit la porte. L'annonce du salon suit : le journal des lancers et la capture s'y affichent
comme d'habitude. La Master Ball demande une confirmation, comme sur Discord.

La page relit l'apparition toutes les `web.spawnRefreshSeconds` (5 par défaut), seulement quand
elle est ouverte et visible. Les apparitions naissent toujours de l'activité du salon Discord.

## Parc safari

Le bouton en haut de la Capture fait ce que fait `/pk safari` :

- une visite en cours se **reprend** ;
- un parc ouvert (l'événement public, ou un parc qui t'est réservé) s'**entre gratuitement**,
  comme avec le bouton de son message ;
- sinon, il propose d'**acheter une entrée**, après confirmation : avec un Ticket Safari s'il y en
  a un dans le sac, sinon avec des points. Il est grisé quand le solde ne suffit pas, ou pendant
  le délai entre deux entrées achetées.

La visite est **la même** que sur Discord : une visite commencée sur le site se reprend avec
`/pk safari`, et inversement. Chaque action passe par le même chemin que les boutons, avec le même
jeton : un double clic ne joue qu'une fois, et une action déjà jouée ailleurs est refusée. Le
partage du bilan dans un salon reste sur Discord.

## Boîte PC

Des boîtes de `pokemon.pc.slotsPerBox` cases (30), sur `columns` colonnes (6). Il y en a au moins
`minBoxes` (8), et toujours une vide après la dernière occupée, jusqu'à `maxBoxes` (60).

- **Ranger** : glisser un Pokémon sur une case, ou choisir « Déplacer » dans sa fiche puis
  toucher la case voulue (au doigt, le glisser-déposer n'existe pas). Sur une case occupée, les
  deux échangent leur place. Glisser sur une flèche change de boîte.
- **Nommer une boîte** : un clic sur son nom (`boxNameLength` caractères, 20) ; vide, elle reprend
  son nom par défaut.
- **Surnommer un Pokémon** depuis sa fiche (`nicknameLength` caractères, 12) ; vide, il reprend le
  nom de son espèce.

Un Pokémon garde sa place et son surnom quand il évolue. Reçu en échange, il garde son surnom et
prend la première case libre ; une capture ou une éclosion aussi. Le Pokédex ouvre la boîte sur
une espèce (`/boite?species=25`) et en surligne les exemplaires.

## Fonctionnement

- Des fichiers statiques dans `web/`, sans compilation ni dépendance : `git pull` le met à jour en
  même temps que le bot.
- C'est le bot qui les sert, sur le port de l'API : tout ce qui n'est pas sous `/api/` vient de
  `web/`, et une adresse de page (`/boite`, `/pokedex`…) renvoie `index.html`.
- Aucune règle de jeu dans le site : il affiche ce que renvoie l'[API](api.md) et lui confie
  chaque action, avec les mêmes refus que les commandes.
- Des images plutôt que des emojis : sprites et objets de PokéAPI (le nom de l'image d'un objet
  est son `sprite` dans la configuration), pictogrammes dessinés en SVG. Seuls les emoji du
  serveur Discord (les balls) restent des emoji.
- Politique de sécurité stricte : seuls les scripts et styles du site s'exécutent. Les images
  viennent du dépôt de sprites de PokéAPI et du CDN de Discord (avatars, emoji des balls). Aucun
  HTML n'est injecté : un pseudo ne peut rien exécuter.

## Mise en ligne

```
Navigateur → Cloudflare → VM cloudflared → VM Nginx Proxy Manager → VM du bot (WEB_PORT)
```

1. **Discord** (portail développeur → OAuth2) : noter le *Client Secret* et ajouter la redirection
   `https://pokepcr.simonbourlier.fr/api/auth/callback`.
2. **VM du bot**, dans `.env` :
   ```
   WEB_PORT=8787
   WEB_HOST=<IP locale de la VM du bot>
   WEB_BASE_URL=https://pokepcr.simonbourlier.fr
   DISCORD_CLIENT_SECRET=<Client Secret>
   WEB_SESSION_SECRET=<openssl rand -hex 32>
   ```
   `WEB_HOST` est indispensable ici : par défaut, le serveur n'écoute que la machine elle-même, et
   Nginx Proxy Manager est sur une autre. Redémarrer ensuite le bot.
   Ouvrir ce port **à la seule VM du proxy** (avec ufw, par exemple :
   `sudo ufw allow from <IP de la VM NPM> to any port 8787 proto tcp`).
3. **Nginx Proxy Manager**, un *Proxy Host* :
   - *Domain* `pokepcr.simonbourlier.fr` ;
   - *Scheme* `http`, *Forward* `<IP de la VM du bot>` : `8787` ;
   - pas de *Force SSL* si cloudflared parle en HTTP au proxy : Cloudflare s'occupe du HTTPS, et
     les deux redirections tourneraient en boucle.
4. **cloudflared**, un *Public hostname* : `pokepcr.simonbourlier.fr` vers
   `http://<IP de la VM NPM>:80`. N'exposer que ce nom, jamais l'administration de NPM (port 81).
5. **Cloudflare** : activer *Always Use HTTPS* et désactiver *Rocket Loader*, qui injecte un
   script que la politique de sécurité du site bloque. Aucune règle de cache à ajouter : le site
   se revalide à chaque visite, l'API répond `no-store`.

Pour vérifier : `https://pokepcr.simonbourlier.fr/api/health` répond `{"ok":true,…}`.

## Sécurité du montage

- L'API ne se fie à aucun en-tête du proxy (ni IP ni `X-Forwarded-*`) : tout passe par la
  connexion Discord et le cookie signé. Atteindre le port en direct ne donne rien de plus que le
  site. Le pare-feu le réserve quand même au proxy.
- Entre le proxy et le bot, le trafic passe en HTTP sur le réseau local, cookie de session
  compris. C'est acceptable sur un réseau de confiance ; sinon, isoler les VM dans un VLAN.
- Cloudflare déchiffre le trafic, c'est le principe du tunnel. En échange, aucun port entrant
  n'est ouvert.
