# 0003 — Une base permanente, une base de stats par année

**Décision.** `pcr.db` garde tout ce qui traverse les années ; `stats-<année>.db` reçoit toutes les
statistiques. La bascule a lieu au 1er janvier, minuit à Paris ; le récap annuel part ce jour-là ; le
fichier de l'année écoulée n'est **jamais supprimé par le bot**, un humain le supprime.

**Pourquoi.**
- En v1, la base annuelle mélangeait stats, rappels et autodel : les rappels étaient perdus au Nouvel An.
- Les stats sont volumineuses et jetables une fois le récap publié ; les isoler garde `pcr.db` petite.
- Deux fichiers = deux verrous d'écriture : les compteurs n'entrent jamais en concurrence avec le jeu.

**Conséquence.** `/betstats` et les compteurs de `/randomizabaise` portent sur l'année en cours, comme en v1.
