# Parité v1 → v2

Checklist de la réécriture, **générée depuis le code v1** (`main` @ 97c987a, v1.22.1). Chaque PR coche
ce qu'elle porte. Le code v1 se relit avec `git show origin/main:<chemin>` (puis `v1-final` après la
bascule). À partir de P2 la v1 est gelée : tout correctif v1 ultérieur s'ajoute en section 9.

Légende : `[x]` porté en v2 · `~~barré~~` abandonné volontairement (avec la raison).

## 1. Commandes hors Pokémon

- ~~`/autodel lien [jours]` — Supprimera automatiquement votre message avec X jours.~~ (abandonnée : jamais utilisée)
- [ ] `/bet question option1 option2 [option3] [option4] [option5]` — Créer un nouveau pari
- [ ] `/betstats [user]` — Affiche les statistiques des paris
- [ ] `/birthday add date` — Enregistre (ou modifie) ta date d'anniversaire
- [ ] `/birthday list` — Affiche les 10 prochains anniversaires du serveur
- [ ] `/birthday remove` — Supprime ta date d'anniversaire
- [ ] `/classement` — Affiche le classement des utilisateurs avec le plus de points
- [ ] `/color hexa` — Changer la couleur de votre pseudo
- [ ] `/cotd` — Affiche les saints du jour
- [ ] `/ecaflip option1 [option2] [option3] [option4] [option5] [option6] [option7] [option8] [option9] [option10]` — Pile ou Face ?
- [ ] `/edit message` — Modifie la question du sondage
- [ ] `/estimate question` — Créer un nouveau pari d'estimation (Le plus proche gagne)
- [ ] `/help` — Fourni la liste des commandes disponibles avec ce bot
- [ ] `/join` — Rejoindre le fil de discussion actuel
- [ ] `/mesrappels liste` — Voir la liste de tes rappels actifs
- [ ] `/mesrappels supprimer id` — Supprimer un rappel
- [ ] `/poll question [option1] [option2] [option3] [option4] [option5] [option6] [option7] [option8] [option9] [option10]` — Créer un sondage dans le channel #Sondage
- [ ] `/randomizabaise` — Depuis le temps que vous l'attendiez celle là
- [ ] `/rappel date [message]` — Créer un rappel qui te sera envoyé en DM
- [ ] `/safe-place message` — Envoie un message anonymement dans la safe place
- [ ] `/solde [user]` — Affiche le solde de points d'un utilisateur
- [ ] `/version` — Affiche la version actuelle du bot
- [ ] `/week question [jour] [date_debut] [date_fin]` — Créer un sondage contenant les jours d'une période

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

## 3. Administration (`/admin`)

- [ ] `/admin points cible montant` — Donne (ou retire) des points à un dresseur ou à tout un rôle
- [ ] `/admin item cible objet [quantite]` — Donne (ou retire) un objet à un dresseur ou à tout un rôle
- [ ] `/admin config cle valeur` — Modifie un réglage du bot, appliqué immédiatement
- [ ] `/admin config-voir [cle]` — Affiche un réglage — ou une branche entière — et sa valeur par défaut
- [ ] `/admin poids [table]` — Convertit les poids de tirage en probabilités réelles
- [ ] `/admin potcommun [simulation]` — Déclenche un pot commun immédiatement, ou simule le prochain
- [ ] `/admin purge [lien] [nombre]` — Supprime des messages
- [ ] `/admin purge-membre id` — Supprime tous les messages d'un membre sur le serveur, bilan en MP
- [ ] `/admin pokespawn [espece] [shiny] [annonce] [ping]` — Déclenche l'apparition d'un Pokémon (événements)
- [ ] `/admin safarispawn [joueur] [pause]` — Ouvre un parc safari (événement public, ou offert à un dresseur)
- [ ] `/admin saison` — Aperçu du bilan de la saison en cours (rien n'est publié ni enregistré)
- [ ] `/admin restart` — Redémarre le bot
- [ ] `/admin recap-annuel apercu` — **nouveau** : aperçu du récap annuel

## 4. Identifiants de composants (`custom_id`) v1

Ceux posés sur des **messages publics** restent décodables en v2 (grammaire `action|arg|…`) :
spawn, objet au sol, offre d'échange, parc et partage safari, partage de vitrine, paris, rappel,
traduction. Ceux des panneaux éphémères sont remplacés par les panneaux `pk:` et répondent
« panneau expiré ».

- [ ] `bet_estimate_join` · `bet_estimate_modal` · `bet_estimate_resolve_submit` · `bet_join` · `bet_modal` · `bet_resolve_modal` · `bet_resolve_select` · `poke_box` · `poke_cmp` · `poke_cmpg` · `poke_cmpgo` · `poke_cmpn` · `poke_cmpr` · `poke_cmpt` · `poke_dex` · `poke_dexf` · `poke_dexs` · `poke_dext` · `poke_drop` · `poke_dup` · `poke_dupr` · `poke_dupsp` · `poke_dupspr` · `poke_evo` · `poke_evo_cancel` · `poke_evo_pick` · `poke_master` · `poke_master_cancel` · `poke_master_ok` · `poke_owned` · `poke_reback` · `poke_remaster` · `poke_respecial` · `poke_rethrow` · `poke_safari_bait` · `poke_safari_ball` · `poke_safari_cancel` · `poke_safari_enter` · `poke_safari_flee` · `poke_safari_gens` · `poke_safari_go` · `poke_safari_live` · `poke_safari_share` · `poke_showcase_share` · `poke_special` · `poke_starter_no` · `poke_starter_ok` · `poke_td_back` · `poke_td_cancel` · `poke_td_find` · `poke_td_go` · `poke_td_ind` · `poke_td_kind` · `poke_td_pick` · `poke_td_pts` · `poke_td_side` · `poke_throw` · `poke_trade_accept` · `poke_trade_cancel` · `poke_trade_counter` · `poke_trade_decline` · `poke_trade_pick` · `rappel` · `tweet_translate`

## 5. Minuteurs (désormais en heure de Paris, rattrapés via `job_runs`)

- [ ] Calendrier de l'Avent (`ADVENT_CRON_TIMER`, 1er–24 décembre)
- [ ] Saints et fêtes du jour (`COTD_CRON_TIMER`)
- [ ] Rappels échus envoyés en MP (chaque minute) ; purge des rappels envoyés depuis plus de 7 jours
- [ ] Fuite des Pokémon (chaque minute)
- [ ] Réparation des messages publics (toutes les 5 min, et au démarrage) : lignes `public_messages` en retard dont `changed_at` tombe dans `repairWindowHours`, passé `repairGraceSeconds` (les vieux messages v1 restés sans fin n'y entrent pas)
- [ ] Éclosion des œufs (chaque minute)
- [ ] Ouverture des générations + récap de saison (chaque minute)
- [ ] Parc safari : balayage + tirage horaire (chaque heure)
- [ ] Pot commun (échéance hebdomadaire, vérifiée chaque heure)
- [ ] Anniversaires (à `birthday.hour`, heure de Paris)
- [ ] Au démarrage : message des rôles, annonce de version, nettoyage `voice_time`
- [ ] **Nouveau** : bascule de la base de stats au 1er janvier, récap annuel
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

`migrate-v1` reprend `config.json` tel quel dans `config_overrides` (chemins v1). P2d : signaler les
clés inconnues de GameConfig plutôt que de les ignorer en silence.

- [ ] `messagePointsDistribution` (7) : `1`, `2`, `3`, `4`, `5`, `6`, `default`
- [ ] `pokemon` (3) : `enabled`, `generation`, `starterLines`
- [ ] `pokemon.generationOpenings` (1) : `2`
- [ ] `pokemon.spawn` (19) : `messagesPerSpawn`, `minDelayMinutes`, `minDelayAfterEndMinutes`, `fleeAfterMinutes.min`, `fleeAfterMinutes.max`, `legendaryFleeMultiplier`, `shinyOdds`, `weightsByStage.1`, `weightsByStage.2`, `weightsByStage.3`, `veryRareWeight`, `legendaryWeight`, `generationBoost`, `speciesFactors.201`, `pingRarities`, `throwLogSize`, `heldItemChance`, `itemDropChance`, `embedRefreshMs`
- [ ] `pokemon.capture` (43) : `globalMultiplier`, `minCatchRate`, `throwCooldownSeconds`, `balls.poke.label`, `balls.poke.emoji`, `balls.poke.sprite`, `balls.poke.price`, `balls.poke.multiplier`, `balls.super.label`, `balls.super.emoji`, `balls.super.sprite`, `balls.super.price`, `balls.super.multiplier`, `balls.hyper.label`, `balls.hyper.emoji`, `balls.hyper.sprite`, `balls.hyper.price`, `balls.hyper.multiplier`, `balls.master.label`, `balls.master.emoji`, `balls.master.sprite`, `balls.master.price`, `balls.master.priceGrowth`, `balls.master.multiplier`, `balls.master.guaranteed`, `specialBalls.maxHeld`, `specialBalls.dailyLimit`, `specialBalls.appat.label`, `specialBalls.appat.emoji`, `specialBalls.appat.sprite`, `specialBalls.appat.price`, `specialBalls.appat.multiplier`, `specialBalls.appat.generation`, `specialBalls.appat.bonus.fished`, `specialBalls.appat.bonus.multiplier`, `specialBalls.catalyseur.label`, `specialBalls.catalyseur.emoji`, `specialBalls.catalyseur.sprite`, `specialBalls.catalyseur.price`, `specialBalls.catalyseur.multiplier`, `specialBalls.catalyseur.generation`, `specialBalls.catalyseur.bonus.item`, `specialBalls.catalyseur.bonus.multiplier`
- [ ] `pokemon.evolution` (6) : `2.duplicates`, `2.points`, `3.duplicates`, `3.points`, `branchChoicePoints`, `dittosPerCopy`
- [ ] `pokemon.trade` (2) : `expiryHours`, `draftMinutes`
- [ ] `pokemon.lockByDefault` (2) : `shiny`, `legendary`
- [ ] `pokemon.shinyCharm` (1) : `multiplier`
- [ ] `pokemon.starters` (2) : `choices.2`, `rewards`
- [ ] `pokemon.fishing` (3) : `generation`, `fleeSeconds`, `wildRarityFactor`
- [ ] `pokemon.eggs` (5) : `enabled`, `hatchHours`, `hatchMessages`, `perDay`, `shinyParentMultiplier`
- [ ] `pokemon.pokedex` (1) : `pageSize`
- [ ] `pokemon.box` (1) : `pageSize`
- [ ] `pokemon.showcase` (4) : `slots`, `shareCooldownMinutes`, `imageCell`, `imageTimeoutSeconds`
- [ ] `pokemon.unownText` (4) : `maxLetters`, `lettersPerLine`, `imageCell`, `imageTimeoutSeconds`
- [ ] `pokemon.pc` (6) : `slotsPerBox`, `columns`, `minBoxes`, `maxBoxes`, `boxNameLength`, `nicknameLength`
- [ ] `pokemon.items` (129) : `ball_poke.ball`, `ball_poke.description`, `ball_poke.dropWeight`, `ball_poke.lotteryWeight`, `ball_poke.lot.min`, `ball_poke.lot.max`, `ball_super.ball`, `ball_super.description`, `ball_super.dropWeight`, `ball_super.lotteryWeight`, `ball_super.lot.min`, `ball_super.lot.max`, `super_bonbon.label`, `super_bonbon.emoji`, `super_bonbon.sprite`, `super_bonbon.description`, `super_bonbon.sellValue`, `super_bonbon.dropWeight`, `super_bonbon.evolution.copies`, `super_bonbon.evolution.quantity`, `super_bonbon.lot.min`, `super_bonbon.lot.max`, `ball_hyper.ball`, `ball_hyper.description`, `ball_hyper.dropWeight`, `ball_hyper.lot.min`, `ball_hyper.lot.max`, `evolyte.label`, `evolyte.emoji`, `evolyte.sprite`, `evolyte.description`, `evolyte.sellValue`, `evolyte.dropWeight`, `evolyte.evolution.copies`, `evolyte.evolution.quantity`, `evolyte.evolution.choose`, `evolyte.evolution.freePoints`, `pierre_soleil.label`, `pierre_soleil.emoji`, `pierre_soleil.sprite`, `pierre_soleil.description`, `pierre_soleil.sellValue`, `pierre_soleil.dropWeight`, `pierre_soleil.generation`, `pierre_soleil.evolution.copies`, `pierre_soleil.evolution.quantity`, `pierre_soleil.evolution.targets.44`, `roche_royale.label`, `roche_royale.emoji`, `roche_royale.sprite`, `roche_royale.description`, `roche_royale.sellValue`, `roche_royale.dropWeight`, `roche_royale.generation`, `roche_royale.evolution.copies`, `roche_royale.evolution.quantity`, `roche_royale.evolution.targets.61`, `roche_royale.evolution.targets.79`, `catalyseur.label`, `catalyseur.emoji`, `catalyseur.sprite`, `catalyseur.description`, `catalyseur.sellValue`, `catalyseur.dropWeight`, `catalyseur.generation`, `catalyseur.evolution.copies`, `catalyseur.evolution.quantity`, `catalyseur.evolution.targets.95`, `catalyseur.evolution.targets.117`, `catalyseur.evolution.targets.123`, `catalyseur.evolution.targets.137`, `pepite.label`, `pepite.emoji`, `pepite.sprite`, `pepite.description`, `pepite.sellValue`, `pepite.dropWeight`, `ticket_safari.label`, `ticket_safari.emoji`, `ticket_safari.sprite`, `ticket_safari.description`, `ticket_safari.dropWeight`, `ball_master.ball`, `ball_master.description`, `ball_master.lotteryWeight`, `ball_master.maxHeld`, `ball_master.overflowValue`, `canne.label`, `canne.emoji`, `canne.sprite`, `canne.description`, `canne.rod.pool`, `canne.rod.price`, `canne.rod.base`, `super_canne.label`, `super_canne.emoji`, `super_canne.sprite`, `super_canne.description`, `super_canne.dropWeight`, `super_canne.lotteryWeight`, `super_canne.lot.min`, `super_canne.lot.max`, `super_canne.maxHeld`, `super_canne.overflowValue`, `super_canne.upgradesTo`, `super_canne.rod.pool`, `super_canne.rod.price`, `mega_canne.label`, `mega_canne.emoji`, `mega_canne.sprite`, `mega_canne.description`, `mega_canne.dropWeight`, `mega_canne.lotteryWeight`, `mega_canne.lot.min`, `mega_canne.lot.max`, `mega_canne.maxHeld`, `mega_canne.overflowValue`, `mega_canne.rod.pool`, `mega_canne.rod.price`, `charme_chroma_1.label`, `charme_chroma_1.emoji`, `charme_chroma_1.sprite`, `charme_chroma_1.description`, `charme_chroma_1.charm.generation`, `charme_chroma_2.label`, `charme_chroma_2.emoji`, `charme_chroma_2.sprite`, `charme_chroma_2.description`, `charme_chroma_2.charm.generation`
- [ ] `pokemon.sell` (5) : `byRarity.COMMUN`, `byRarity.PEU_COMMUN`, `byRarity.RARE`, `byRarity.TRES_RARE`, `shinyMultiplier`
- [ ] `pokemon.lottery` (3) : `enabled`, `winChance`, `lotDecay`
- [ ] `pokemon.safari` (28) : `enabled`, `randomChancePerHour`, `minHoursBetweenParks`, `parkDurationHours`, `spawnPauseHours`, `sessionMinDurationMinutes`, `actionsPerSession`, `liveRecentActions`, `liveRefreshMs`, `liveSettleMs`, `entryPrice`, `entryCooldownHours`, `ball.label`, `ball.emoji`, `ball.sprite`, `ball.multiplier`, `baitMultiplier`, `baitMaxMultiplier`, `fleeFailChance`, `wildFleeChance`, `wildFleeChancePerBait`, `shinyOdds`, `weightsByStage.1`, `weightsByStage.2`, `weightsByStage.3`, `veryRareWeight`, `legendaryWeight`, `speciesFactors.201`
- [ ] `pokemon.seasonRecap` (10) : `enabled`, `topSize`, `podiumSize`, `minThrowsForLuck`, `minLotteryDraws`, `minSpawnsForFleeRate`, `publishWithinHours`, `retryMinutes`, `recordRetries`, `recordRetryDelayMs`
- [ ] `web` (4) : `sessionHours`, `writesPerMinute`, `accessDenialCacheSeconds`, `spawnRefreshSeconds`
- [ ] `publicMessages` (4) : `retries`, `retryDelayMs`, `repairGraceSeconds`, `repairWindowHours`
- [ ] `links` (4) : `translation.enabled`, `translation.lookupTimeoutSeconds`, `translation.translateTimeoutSeconds`, `translation.maxTweets`
- [ ] `redistribution` (3) : `enabled`, `intervalHours`, `contributionPercent`
- [ ] `purgeMember` (3) : `concurrency`, `progressLogSeconds`, `rateLimitLogSeconds`
- [ ] `birthday` (3) : `enabled`, `hour`, `message`

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
- `points` : `messages_today_count` → `messages_today`, `last_reset_date` → `messages_day` (`''` → `NULL`).
- `points_log` : `source = 'v1'` pour l'historique ; les déclencheurs v1 disparaissent (journal écrit
  par le code, à l'heure de `Clock`).
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

