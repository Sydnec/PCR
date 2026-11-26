# deploy — VM, systemd, mise à jour

- `provision.sh` prépare une VM Debian 13 (idempotent) ; il ne touche jamais aux fichiers existants de `/etc/pcr`.
  C'est aussi lui qui pousse sur une VM les changements de ce dossier : le binaire, lui, se met à jour seul.
- `bin/pcr-update.sh` : manifeste → empreinte → signature cosign (workflow `build.yml` + branche suivie)
  → instantané → bascule → `/healthz` avec le commit attendu → sinon retour arrière + webhook.
- Scripts bash `set -euo pipefail`, propres pour `shellcheck` (job CI). Attention aux pipelines sous
  `pipefail` : un `grep` sans résultat fait échouer la ligne.
- Toute modification de `pcr-update.sh` se répète en local : faux serveur de releases
  (`PCR_RELEASE_BASE`), `systemctl` et `cosign` simulés, scénarios premier déploiement / sans changement /
  version cassée → retour arrière.
- Aucun secret dans ce dossier : seulement des `*.example`.
