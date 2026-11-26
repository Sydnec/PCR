# 0004 — Déploiement « pull » signé, sans runner sur les VM

**Décision.** GitHub Actions (runners GitHub) construit le binaire, le signe avec cosign (signature sans clé,
identité = workflow + branche) et le publie : release `v<version>` pour `main`, pré-release glissante
`dev-latest` pour `dev`. Sur chaque VM, un timer systemd lit le manifeste de sa branche, vérifie la signature
épinglée sur `refs/heads/main` ou `refs/heads/dev`, sauvegarde la base, installe, redémarre, contrôle
`/healthz` et revient en arrière en cas d'échec.

**Pourquoi.**
- Le dépôt est public : n'importe quelle branche peut cibler un runner self-hosted. Un runner sur la VM de
  prod serait atteignable depuis du code de `dev`.
- Aucun jeton GitHub sur les VM, aucun port entrant pour le déploiement.
- Prod et dev suivent chacune leur branche automatiquement, comme demandé.

**Conséquence.** Délai d'environ 3 min entre le merge et le bot à jour (build + timer d'une minute).
