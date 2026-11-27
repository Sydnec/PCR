# Parité v1 → v2

Checklist de la réécriture, **générée depuis le code v1** (`main` @ 97c987a, v1.22.1). Chaque PR coche
ce qu'elle porte. Le code v1 se relit avec `git show origin/main:<chemin>` (puis `v1-final` après la
bascule). À partir de P2 la v1 est gelée : tout correctif v1 ultérieur s'ajoute en section 9.

Légende : `[x]` porté en v2 · `~~barré~~` abandonné volontairement (avec la raison).

## 1. Commandes hors Pokémon

- ~~`/autodel lien [jours]` — Supprimera automatiquement votre message avec X jours.~~ (abandonnée : jamais utilisée)
- [x] `/bet question option1 option2 [option3] [option4] [option5]` — Créer un nouveau pari (la réponse est le message public du pari et appelle `bet_role_id` ; question limitée à 200 caractères et options à 76, ce qui faisait échouer la v1 ; voir les écarts en dessous)
- [x] `/betstats [user]` — Affiche les statistiques des paris (montants au format français ; le détenteur du record n'est nommé que s'il y a un record : à zéro, la v1 désignait n'importe qui)
- [x] `/birthday add date` — Enregistre (ou modifie) ta date d'anniversaire
- [x] `/birthday list` — Affiche les 10 prochains anniversaires du serveur
- [x] `/birthday remove` — Supprime ta date d'anniversaire
- [x] `/classement` — Affiche le classement des utilisateurs avec le plus de points (soldes au format français ; un compte que Discord ne retrouve plus est désigné par sa mention, sans notification, au lieu de son identifiant brut)
- [x] `/color hexa` — Changer la couleur de votre pseudo
- [x] `/cotd` — Affiche les saints du jour
- [x] `/ecaflip option1 [option2] [option3] [option4] [option5] [option6] [option7] [option8] [option9] [option10]` — Pile ou Face ?
- [x] `/edit message` — Modifie la question du sondage
- [x] `/estimate question` — Créer un nouveau pari d'estimation (Le plus proche gagne)
- [x] `/help` — Fourni la liste des commandes disponibles avec ce bot
- [x] `/join` — Rejoindre le fil de discussion actuel
- [x] `/mesrappels liste` — Voir la liste de tes rappels actifs
- [x] `/mesrappels supprimer id` — Supprimer un rappel
- [x] `/poll question [option1] [option2] [option3] [option4] [option5] [option6] [option7] [option8] [option9] [option10]` — Créer un sondage dans le channel #Sondage
- [x] `/randomizabaise` — Depuis le temps que vous l'attendiez celle là
- [x] `/rappel date [message]` — Créer un rappel qui te sera envoyé en DM
- [x] `/safe-place message` — Envoie un message anonymement dans la safe place
- [x] `/solde [user]` — Affiche le solde de points d'un utilisateur (solde, délai et balls en poche ; le rappel de loterie arrive en P5)
- [x] `/version` — Affiche la version actuelle du bot
- [x] `/week question [jour] [date_debut] [date_fin]` — Créer un sondage contenant les jours d'une période

Écarts assumés des paris (P3b, détail dans [economie.md](economie.md#paris)) :

- gains au quotient entier exact au lieu de `floor((mise / total gagnant) * cagnotte)` en flottant :
  même résultat sauf quand une part tombe juste, où la v1 perdait un point (valeurs de référence tirées
  du code v1 sous Node dans `pcr_core::bets`) ;
- saisie stricte : espaces ignorées (« 1 000 »), tout autre caractère refusé (`parseInt` lisait
  « 1 000 » comme 1, « 12abc » comme 12) ;
- l'envoi d'une modale de mise revérifie l'auteur et l'option (la v1 ajoutait une mise faite depuis une
  seconde modale à l'option de la première) ;
- réponses personnelles au tutoiement, montants au format français, messages en composants v2 (le
  créateur est mentionné, sans notification, au lieu de son pseudo en pied d'embed) ;
- le résultat d'une estimation ne répète plus la bonne réponse (« La réponse correcte était… » suivait
  « La bonne réponse était… ») ; un pari résolu garde son titre d'ouverture, sans boutons, comme en
  v1 quand il n'avait pas été clos avant ;
- un pari ouvert à la bascule garde son message v1 figé (boutons actifs, résultat publié).

Écarts assumés de la communauté (P3c, détail dans [communaute.md](communaute.md)) :

- les salons (`*_CHANNEL_ID`) passent dans `instance.toml`, les heures et durées codées en dur (ou en
  cron dans le `.env`) dans des réglages propres à la v2 : `reminders.maxDaysAhead`,
  `reminders.keepSentDays`, `week.maxDays`, `randomizabaise.shinyOdds`, `cotd.hour`, `advent.hour` ;
- dates en heure de Paris (`/rappel`, `/week`, `/birthday list`) ; une date qui n'existe pas est
  refusée par `/week` (la v1 glissait le 31/02 au 3 mars) ;
- un refus de `/rappel` se dit en privé (la v1 le publiait dans la réponse différée) ;
- vœux, saints et case de l'Avent manqués pendant un arrêt partent au démarrage, le jour même ; un
  envoi raté est retenté (la v1 perdait la journée) ; `/cotd` répond même quand le site est en panne ;
- `/poll` sans option refuse au lieu de rester sans réponse ; au-delà de dix lignes, les sondages sont
  numérotés 🇦…🇯 (la v1 écrivait « undefined ») ;
- un ship shiny demande trois membres (la v1 écrivait « <@undefined> ») ; le tirage est uniforme ;
- `/mesrappels liste` coupe une longue liste avec « … et N autres » (la v1 échouait au-delà de 25
  rappels) ; un MP de rappel refusé pour de bon (4xx) n'est pas relancé ; une tâche de calendrier
  rejouée ne reposte pas un message ou un fil de l'Avent déjà là ;
- messages en composants v2 ; les réponses personnelles déjà au tutoiement en v1 le restent ; le
  calendrier de l'Avent n'a ni catégorie ni image (aucune en v1), ses questions vivent dans
  `pcr_core::advent`.

Écarts assumés de l'administration et du salon (P3d, détail dans [administration.md](administration.md)
et [communaute.md](communaute.md)) :

- `/admin purge-membre` ne vérifie pas les droits avant de lire un salon : un salon illisible est cité
  comme ignoré (une fois, avec ses fils), une suppression refusée est comptée « impossible » ; les
  messages récents partent par lots d'une page ; le journal donne les totaux, et les attentes de
  Discord se mesurent à la durée des requêtes (twilight ne les annonce pas) ;
- `/admin purge` : `nombre` est un entier (la v1 acceptait un décimal, arrondi vers le bas) ;
- `/admin restart` s'arrête proprement (la v1 sortait du processus) ;
- `/color` ne supprime l'ancien rôle de couleur que si plus personne ne le porte ;
- les liens ne sont réécrits que dans les messages du serveur (la v1 échouait à supprimer l'original
  d'un MP) ; la traduction s'affiche en composants v2 (l'auteur en lien, la langue en pied) ;
- réactions comptées sur tous les messages (la v1 ne voyait que ceux arrivés depuis son démarrage) ;
  une session vocale à cheval sur le 1er janvier n'est pas mesurée (comme en v1) ;
- les rôles d'arrivée lisent les invitations à chaque connexion ; le rôle des membres temporaires et
  son invitation passent dans `instance.toml` ; les rôles du Charme Chroma (`guildMemberUpdate`)
  arrivent avec le jeu Pokémon (P5) ;
- `/version` garde le texte de la v1 et ajoute le commit, l'environnement et l'état de la base.

## 2. Pokémon : actions v1 → emplacement v2

Les règles ne changent pas ; `/pk` disparaît au profit du Centre Pokémon, de `/pokemon`, de `/pokedex` et du clic droit (plan, section 4 bis).

- [ ] `/pk pokedex [membre]` — Affiche la collection de Pokémon d'un dresseur → **/pokedex ; Centre › Pokédex ; clic droit › Pokédex**
- [ ] `/pk boite [pokemon] [membre]` — Tes Pokémon un par un : sexe, ball, date, fertilité → **Mon aventure › Boîte**
- [ ] `/pk doublons [membre] [pokemon] [evolutions]` — Les doublons d'un dresseur, ou qui a une espèce en double → **Mon aventure › Doublons**
- [ ] `/pk info pokemon` — Fiche d'un Pokémon : type, rareté, difficulté, sexes et lignée évolutive → **/pokedex <espèce>**
- [ ] `/pk classement` — Classement des meilleurs dresseurs → **Centre › Pokédex › Classement**
- [ ] `/pk evolution espece [individu]` — Fait évoluer un de tes Pokémon en sacrifiant d'autres exemplaires → **Fiche individu › Évoluer**
- [ ] `/pk echange [membre] [je_donne] [mon_individu] [je_recois]` — Propose un échange : Pokémon, points ou objets → **Centre › Échanges ; fiche individu ; clic droit › Échanger**
- [ ] `/pk comparer [membre] [pokemon] [evolutions]` — Les échanges qui complètent le Pokédex des deux dresseurs → **Clic droit › Comparer**
- [ ] `/pk oeuf pondre parent1 parent2` — Un mâle et une femelle d'une famille à bébé — Métamorph remplace l'un des deux → **Fiche individu › Pondre**
- [ ] `/pk oeuf voir` — Où en est ton œuf → **Mon aventure › Œuf**
- [ ] `/pk revendre pokemon espece [individu] [quantite]` — Revend des Pokémon — un de chaque espèce est toujours conservé → **Fiche individu / Doublons › Revendre**
- [ ] `/pk revendre objet objet [quantite]` — Revend un objet de ton inventaire → **Sac › Revendre**
- [ ] `/pk verrou espece individu` — Verrouille ou déverrouille un de tes Pokémon : verrouillé, il ne part jamais → **Fiche individu › Verrouiller**
- [ ] `/pk renommer espece individu [surnom]` — Donne un surnom à un de tes Pokémon, ou retire-le → **Fiche individu › Renommer**
- [ ] `/pk inventaire [membre]` — Affiche les objets que tu as trouvés → **Mon aventure › Sac**
- [ ] `/pk loterie` — Tente ta chance : un tirage par jour, un lot ou rien → **Centre › Loterie ; Mon aventure › Tenter**
- [ ] `/pk safari` — Paie l'entrée du parc safari : 25 actions gratuites et des raretés boostées → **Centre › Safari**
- [ ] `/pk vitrine voir [membre]` — Ta vitrine, ou celle d'un autre dresseur → **Mon aventure › Vitrine ; clic droit › Vitrine**
- [ ] `/pk vitrine ajouter espece individu [place]` — Expose un de tes Pokémon dans ta vitrine, ou change sa place → **Fiche individu › Vitrine**
- [ ] `/pk vitrine retirer pokemon` — Retire un Pokémon de ta vitrine → **Mon aventure › Vitrine**
- [ ] `/pk starter [pokemon]` — Ton starter de génération : choix et récompenses → **Mon aventure (starter)**
- [ ] `/pk boutique [ball] [quantite]` — Boutique des balls spéciales : catalogue et achat → **Centre › Boutique**
- [ ] `/pk pecher [canne]` — Lance ta ligne : un Pokémon rien que pour toi → **Centre › Pêcher**
- [ ] `/pk zarbis [membre]` — Les lettres de Zarbi réunies et celles qui manquent → **/pokedex Zarbi (lettres)**
- [ ] `/pk web` — Le lien du site PokéPCR : capture, parc safari, boîte PC… → **Bouton Site ↗**
- [ ] `/zarbi texte` — Écris un message en Zarbi, avec les lettres que tu as réunies → **inchangée**

Écarts assumés des apparitions (P4b, détail dans [pokemon/capture.md](pokemon/capture.md)) :

- plus de verrou `spawning` : la revendication, la fuite du Pokémon en place et la naissance du
  suivant tiennent dans une transaction de l'écrivain unique, et le message part après le commit (worker
  des messages publics). Un redémarrage au mauvais moment ne perd plus l'annonce (elle part au retour)
  et ne laisse plus d'apparition sans message à nettoyer au démarrage ;
- un Pokémon dont le message a disparu (constaté à sa réécriture suivante) s'enfuit au balayage d'après
  (la v1 ne le vérifiait qu'au démarrage) ; une apparition v1 sans échéance en reçoit une au premier
  balayage, d'après sa rareté ;
- l'annonce est un conteneur (composants v2) reconstruit depuis la base : le texte de l'administrateur
  et la mention des rôles vivent dans `pokemon_spawns` (`announcement`, `pings_role`) au lieu du
  message, les rubriques de l'embed deviennent des lignes, les prix des boutons suivent la config à
  chaque réécriture, et la mention disparaît à la fin comme le contenu v1. Un Pokémon apparu en v1 et
  encore là à la bascule garde son message v1, qui n'est plus réécrit (comme un pari) ;
- le salon, le rôle des dresseurs et ceux du Charme Chroma passent dans `instance.toml`
  (`pokemon_channel_id`, `pokemon_role_id`, `[discord.shiny_charm_role_ids]`) ; les messages privés
  ne comptent pas pour les apparitions, comme en v1 ;
- `/admin pokespawn` : plus de refus « un spawn est déjà en cours de création » (il n'y a plus de
  verrou) ; l'annonce est limitée à 1 000 caractères (un message en composants v2 en tient 4 000) ;
  une saisie qui n'est pas un numéro d'espèce (l'autocomplétion en donne un) est « Espèce inconnue » ;
  un tirage sans espèce possible est refusé au lieu d'annoncer un succès sans rien faire apparaître ;
- fiche « Infos » : une lecture ratée de la collection omet ses pastilles au lieu d'annoncer zéro ; la
  légende 🥚 ne cite plus `/pk oeuf pondre` (« Ne sort que d'un œuf, pondu par un couple de parents. ») ;
- jusqu'à P4c, les boutons de lancer répondent que les lancers ne sont pas ouverts ; jusqu'à P4d
  (objet au sol), un Pokémon qui s'enfuit emporte toujours son objet.

## 3. Administration (`/admin`)

- [x] `/admin points cible montant` — Donne (ou retire) des points à un dresseur ou à tout un rôle
- [ ] `/admin item cible objet [quantite]` — Donne (ou retire) un objet à un dresseur ou à tout un rôle
- [x] `/admin config cle valeur` — Modifie un réglage du bot, appliqué immédiatement
- [x] `/admin config-voir [cle]` — Affiche un réglage — ou une branche entière — et sa valeur par défaut
- [x] `/admin poids [table]` — Convertit les poids de tirage en probabilités réelles (P4a : composants v2, un tableau se poursuit dans un bloc « suite » quand le message dépasse 4 000 caractères, au lieu d'un champ de 1 024)
- [x] `/admin potcommun [simulation]` — Déclenche un pot commun immédiatement, ou simule le prochain (montants et taux au format français : « 2,5 % » au lieu de « 2.5 % »)
- [x] `/admin purge [lien] [nombre]` — Supprime des messages
- [x] `/admin purge-membre id` — Supprime tous les messages d'un membre sur le serveur, bilan en MP
- [x] `/admin pokespawn [espece] [shiny] [annonce] [ping]` — Déclenche l'apparition d'un Pokémon (événements) (voir les écarts des apparitions, section 2)
- [ ] `/admin safarispawn [joueur] [pause]` — Ouvre un parc safari (événement public, ou offert à un dresseur)
- [ ] `/admin saison` — Aperçu du bilan de la saison en cours (rien n'est publié ni enregistré)
- [x] `/admin restart` — Redémarre le bot
- [ ] `/admin recap-annuel apercu` — **nouveau** : aperçu du récap annuel

## 4. Identifiants de composants (`custom_id`) v1

Ceux posés sur des **messages publics** restent décodables en v2 (grammaire `action|arg|…`) :
spawn, objet au sol, offre d'échange, parc et partage safari, partage de vitrine, paris, rappel,
traduction. Ceux des panneaux éphémères sont remplacés par les panneaux `pk:` et répondent
« panneau expiré ».

- [x] `tweet_translate` (`tweet_translate|<tweet>`, inchangé)
- [x] `rappel` (`rappel|<ms>|<message encodé>` de la v1 ; la v2 renvoie au rappel d'origine, `rappel|<ms>|#<id>`, quand le message ne tient pas dans les 100 caractères d'un `custom_id`)
- [x] `bet_estimate_join` · `bet_estimate_modal` · `bet_estimate_resolve_submit` · `bet_join` · `bet_modal` · `bet_resolve_modal` · `bet_resolve_select` (`pcr_core::bets::Action` ; le message du pari que la v1 ajoutait aux deux derniers est ignoré)
- [x] `poke_owned` (`poke_owned|<apparition>` : la fiche de l'espèce, P4b ; `pcr_core::pokemon::spawn::Button`)
- [ ] `poke_throw` · `poke_special` (décodés depuis P4b, `pcr_core::pokemon::spawn::Button` ; le lancer arrive en P4c, d'ici là ils répondent que les lancers ne sont pas ouverts)
- [ ] `poke_box` · `poke_cmp` · `poke_cmpg` · `poke_cmpgo` · `poke_cmpn` · `poke_cmpr` · `poke_cmpt` · `poke_dex` · `poke_dexf` · `poke_dexs` · `poke_dext` · `poke_drop` · `poke_dup` · `poke_dupr` · `poke_dupsp` · `poke_dupspr` · `poke_evo` · `poke_evo_cancel` · `poke_evo_pick` · `poke_master` · `poke_master_cancel` · `poke_master_ok` · `poke_reback` · `poke_remaster` · `poke_respecial` · `poke_rethrow` · `poke_safari_bait` · `poke_safari_ball` · `poke_safari_cancel` · `poke_safari_enter` · `poke_safari_flee` · `poke_safari_gens` · `poke_safari_go` · `poke_safari_live` · `poke_safari_share` · `poke_showcase_share` · `poke_starter_no` · `poke_starter_ok` · `poke_td_back` · `poke_td_cancel` · `poke_td_find` · `poke_td_go` · `poke_td_ind` · `poke_td_kind` · `poke_td_pick` · `poke_td_pts` · `poke_td_side` · `poke_trade_accept` · `poke_trade_cancel` · `poke_trade_counter` · `poke_trade_decline` · `poke_trade_pick`

## 5. Minuteurs (désormais en heure de Paris, rattrapés via `job_runs`)

Tâches de calendrier : `pcr_app::jobs` (échéance quotidienne ou annuelle, rattrapée au démarrage tant que
sa période dure). Balayages (chaque minute, chaque heure) : boucles idempotentes par l'état en base.

- [x] Calendrier de l'Avent (`ADVENT_CRON_TIMER`, 1er–24 décembre ; heure `advent.hour`, rattrapée au démarrage dans la journée)
- [x] Saints et fêtes du jour (`COTD_CRON_TIMER` ; heure `cotd.hour`, retentés si le site ne répond pas)
- [x] Rappels échus envoyés en MP (chaque minute) ; purge des rappels envoyés depuis plus de 7 jours (`reminders.keepSentDays`)
- [x] Fuite des Pokémon (chaque minute ; aussi celle d'un Pokémon dont le message a disparu, et l'échéance d'une apparition v1 qui n'en avait pas)
- [x] Réparation des messages publics (toutes les 5 min, et au démarrage ; worker P2e, rendus par type avec leurs fonctionnalités) : lignes `public_messages` en retard dont `changed_at` tombe dans `repairWindowHours`, passé `repairGraceSeconds` (les vieux messages v1 restés sans fin n'y entrent pas)
- [ ] Éclosion des œufs (chaque minute)
- [ ] Ouverture des générations + récap de saison (chaque minute)
- [ ] Parc safari : balayage + tirage horaire (chaque heure)
- [x] Pot commun (échéance hebdomadaire, vérifiée chaque heure et au démarrage ; revendiquée dans la transaction du pot)
- [x] Anniversaires (à `birthday.hour`, heure de Paris ; rattrapés au démarrage dans la journée)
- [x] Au démarrage : message des rôles, annonce de version, nettoyage `voice_time` (à chaque connexion, avec les membres alors en vocal)
- [x] **Nouveau** : bascule de la base de stats au 1er janvier (chaque compteur va au fichier de l'année de Paris où il a eu lieu)
- [ ] **Nouveau** : récap annuel (P7)
- [ ] **Nouveau** : purge des sessions du site expirées (`web_sessions`)

## 6. Routes web (formes JSON v1 conservées)

- [ ] `GET /api/auth/login` · `GET /api/auth/callback` · `POST /api/auth/logout`
- [ ] `GET /api/health`
- [ ] `GET /api/me` (auth)
- [ ] `GET /api/species`
- [ ] `GET /api/catalogue`
- [ ] `GET /api/rules`
- [ ] `GET /api/species/:speciesId`
- [ ] `GET /api/me/lineage/:speciesId` (auth)
- [ ] `GET /api/users/:userId/pokedex` (auth)
- [ ] `GET /api/users/:userId/box` (auth)
- [ ] `GET /api/users/:userId/inventory` (auth)
- [ ] `GET /api/me/egg` (auth)
- [ ] `GET /api/me/egg/parents` (auth)
- [ ] `GET /api/species/:speciesId/evolution`
- [ ] `GET /api/spawn` (auth)
- [ ] `GET /api/safari` (auth)
- [ ] `GET /api/me/pc` (auth)
- [ ] `POST /api/safari/enter` (auth, write)
- [ ] `POST /api/safari/buy` (auth, write)
- [ ] `POST /api/safari/action` (auth, write)
- [ ] `POST /api/safari/share` (auth, write)
- [ ] `POST /api/safari/live` (auth, write)
- [ ] `POST /api/me/pc/move` (auth, write)
- [ ] `POST /api/me/pc/move-many` (auth, write)
- [ ] `POST /api/me/pc/boxes/:box/move` (auth, write)
- [ ] `POST /api/me/pc/boxes/:box/name` (auth, write)
- [ ] `POST /api/me/pc/boxes/:box/archive` (auth, write)
- [ ] `POST /api/me/pokemon/:pokemonId/lock` (auth, write)
- [ ] `GET /api/users/:userId/showcase` (auth)
- [ ] `GET /api/trainers` (auth)
- [ ] `POST /api/me/showcase` (auth, write)
- [ ] `POST /api/me/showcase/order` (auth, write)
- [ ] `POST /api/me/pokemon/:pokemonId/nickname` (auth, write)
- [ ] `POST /api/spawn/throw` (auth, write)
- [ ] `POST /api/fishing/cast` (auth, write)
- [ ] `GET /api/shop` (auth)
- [ ] `POST /api/shop/buy` (auth, write)
- [ ] `POST /api/drops/:dropId/claim` (auth, write)
- [ ] `POST /api/me/sell` (auth, write)
- [ ] `POST /api/me/sell-item` (auth, write)
- [ ] `POST /api/me/evolve` (auth, write)
- [ ] `POST /api/me/eggs` (auth, write)
- [ ] `GET /api/admin/config` (auth, admin)
- [ ] `GET /api/admin/points` (auth, admin)
- [ ] `POST /api/admin/config` (auth, write, admin)
- [ ] Vues SPA : `/`, `/capture`, `/safari`, `/boite`, `/pokedex`, `/sac`, `/boutique`, `/oeuf`, `/vitrine`, `/dresseurs`, `/infos`, `/admin`
- [ ] **Nouveau** : `GET /api/events` (SSE), polling conservé en secours

## 7. Clés de configuration (`DEFAULTS` v1 → GameConfig)

Toutes déclarées dans `crates/pcr-core/src/config/` avec les défauts v1 (test d'égalité avec le
`DEFAULTS` v1). `migrate-v1` reprend `config.json` tel quel dans `config_overrides` (chemins v1) ; une
surcharge que GameConfig refuse est ignorée, journalisée et signalée par `/admin config-voir`. Écarts
assumés : les compteurs, prix, minutes et heures sont des entiers (les poids de tirage, chances,
multiplicateurs et `throwCooldownSeconds` restent fractionnaires) ; une saisie vide ou hexadécimale
n'est plus prise pour un nombre ; « Chemin interdit. » disparaît (aucune pollution de prototype
possible en Rust) ; `pokemon.generation` est plafonné à la dernière génération des données d'espèces
(`data/pokemon.json`, converti par `build.rs` en P4a), comme en v1. Propre à la v2 : `messagePoints.cooldownMinutes` (60), la carence entre
deux messages récompensés que la v1 codait en dur.

- [x] `messagePointsDistribution` (7) : `1`, `2`, `3`, `4`, `5`, `6`, `default`
- [x] `pokemon` (3) : `enabled`, `generation`, `starterLines`
- [x] `pokemon.generationOpenings` (1) : `2`
- [x] `pokemon.spawn` (19) : `messagesPerSpawn`, `minDelayMinutes`, `minDelayAfterEndMinutes`, `fleeAfterMinutes.min`, `fleeAfterMinutes.max`, `legendaryFleeMultiplier`, `shinyOdds`, `weightsByStage.1`, `weightsByStage.2`, `weightsByStage.3`, `veryRareWeight`, `legendaryWeight`, `generationBoost`, `speciesFactors.201`, `pingRarities`, `throwLogSize`, `heldItemChance`, `itemDropChance`, `embedRefreshMs`
- [x] `pokemon.capture` (43) : `globalMultiplier`, `minCatchRate`, `throwCooldownSeconds`, `balls.poke.label`, `balls.poke.emoji`, `balls.poke.sprite`, `balls.poke.price`, `balls.poke.multiplier`, `balls.super.label`, `balls.super.emoji`, `balls.super.sprite`, `balls.super.price`, `balls.super.multiplier`, `balls.hyper.label`, `balls.hyper.emoji`, `balls.hyper.sprite`, `balls.hyper.price`, `balls.hyper.multiplier`, `balls.master.label`, `balls.master.emoji`, `balls.master.sprite`, `balls.master.price`, `balls.master.priceGrowth`, `balls.master.multiplier`, `balls.master.guaranteed`, `specialBalls.maxHeld`, `specialBalls.dailyLimit`, `specialBalls.appat.label`, `specialBalls.appat.emoji`, `specialBalls.appat.sprite`, `specialBalls.appat.price`, `specialBalls.appat.multiplier`, `specialBalls.appat.generation`, `specialBalls.appat.bonus.fished`, `specialBalls.appat.bonus.multiplier`, `specialBalls.catalyseur.label`, `specialBalls.catalyseur.emoji`, `specialBalls.catalyseur.sprite`, `specialBalls.catalyseur.price`, `specialBalls.catalyseur.multiplier`, `specialBalls.catalyseur.generation`, `specialBalls.catalyseur.bonus.item`, `specialBalls.catalyseur.bonus.multiplier`
- [x] `pokemon.evolution` (6) : `2.duplicates`, `2.points`, `3.duplicates`, `3.points`, `branchChoicePoints`, `dittosPerCopy`
- [x] `pokemon.trade` (2) : `expiryHours`, `draftMinutes`
- [x] `pokemon.lockByDefault` (2) : `shiny`, `legendary`
- [x] `pokemon.shinyCharm` (1) : `multiplier`
- [x] `pokemon.starters` (2) : `choices.2`, `rewards`
- [x] `pokemon.fishing` (3) : `generation`, `fleeSeconds`, `wildRarityFactor`
- [x] `pokemon.eggs` (5) : `enabled`, `hatchHours`, `hatchMessages`, `perDay`, `shinyParentMultiplier`
- [x] `pokemon.pokedex` (1) : `pageSize`
- [x] `pokemon.box` (1) : `pageSize`
- [x] `pokemon.showcase` (4) : `slots`, `shareCooldownMinutes`, `imageCell`, `imageTimeoutSeconds`
- [x] `pokemon.unownText` (4) : `maxLetters`, `lettersPerLine`, `imageCell`, `imageTimeoutSeconds`
- [x] `pokemon.pc` (6) : `slotsPerBox`, `columns`, `minBoxes`, `maxBoxes`, `boxNameLength`, `nicknameLength`
- [x] `pokemon.items` (129) : `ball_poke.ball`, `ball_poke.description`, `ball_poke.dropWeight`, `ball_poke.lotteryWeight`, `ball_poke.lot.min`, `ball_poke.lot.max`, `ball_super.ball`, `ball_super.description`, `ball_super.dropWeight`, `ball_super.lotteryWeight`, `ball_super.lot.min`, `ball_super.lot.max`, `super_bonbon.label`, `super_bonbon.emoji`, `super_bonbon.sprite`, `super_bonbon.description`, `super_bonbon.sellValue`, `super_bonbon.dropWeight`, `super_bonbon.evolution.copies`, `super_bonbon.evolution.quantity`, `super_bonbon.lot.min`, `super_bonbon.lot.max`, `ball_hyper.ball`, `ball_hyper.description`, `ball_hyper.dropWeight`, `ball_hyper.lot.min`, `ball_hyper.lot.max`, `evolyte.label`, `evolyte.emoji`, `evolyte.sprite`, `evolyte.description`, `evolyte.sellValue`, `evolyte.dropWeight`, `evolyte.evolution.copies`, `evolyte.evolution.quantity`, `evolyte.evolution.choose`, `evolyte.evolution.freePoints`, `pierre_soleil.label`, `pierre_soleil.emoji`, `pierre_soleil.sprite`, `pierre_soleil.description`, `pierre_soleil.sellValue`, `pierre_soleil.dropWeight`, `pierre_soleil.generation`, `pierre_soleil.evolution.copies`, `pierre_soleil.evolution.quantity`, `pierre_soleil.evolution.targets.44`, `roche_royale.label`, `roche_royale.emoji`, `roche_royale.sprite`, `roche_royale.description`, `roche_royale.sellValue`, `roche_royale.dropWeight`, `roche_royale.generation`, `roche_royale.evolution.copies`, `roche_royale.evolution.quantity`, `roche_royale.evolution.targets.61`, `roche_royale.evolution.targets.79`, `catalyseur.label`, `catalyseur.emoji`, `catalyseur.sprite`, `catalyseur.description`, `catalyseur.sellValue`, `catalyseur.dropWeight`, `catalyseur.generation`, `catalyseur.evolution.copies`, `catalyseur.evolution.quantity`, `catalyseur.evolution.targets.95`, `catalyseur.evolution.targets.117`, `catalyseur.evolution.targets.123`, `catalyseur.evolution.targets.137`, `pepite.label`, `pepite.emoji`, `pepite.sprite`, `pepite.description`, `pepite.sellValue`, `pepite.dropWeight`, `ticket_safari.label`, `ticket_safari.emoji`, `ticket_safari.sprite`, `ticket_safari.description`, `ticket_safari.dropWeight`, `ball_master.ball`, `ball_master.description`, `ball_master.lotteryWeight`, `ball_master.maxHeld`, `ball_master.overflowValue`, `canne.label`, `canne.emoji`, `canne.sprite`, `canne.description`, `canne.rod.pool`, `canne.rod.price`, `canne.rod.base`, `super_canne.label`, `super_canne.emoji`, `super_canne.sprite`, `super_canne.description`, `super_canne.dropWeight`, `super_canne.lotteryWeight`, `super_canne.lot.min`, `super_canne.lot.max`, `super_canne.maxHeld`, `super_canne.overflowValue`, `super_canne.upgradesTo`, `super_canne.rod.pool`, `super_canne.rod.price`, `mega_canne.label`, `mega_canne.emoji`, `mega_canne.sprite`, `mega_canne.description`, `mega_canne.dropWeight`, `mega_canne.lotteryWeight`, `mega_canne.lot.min`, `mega_canne.lot.max`, `mega_canne.maxHeld`, `mega_canne.overflowValue`, `mega_canne.rod.pool`, `mega_canne.rod.price`, `charme_chroma_1.label`, `charme_chroma_1.emoji`, `charme_chroma_1.sprite`, `charme_chroma_1.description`, `charme_chroma_1.charm.generation`, `charme_chroma_2.label`, `charme_chroma_2.emoji`, `charme_chroma_2.sprite`, `charme_chroma_2.description`, `charme_chroma_2.charm.generation`
- [x] `pokemon.sell` (5) : `byRarity.COMMUN`, `byRarity.PEU_COMMUN`, `byRarity.RARE`, `byRarity.TRES_RARE`, `shinyMultiplier`
- [x] `pokemon.lottery` (3) : `enabled`, `winChance`, `lotDecay`
- [x] `pokemon.safari` (28) : `enabled`, `randomChancePerHour`, `minHoursBetweenParks`, `parkDurationHours`, `spawnPauseHours`, `sessionMinDurationMinutes`, `actionsPerSession`, `liveRecentActions`, `liveRefreshMs`, `liveSettleMs`, `entryPrice`, `entryCooldownHours`, `ball.label`, `ball.emoji`, `ball.sprite`, `ball.multiplier`, `baitMultiplier`, `baitMaxMultiplier`, `fleeFailChance`, `wildFleeChance`, `wildFleeChancePerBait`, `shinyOdds`, `weightsByStage.1`, `weightsByStage.2`, `weightsByStage.3`, `veryRareWeight`, `legendaryWeight`, `speciesFactors.201`
- [x] `pokemon.seasonRecap` (10) : `enabled`, `topSize`, `podiumSize`, `minThrowsForLuck`, `minLotteryDraws`, `minSpawnsForFleeRate`, `publishWithinHours`, `retryMinutes`, `recordRetries`, `recordRetryDelayMs`
- [x] `web` (4) : `sessionHours`, `writesPerMinute`, `accessDenialCacheSeconds`, `spawnRefreshSeconds`
- [x] `publicMessages` (4) : `retries`, `retryDelayMs`, `repairGraceSeconds`, `repairWindowHours`
- [x] `links` (4) : `translation.enabled`, `translation.lookupTimeoutSeconds`, `translation.translateTimeoutSeconds`, `translation.maxTweets`
- [x] `redistribution` (3) : `enabled`, `intervalHours`, `contributionPercent`
- [x] `purgeMember` (3) : `concurrency`, `progressLogSeconds`, `rateLimitLogSeconds`
- [x] `birthday` (3) : `enabled`, `hour`, `message`
- [x] **Propres à la v2** : `reminders` (`maxDaysAhead`, `keepSentDays`), `week` (`maxDays`), `randomizabaise` (`shinyOdds`), `cotd` (`hour`), `advent` (`hour`)

## 8. Tables v1 → v2

Schéma : `crates/pcr-db/migrations/{game,stats}/0001_init.sql`. Conversion : `pcr migrate-v1`
(`crates/pcr-db/src/migrate_v1/`), contre le schéma v1 gelé à v1.22.1 (`v1_points.sql`, `v1_botdata.sql`).

`pcr.db` (persistante) :

- [x] `bet_options` · `bet_participations` · `bets` · `birthdays` · `economy_state` · `points` · `points_log` · `points_redistributions` · `pokemon_ball_units` · `pokemon_drops` · `pokemon_eggs` · `pokemon_fusions` · `pokemon_generations` · `pokemon_inventory` · `pokemon_item_log` · `pokemon_lottery` · `pokemon_lottery_draws` · `pokemon_owned` · `pokemon_pc_boxes` · `pokemon_safari_catches` · `pokemon_safari_events` · `pokemon_safari_parks` · `pokemon_safari_sessions` · `pokemon_sales` · `pokemon_season_recaps` · `pokemon_shop_daily` · `pokemon_shop_purchases` · `pokemon_showcase_shares` · `pokemon_spawns` · `pokemon_starter_rewards` · `pokemon_starters` · `pokemon_state` · `pokemon_throws` · `pokemon_trade_drafts` · `pokemon_trades`
- [x] `reminders` (venait de `botdata-<année>.db`, perdait les rappels au 1er janvier)
- [x] **Nouvelles** : `config_overrides` (remplace `config.json`), `job_runs`, `public_messages`, `web_sessions`
- ~~`pokemon_data_migrations`, `pokemon_migrations`~~ (marqueurs v1)

`stats-<année>.db` (annuelle, jamais supprimée automatiquement) :

- [x] `bet_stats` · `command_stats` · `emoji_stats` · `message_reactions` · `message_stats` · `pokemon_ball_stats` · `pokemon_daily_stats` · `pokemon_highlights` · `pokemon_species_stats` · `pokemon_stats` · `randomizabaise_stats` · `reaction_stats` · `voice_time` · `word_stats`
- ~~`messages`~~ (autodel abandonnée) · ~~`progress`~~ (curseur v1)

### Écarts de schéma convertis par `migrate-v1`

Partout : identifiants Discord `TEXT` → `INTEGER` ; booléens et statuts fermés par `CHECK` ; clés
étrangères actives. Les jours historiques restent tels quels (UTC en v1, Paris ensuite) : migrer hors de
22 h–2 h UTC, sinon `messages_day`, `pokemon_shop_daily.day` et `pokemon_lottery.last_day` du jour de
la bascule se décalent d'un jour.

- **Messages publics** : `channel_id`, `message_id`, `message_closed_at` de `pokemon_spawns`,
  `pokemon_trades`, `pokemon_drops`, `pokemon_safari_parks`, les `live_*` de `pokemon_safari_sessions`
  (sauf `live_author`) et `channel_id`/`message_id` de `pokemon_season_recaps` → une ligne
  `public_messages` (`kind`, `entity_id`, `version = 1`). Sans salon ou sans message (touches de pêche,
  envoi jamais abouti) : pas de ligne. `synced_version = 1` si `message_closed_at` est posé ou si
  l'entité est encore ouverte ; `0` pour une entité terminée dont la fin n'a pas été écrite, que le
  worker réécrira.
- `pokemon_spawns.announcement` et `pings_role` (nouvelles) : NULL et 0 pour les apparitions v1, dont
  le message est déjà posté (la v1 gardait l'annonce et la mention dans son message).
- `points` : `messages_today_count` → `messages_today`, `last_reset_date` → `messages_day` (`''` → `NULL`).
- `points_log` : `source = 'v1'` pour l'historique ; les déclencheurs v1 disparaissent (journal écrit
  par le code, à l'heure de `Clock`).
- `economy_state` : le bail `redistribution_since` disparaît (un pot tient dans une transaction de
  l'écrivain unique) ; l'échéance est reprise telle quelle.
- `points_redistributions` : `rate` → `percent`, `triggered_by = 'auto'` → `NULL`, `failures` supprimée
  (le rapport compte les pots v1 qui avaient des échecs).
- `bets` : `winning_option_index` → `winning_option` (pari classique) ou `estimate_result` (estimation) ;
  `bet_options.id` supprimée ; `bet_participations.prediction_value` → `prediction`, `option_index` 0
  d'une estimation → `NULL`.
- `reminders` : `guild_id` supprimée ; `sent` → `sent_at` (un rappel envoyé sans date prend `trigger_at`).
- `pokemon_state.spawning` supprimée (apparition et revendication dans une même transaction).
- `pokemon_spawns.rarity` `NULL` : la conversion refuse (la v1 l'écrit toujours ; la recalculer
  demanderait les données d'espèces).
- `pokemon_trades` : espèce `0` (« pas de Pokémon ») → `NULL`, `to_user_id = ''` (offre ouverte) → `NULL` ;
  de même `pokemon_trade_drafts.to_user_id = ''` → `NULL`.
- `pokemon_fusions` → `pokemon_evolutions`.
- `pokemon_owned.pc_pos` négatif → `NULL` (la v1 l'ignorait déjà) ; `pokemon_pc_boxes.name = ''` →
  `NULL` ; `pokemon_lottery.last_day = ''` → `NULL`.
- `config.json` (arbre imbriqué) → `config_overrides` (une ligne par chemin pointé, valeur JSON).
- Stats : lignes `__global__` supprimées (totaux = agrégats ; échanges du serveur = lignes `ACCEPTED`
  de `pokemon_trades` résolues dans l'année) ; `date` → `day` ; `voice_time.longest_session` →
  `longest_session_ms`, `join_time` → `joined_at` (remis à `NULL`) ; `pokemon_stats.fusions`/
  `fusion_points` → `evolutions`/`evolution_points`.
- **Plus strict que la v1**, chaque cas compté dans le rapport :
  - écartés : identifiants de membre invalides (dont `__global__`), lancers et captures/actions safari
    orphelins, récompenses de starter sans starter, options de pari en double ou orphelines, mises sur
    une option absente, `emoji_stats.emoji` `NULL` (emoji serveur supprimé), `randomizabaise_stats`
    sans membre tiré ;
  - corrigés : `pokemon_lottery.wins` ramené à `draws`, compteurs d'objets négatifs ramenés à 0,
    `spawn_id` d'un objet au sol, `park_id` d'une visite et `counter_of` d'un échange ou brouillon
    orphelins → `NULL` ;
  - toute autre valeur refusée par un `CHECK` fait échouer la conversion, sans rien écrire.

## 9. Correctifs v1 postérieurs au gel

_(vide)_

