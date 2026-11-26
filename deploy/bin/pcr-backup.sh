#!/usr/bin/env bash
# Sauvegarde quotidienne (utilisateur pcr) : copie cohérente de pcr.db, compressée, gardée 14 jours.
set -euo pipefail

BACKUPS=/var/backups/pcr
KEEP_DAYS=14

out="$BACKUPS/pcr-$(date +%Y-%m-%d).db"
rm -f "$out" "$out.zst"
/opt/pcr/current/pcr backup --out "$out"
zstd -q --rm -10 "$out"
find "$BACKUPS" -maxdepth 1 -name 'pcr-*.db.zst' -mtime +"$KEEP_DAYS" -delete
echo "pcr-backup: $out.zst"
