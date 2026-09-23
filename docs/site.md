[← README](../README.md)

# 🖥️ Site web

Première ébauche de l'interface web du jeu Pokémon, sur **pokepcr.simonbourlier.fr**. Il suffit de
se connecter avec son compte Discord ; seuls les membres du serveur entrent.

| Page | Contenu |
|---|---|
| **Capture** (accueil) | Le Pokémon qui apparaît dans le salon Discord, en direct : ses chances par ball, ce que tu en as déjà, le journal des lancers. On lui **lance ses balls** comme depuis Discord, et on **ramasse** ce qu'un Pokémon laisse tomber. |
| **Boîte** | Chaque Pokémon avec son numéro, filtrable par espèce, sexe, fertilité et shiny. Sa fiche permet de le **revendre** ou de le **faire évoluer**. |
| **Pokédex** | Toutes les espèces des générations ouvertes, celles qu'on possède en couleur. La fiche d'une espèce montre sa lignée. |
| **Sac** | Le solde et les objets. |
| **Œuf** | L'œuf qui couve, ou le formulaire pour en **pondre** un. |

Le site ne fait rien que Discord ne fasse pas : tout reste faisable avec `/pk`. Il ne gère pas
encore les échanges, la loterie, le safari ni les objets d'aide aux fusions (bonbons, pierres),
qui se font sur Discord.

## Capture

C'est **la même apparition** que dans le salon, et la même course : un lancer du site passe par
le même chemin que les boutons Discord. Même prix, balls offertes utilisées d'abord, même
cooldown (alterner Discord et le site ne fait pas lancer plus vite), et un seul vainqueur quelle
que soit la porte. L'annonce du salon suit : le journal des lancers et la capture s'y affichent
comme d'habitude. La Master Ball demande une confirmation, comme sur Discord.

La page relit l'apparition toutes les `web.spawnRefreshSeconds` (5 par défaut), seulement quand
elle est ouverte et visible. Les apparitions naissent toujours de l'activité du salon Discord.

## Fonctionnement

- Des fichiers statiques dans `web/`, sans compilation ni dépendance : `git pull` le met à jour en
  même temps que le bot.
- C'est le bot qui les sert, sur le port de l'API : tout ce qui n'est pas sous `/api/` vient de
  `web/`, et une adresse de page (`/boite`, `/pokedex`…) renvoie `index.html`.
- Aucune règle de jeu dans le site : il affiche ce que renvoie l'[API](api.md) et lui confie
  chaque action, avec les mêmes refus que les commandes.
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
