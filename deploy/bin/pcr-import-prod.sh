#!/usr/bin/env bash
# VM de dev uniquement (root) : remplace la base du bot de dev par une sauvegarde de prod (.db ou
# .db.zst). L'ancienne base de dev est sauvegardée avant, au cas où.
set -euo pipefail

src=${1:?usage: pcr-import-prod <backup.db[.zst]>}
CONFIG=/etc/pcr/instance.toml
BACKUPS=/var/backups/pcr

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
chown pcr:pcr "$work"
case "$src" in
  *.zst) zstd -q -d -o "$work/import.db" "$src" ;;
  *) cp "$src" "$work/import.db" ;;
esac
chown pcr:pcr "$work/import.db"

if [ -f /var/lib/pcr/pcr.db ]; then
  runuser -u pcr -- /opt/pcr/current/pcr --config "$CONFIG" \
    backup --out "$BACKUPS/pre-import-$(date +%Y%m%d-%H%M%S).db"
fi

systemctl stop pcr
if ! runuser -u pcr -- /opt/pcr/current/pcr --config "$CONFIG" import-prod "$work/import.db"; then
  systemctl start pcr
  exit 1
fi
systemctl start pcr
echo "pcr-import-prod: done"
