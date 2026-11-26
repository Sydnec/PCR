#!/usr/bin/env bash
# Depuis ta machine d'admin : copie la dernière sauvegarde de prod sur la VM dev et l'y importe.
# Les deux VM ne se font jamais confiance : la copie transite par cette machine.
# Usage : copy-prod-to-dev.sh <hôte-ssh-prod> <hôte-ssh-dev>   (sudo sans mot de passe sur les VM)
set -euo pipefail

prod=${1:?usage: copy-prod-to-dev.sh <ssh-prod> <ssh-dev>}
dev=${2:?usage: copy-prod-to-dev.sh <ssh-prod> <ssh-dev>}

latest=$(ssh "$prod" "sudo -n sh -c 'ls -1t /var/backups/pcr/pcr-*.db.zst 2>/dev/null | head -n 1'")
[ -n "$latest" ] || { echo "no daily backup found on $prod" >&2 && exit 1; }
echo "copying $prod:$latest"
# shellcheck disable=SC2029 # le chemin est voulu tel que lu sur la prod, développé ici.
ssh "$prod" "sudo -n cat '$latest'" | ssh "$dev" "cat > /var/tmp/pcr-import.db.zst"
ssh "$dev" "sudo -n /usr/local/sbin/pcr-import-prod /var/tmp/pcr-import.db.zst; rc=\$?; rm -f /var/tmp/pcr-import.db.zst; exit \$rc"
