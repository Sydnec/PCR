#!/usr/bin/env bash
# Installe la dernière version signée de la branche suivie, vérifie sa santé, revient en arrière sinon.
# Lancé chaque minute par pcr-update.timer (root). Réglages : /etc/pcr/update.env.
#
# Confiance : le binaire doit porter une signature cosign émise par .github/workflows/build.yml sur la
# branche suivie (refs/heads/main en prod, refs/heads/dev en dev). Du code poussé sur dev ne peut donc
# jamais être installé en prod, et aucun jeton GitHub ni port entrant n'est nécessaire.
set -euo pipefail

: "${PCR_CHANNEL:?}" "${PCR_REPO:?}" "${PCR_HEALTH_URL:?}"
PCR_OPS_WEBHOOK="${PCR_OPS_WEBHOOK:-}"

ROOT=/opt/pcr
RELEASES=$ROOT/releases
FAILED=$ROOT/failed-commits
DATA=/var/lib/pcr
BACKUPS=/var/backups/pcr
CONFIG=/etc/pcr/instance.toml
ASSET=pcr-x86_64-linux
OIDC_ISSUER=https://token.actions.githubusercontent.com
HEALTH_TRIES=30 # toutes les 2 s : une minute pour démarrer
KEEP=3          # versions et instantanés gardés pour un retour arrière manuel

case "$PCR_CHANNEL" in
  dev) base="https://github.com/$PCR_REPO/releases/download/dev-latest" ref=refs/heads/dev ;;
  prod) base="https://github.com/$PCR_REPO/releases/latest/download" ref=refs/heads/main ;;
  *) echo "PCR_CHANNEL must be dev or prod" >&2 && exit 2 ;;
esac
identity="https://github.com/$PCR_REPO/.github/workflows/build.yml@$ref"
# Pour les essais seulement (serveur local) : l'identité exigée du signataire, elle, ne change pas.
base=${PCR_RELEASE_BASE:-$base}

log() { echo "pcr-update: $*"; }

notify() {
  log "$*"
  [ -n "$PCR_OPS_WEBHOOK" ] || return 0
  jq -n --arg content "[$PCR_CHANNEL] $*" '{content: $content}' |
    curl -fsS -m 10 -H 'Content-Type: application/json' -d @- "$PCR_OPS_WEBHOOK" >/dev/null ||
    log "ops webhook failed"
}

# Sain = /healthz répond ET c'est la version attendue qui répond, pas un ancien processus encore là.
healthy() {
  local expected=${1:0:7} body
  for _ in $(seq "$HEALTH_TRIES"); do
    if body=$(curl -fs -m 2 "$PCR_HEALTH_URL") && [ "$(jq -r .commit <<<"$body")" = "$expected" ]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

switch_to() {
  ln -sfn "$1" "$ROOT/current.new"
  mv -T "$ROOT/current.new" "$ROOT/current"
}

# Même jeu de migrations : l'ancien binaire relit la base telle quelle, inutile de la restaurer.
same_migrations() {
  [ -f "$1/manifest.json" ] && [ -f "$2/manifest.json" ] &&
    [ "$(jq -r .migrations "$1/manifest.json")" = "$(jq -r .migrations "$2/manifest.json")" ]
}

prune() {
  local keep_dir
  keep_dir=$(readlink -f "$ROOT/current")
  find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2- |
    { grep -vx "$keep_dir" || true; } | tail -n +"$KEEP" | xargs -r rm -rf
  find "$BACKUPS" -maxdepth 1 -name 'pre-deploy-*.db' -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2- |
    tail -n +"$((KEEP + 1))" | xargs -r rm -f
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# 1. Manifeste. Absent = pas encore de version, ou version en cours de remplacement : on réessaiera.
if ! curl -fsSL -m 30 -o "$work/manifest.json" "$base/manifest.json"; then
  log "no manifest available yet"
  exit 0
fi
commit=$(jq -re .commit "$work/manifest.json")
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { log "invalid manifest" && exit 1; }
current=""
[ -L "$ROOT/current" ] && current=$(basename "$(readlink -f "$ROOT/current")")
[ "$commit" = "$current" ] && exit 0
# Une version qui a déjà échoué n'est pas réessayée en boucle : il faut un nouveau commit.
grep -qx "$commit" "$FAILED" 2>/dev/null && exit 0

# 2. Téléchargement et vérifications : empreinte annoncée, puis signature et identité du signataire.
curl -fsSL -m 300 -o "$work/$ASSET" "$base/$ASSET"
curl -fsSL -m 30 -o "$work/$ASSET.sigstore.json" "$base/$ASSET.sigstore.json"
echo "$(jq -re .sha256 "$work/manifest.json")  $work/$ASSET" | sha256sum -c --quiet -
cosign verify-blob \
  --bundle "$work/$ASSET.sigstore.json" \
  --certificate-identity "$identity" \
  --certificate-oidc-issuer "$OIDC_ISSUER" \
  "$work/$ASSET"

# 3. Mise en place à côté de la version courante.
dest="$RELEASES/$commit"
install -d -m 0755 "$dest"
install -m 0755 "$work/$ASSET" "$dest/pcr"
install -m 0644 "$work/manifest.json" "$dest/manifest.json"
version=$(jq -r .version "$dest/manifest.json")

# 4. Instantané de la base, pris par le binaire qui la fait tourner.
snapshot=""
if [ -n "$current" ] && [ -f "$DATA/pcr.db" ]; then
  snapshot="$BACKUPS/pre-deploy-$commit.db"
  rm -f "$snapshot"
  runuser -u pcr -- "$ROOT/current/pcr" --config "$CONFIG" backup --out "$snapshot"
fi
# `readlink -f` répond même pour un lien absent : sans ce test, un premier déploiement raté
# « reviendrait » vers current lui-même et créerait une boucle de liens.
previous=""
[ -L "$ROOT/current" ] && previous=$(readlink -f "$ROOT/current")

# 5. Bascule et contrôle de santé (HTTP + base ; Discord n'est jamais bloquant).
switch_to "$dest"
systemctl restart pcr
if healthy "$commit"; then
  notify "déployé $version (${commit:0:7})"
  prune
  exit 0
fi

# 6. Retour arrière.
echo "$commit" >>"$FAILED"
systemctl stop pcr
if [ -z "$previous" ]; then
  notify "ÉCHEC du premier déploiement $version (${commit:0:7}) : bot arrêté"
  exit 1
fi
restored=""
if [ -n "$snapshot" ] && ! same_migrations "$previous" "$dest"; then
  # Les migrations ont changé : l'ancien binaire ne relirait pas la base migrée. On perd au plus
  # les écritures faites depuis la bascule.
  install -o pcr -g pcr -m 0640 "$snapshot" "$DATA/pcr.db"
  rm -f "$DATA/pcr.db-wal" "$DATA/pcr.db-shm"
  restored=", base restaurée"
fi
switch_to "$previous"
systemctl start pcr
previous_commit=${previous##*/}
if healthy "$previous_commit"; then
  notify "ÉCHEC de $version (${commit:0:7}) : retour à ${previous_commit:0:7}$restored"
else
  notify "ÉCHEC de $version (${commit:0:7}) et du retour arrière : intervention nécessaire"
fi
exit 1
