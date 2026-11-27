[← README](../README.md)

# 🛠️ Communauté

Les commandes du quotidien du serveur, hors jeu Pokémon et économie. Chaque salon nommé ici se règle
dans `instance.toml` (`*_channel_id`, `docs/ops.md`) ; un salon absent coupe sa fonctionnalité, sans
erreur. Les heures sont celles de Paris.

## Rappels

- **`/rappel date [message]`** : un rappel envoyé en MP, à `JJ/MM/AAAA HH:MM` ou `JJ/MM HH:MM` (année
  en cours), heure de Paris. La date doit être dans le futur, à un an au plus
  (`reminders.maxDaysAhead`). Sans message, le rappel dit « Rappel ! ». Une date refusée se dit en
  privé ; un rappel posé s'annonce dans le salon.
- **« 🔔 Me rappeler aussi »** : le bouton sous l'annonce pose le même rappel pour qui clique, tant
  que l'heure n'est pas passée. Les boutons de la v1 marchent toujours. Un long message ne fait plus
  échouer `/rappel` : la v1 mettait tout le message dans le bouton, que Discord limite à 100
  caractères ; le bouton renvoie alors au rappel d'origine (s'il a été supprimé avant l'heure, le
  bouton le dit).
- **`/mesrappels liste`** et **`/mesrappels supprimer id`** : ses rappels à venir, en privé.
- **Envoi** : chaque minute, les rappels échus partent en MP, avec le salon où ils ont été posés. Un
  membre parti ou qui refuse les MP n'est pas relancé ; une panne de Discord, si. Les rappels envoyés
  sont effacés après 7 jours (`reminders.keepSentDays`). Ils vivent dans la base permanente : la v1
  les perdait au 1er janvier.

## Anniversaires

- **`/birthday add JJ/MM`** (ou `JJ/MM/AAAA` pour donner son âge), **`/birthday remove`**, en privé.
  Une date qui n'existe pas (31/04, 29/02 d'une année commune) est refusée ; le 29 février sans année
  est accepté et se fête le 28 les années communes.
- **`/birthday list`** : les 10 prochaines fêtes du serveur, avec l'âge quand l'année est connue.
- **Vœux** : à `birthday.hour` (9 h), dans le salon des anniversaires, avec le message
  `birthday.message` (`{user}` : la mention, `{name}` : le pseudo). Chacun n'est fêté qu'une fois par
  an ; un bot arrêté à l'heure dite rattrape les vœux du jour à son démarrage (la v1 les sautait), et
  un envoi raté est retenté. L'heure 2 h, qui manque ou double au changement d'heure, devient 3 h.

## Sondages

- **`/poll question [option1…10]`** : un post dans le forum des sondages, nommé d'après la question
  (99 caractères ; au-delà, la question entière suit dans le fil). Son auteur y est ajouté. Sans
  aucune option, la commande refuse (Discord refuse un message vide, et la v1 restait sans réponse).
- **Réactions** : chaque ligne d'un post du forum reçoit sa réaction, l'emoji qui l'ouvre ou un
  numéro (1️⃣…🔟, puis 🇦…🇯 : un message porte au plus 20 réactions). Une ligne qui commence par `#`
  est un titre. Un emoji d'un autre serveur est remplacé par le numéro. Un post écrit directement par
  un membre est reposté numéroté par le bot, comme en v1.
- **`/week question [jour] [date_debut] [date_fin]`** : un sondage d'un jour par ligne, dans le salon
  de la commande. Sans rien, les 7 jours à partir de demain ; un jour : sa prochaine occurrence (jamais
  aujourd'hui) et les 6 suivants ; des dates `JJ/MM` ou `JJ/MM/AAAA` (fin par défaut : début + 6 jours,
  début par défaut : aujourd'hui). 31 jours au plus (`week.maxDays`). Une date qui n'existe pas est
  refusée : la v1 glissait le 31/02 au 3 mars.
- **`/edit message`** (`;` pour aller à la ligne) : réécrit la question d'un post du forum, par son
  auteur ou un administrateur, et la renumérote.

## Saints du jour et calendrier de l'Avent

- **Saints et fêtes du jour** : chaque jour à `cotd.hour` (10 h), dans le salon des saints, les
  prénoms fêtés (nominis.cef.fr) et les journées mondiales (journee-mondiale.com). Une page des fêtes
  illisible n'empêche pas les saints de partir ; un site injoignable fait retenter le message (la v1
  le perdait). **`/cotd`** affiche le même message en privé.
- **Calendrier de l'Avent** : du 1er au 24 décembre, à `advent.hour` (minuit), un fil par jour dans le
  salon de l'Avent, avec sa question épinglée. Un bot arrêté à l'heure ouvre la case à son démarrage.

## Liens X et Instagram

Un message du serveur qui contient un lien X (Twitter) ou un reel Instagram est republié avec leurs
miroirs (vxtwitter.com, kkinstagram.com), dont Discord affiche l'aperçu, sous la mention de son
auteur, qui n'est pas notifié ; l'original est supprimé une fois la copie publiée. Les liens X y
perdent les traceurs collés après le « ? » (sauf une recherche, un hashtag ou un lien d'intention,
dont c'est le contenu). L'hôte se compare exactement (un « x.com.pirate.net » n'est pas X), un lien
entre chevrons reste tel quel, un message qui contient un lien masqué (`[texte](adresse)`) n'est pas
republié, et une copie qui dépasserait 2 000 caractères non plus.

Sous la copie, chaque tweet qui n'est pas en français reçoit un bouton **« Traduire »**
(`links.translation`, au plus `maxTweets`). Le clic répond en privé : la traduction de l'API de
FxTwitter, échappée (rien n'y forme un lien masqué ni une mention), avec son auteur et la langue
d'origine ; ou pourquoi il n'y en a pas (tweet supprimé, déjà en français, rien à traduire, API
muette).

## Rôles

- **Message des rôles** : au démarrage, le bot réécrit le message des rôles (`role_channel_id`,
  `role_message_id`) avec les rôles placés sous le rôle de ping (`ping_role_id`) dont le nom commence
  par un emoji, et y pose ces emoji. Réagir donne le rôle, retirer sa réaction le reprend. Un rôle
  géré par une intégration, ou qui porte une permission sensible (administration, gestion,
  modération, `@everyone`), n'est jamais proposé.
- **`/color hexa`** : la couleur de son pseudo, par un rôle « &A020F0 » rangé sous le rôle repère des
  couleurs (`color_role_id`). L'ancienne couleur est retirée, et son rôle supprimé quand plus
  personne ne le porte (la v1 le supprimait même encore porté par un autre membre).
- **Arrivée** : un nouveau membre reçoit le rôle par défaut, ou celui des membres temporaires s'il
  arrive par leur invitation (`temporary_member_invite_code`, `temporary_member_role_id`).
  L'invitation se reconnaît à son compteur d'utilisations : sans le droit « Gérer le serveur », elle
  ne se lit pas, et le rôle par défaut s'applique.

## Liste des fils

À chaque fil créé dans un salon textuel que voit le rôle par défaut (hors forum des sondages et salon
de l'Avent), la liste des fils du serveur, actifs et archivés, est republiée dans son salon
(`thread_list_channel_id`), salon par salon dans l'ordre du serveur.

## Divers

- **`/ecaflip option1 [option2…10]`** : une seule option est une question, la réponse est « Oui » ou
  « Non » ; sinon une des options, au hasard.
- **`/randomizabaise`** : deux membres du rôle par défaut, tirés au sort ; une fois sur
  `randomizabaise.shinyOdds` (1 024), trois. Le ship est retenu dans les stats de l'année (le récap
  compte ses réactions). Un ship shiny demande trois membres.
- **`/safe-place message`** : un message anonyme dans la safe place. Il n'appelle personne, et son
  auteur n'est écrit nulle part.
- **`/join`** : rejoindre le fil où l'on tape la commande (ou apprendre qu'on y est déjà).
- **`/help`** : la liste des commandes et de leur description ; **`/version`** : la version du bot,
  avec le commit, l'environnement et l'état de la base.
- **Stats de l'année** : les réactions (posées, reçues par message, par emoji) et le temps passé en
  vocal comptent pour le récap annuel. Une session vocale coupée par un arrêt du bot n'est pas
  mesurée.

Le texte écrit par un membre et relayé par le bot (sondages, pile ou face) peut mentionner des
membres et des rôles, comme en v1, jamais `@everyone` ni `@here`.
