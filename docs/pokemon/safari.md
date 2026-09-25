[← Pokémon](README.md)

# 🏕️ Parc Safari

Contrepoids du puits à points : le pool naturel rend les évolutions et les légendaires plus rares
(poids 70/60/25 par stade, 8 pour un légendaire), et le parc **compense ce malus** le temps d'une
visite. C'est le seul contenu Pokémon où les actions ne coûtent rien.

- **Ouverture aléatoire** : un tirage horaire (4 % par heure) annonce le parc dans le salon des
  apparitions, rôle Dresseur mentionné. Un délai minimum de 24 h sépare deux parcs, soit environ un
  parc tous les deux jours. Le bouton reste cliquable **24 h**, mais les **apparitions ne sont
  suspendues que 4 h** — le temps que l'événement respire sans figer le salon pour la journée.
- **Une visite par dresseur**, et tout se passe en message privé : le bouton est public, la partie
  ne l'est pas.
- **25 actions**, gratuites, à répartir entre trois gestes :
  - 🟢 **Safari Ball** (×1,5) — tenter la capture. Un raté peut faire détaler le Pokémon.
  - 🍎 **Appâter** — ×2 sur les chances de capture, cumulable jusqu'à ×4 : deux appâts atteignent le
    plafond, le bouton se ferme ensuite plutôt que de laisser gaspiller une action. **Mais la baie
    le met sur ses gardes** : sa chance de détaler passe de 5 % à 8 % puis 11 %, et elle est tirée
    aussi bien après un lancer raté qu'au moment où il avale la baie. Appâter reste nettement
    rentable — deux appâts font passer un stade 3 de 2,2 à 3,9 captures pour 25 actions — mais ce
    n'est plus gratuit.
  - 🏃 **Essayer de fuir** — passer au Pokémon suivant, avec 10 % de chances d'échouer.
- **« Il te manque ? »** : chaque rencontre affiche si le dresseur possède déjà l'espèce, shiny ou
  non — et signale un premier shiny. Le message étant privé, l'information tient dans l'embed, là où les
  apparitions publiques ont besoin d'un bouton pour répondre à chacun séparément.
- **Raretés compensées** : poids 50/60/40 par stade et 24 pour un légendaire — les stades 1 y pèsent
  moins qu'à l'état sauvage, les stades 3 (les *rares*) ×1,6, les légendaires ×3 —, shiny 1/250 au
  lieu de 1/500. En 1ʳᵉ génération, les rares passent de 3,4 % à 6,3 % du pool et les légendaires de
  0,45 % à 1,6 %. Les évolutions par échange ou par objet et les bébés restent hors pool, comme à
  l'état sauvage.
- **Dès la 2ᵉ génération, on choisit ce qu'on vise.** Entrer (parc offert comme entrée payante)
  demande d'abord quelles générations on cible : un menu sur Discord, des bascules sur le site, qui
  disent combien d'espèces chacune fait croiser. Toutes sont cochées au départ, il en faut au moins
  une, et les rencontres de la visite ne viennent que d'elles, raretés compensées comprises. Le
  choix est gardé sur la visite : une reprise, de Discord comme du site, le conserve. Tant qu'une
  seule génération est ouverte, l'entrée reste directe.
- **Une visite dure autant que le parc** : elle expire à la fermeture des grilles, avec un
  plancher d'une heure pour qui entre juste avant — 25 actions ne se jouent pas en dix minutes.
- **La visite se reprend** : l'éphémère se ferme d'un geste et personne ne peut le rouvrir à la
  place de son destinataire. Le bouton *« Entrer dans le parc »* le refait donc, avec la partie là
  où elle en était, et `/pk safari` fait de même — y compris une fois le parc fermé, quand son message
  n'a plus de bouton mais que la session court encore. Aucune action perdue, aucun point débité.
- **Entrée payante** : `/pk safari` ouvre une visite hors événement pour **5 000 points**, avec un
  cooldown de 12 h. Si un parc gratuit attend le dresseur, la commande le lui dit au lieu de
  débiter. Sans parc derrière elle, cette visite-là dure le plancher : une heure.
- **Partage du bilan** : la visite est privée de bout en bout, donc son bilan aussi. Un bouton
  **« 📤 Partager mon bilan »** le publie dans le salon courant, signé du dresseur et de son avatar.
  Une fois par visite — le verrou est en base, pas dans la disparition du bouton — et à la seule
  condition que **le bot** puisse y publier un embed : c'est lui qui poste, et exiger la même chose
  du dresseur revenait à lui refuser un bouton qu'on lui avait mis sous les yeux. Un envoi qui
  échoue rend le droit de réessayer.
- Tout l'état vit en base : les boutons répondent encore après un redémarrage du bot, et un
  double-clic ne peut pas jouer deux fois la même action.
- **Sur le site** aussi, depuis l'onglet Capture : reprendre sa visite, entrer dans un parc ouvert
  ou acheter une entrée, puis jouer. C'est la même visite, qui se reprend d'un côté à l'autre (voir
  [le site](../site.md#parc-safari)).
