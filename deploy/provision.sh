#!/usr/bin/env bash
# Prépare une VM Debian 13 pour PCR. À lancer en root depuis un clone du dépôt ; relançable sans
# risque (c'est aussi ainsi que les changements de deploy/ arrivent sur la VM).
#
#   provision.sh <dev|prod> --proxy-ip <IP du reverse proxy> --admin-net <CIDR SSH> [--port 8080]
#
# Ne touche jamais aux fichiers de /etc/pcr déjà présents (secrets et réglages de l'instance).
set -euo pipefail

COSIGN_VERSION=v3.1.6
COSIGN_SHA256=318a99ade4156a0c4113aa983b46c0a0830fa7896a096c63121ee47b610a94c6

usage() {
  echo "usage: $0 <dev|prod> --proxy-ip <IP> --admin-net <CIDR> [--port <port>]" >&2
  exit 2
}

env=${1:-}
[[ "$env" == dev || "$env" == prod ]] || usage
shift
proxy_ip="" admin_net="" port=8080
while [ $# -gt 0 ]; do
  case "$1" in
    --proxy-ip) proxy_ip=${2:-} && shift 2 ;;
    --admin-net) admin_net=${2:-} && shift 2 ;;
    --port) port=${2:-} && shift 2 ;;
    *) usage ;;
  esac
done
if [ -z "$proxy_ip" ] || [ -z "$admin_net" ]; then usage; fi
[[ "$port" =~ ^[0-9]+$ ]] || usage
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2 && exit 1; }
here=$(cd "$(dirname "$0")" && pwd)

# shellcheck source=/dev/null
. /etc/os-release
if [ "${ID:-}" != debian ] || [ "${VERSION_ID:-}" != 13 ]; then echo "warning: tested on Debian 13 only" >&2; fi

echo "== packages"
apt-get update -q
DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends \
  ca-certificates curl jq zstd sqlite3 nftables unattended-upgrades
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT

echo "== cosign $COSIGN_VERSION"
if ! cosign version 2>/dev/null | grep -q "${COSIGN_VERSION#v}"; then
  tmp=$(mktemp)
  curl -fsSL -o "$tmp" "https://github.com/sigstore/cosign/releases/download/$COSIGN_VERSION/cosign-linux-amd64"
  echo "$COSIGN_SHA256  $tmp" | sha256sum -c --quiet -
  install -m 0755 "$tmp" /usr/local/bin/cosign
  rm -f "$tmp"
fi

echo "== user and directories"
id pcr >/dev/null 2>&1 ||
  useradd --system --home-dir /var/lib/pcr --no-create-home --shell /usr/sbin/nologin pcr
install -d -m 0755 /opt/pcr /opt/pcr/releases
install -d -o root -g pcr -m 0750 /etc/pcr
install -d -o pcr -g pcr -m 0750 /var/backups/pcr

echo "== configuration (existing files are kept)"
fresh=false
if [ ! -f /etc/pcr/instance.toml ]; then
  install -o root -g pcr -m 0640 "$here/instance.example.toml" /etc/pcr/instance.toml
  sed -i "s/^env = .*/env = \"$env\"/; s/^listen = .*/listen = \"0.0.0.0:$port\"/" /etc/pcr/instance.toml
  fresh=true
fi
if [ ! -f /etc/pcr/pcr.env ]; then
  install -o root -g pcr -m 0640 "$here/pcr.env.example" /etc/pcr/pcr.env
  fresh=true
fi
if [ ! -f /etc/pcr/update.env ]; then
  install -o root -g root -m 0600 "$here/update.env.example" /etc/pcr/update.env
  sed -i "s/^PCR_CHANNEL=.*/PCR_CHANNEL=$env/; s#^PCR_HEALTH_URL=.*#PCR_HEALTH_URL=http://127.0.0.1:$port/healthz#" \
    /etc/pcr/update.env
fi

echo "== scripts and units"
install -m 0755 "$here/bin/pcr-update.sh" /usr/local/sbin/pcr-update
install -m 0755 "$here/bin/pcr-backup.sh" /usr/local/sbin/pcr-backup
if [ "$env" = dev ]; then
  install -m 0755 "$here/bin/pcr-import-prod.sh" /usr/local/sbin/pcr-import-prod
else
  # Jamais d'import sur la prod, même par erreur.
  rm -f /usr/local/sbin/pcr-import-prod
fi
install -m 0644 "$here"/systemd/*.service "$here"/systemd/*.timer /etc/systemd/system/
# `pcr …` utilisable directement par l'admin (config par défaut : /etc/pcr/instance.toml).
ln -sfn /opt/pcr/current/pcr /usr/local/bin/pcr

echo "== firewall"
sed -e "s#@ADMIN_NET@#$admin_net#" -e "s#@PROXY_IP@#$proxy_ip#" -e "s#@APP_PORT@#$port#" \
  "$here/nftables.conf" >/etc/nftables.conf.new
nft -c -f /etc/nftables.conf.new
mv /etc/nftables.conf.new /etc/nftables.conf
systemctl enable nftables
nft -f /etc/nftables.conf

echo "== services"
systemctl daemon-reload
systemctl enable pcr.service pcr-backup.timer
if $fresh; then
  cat <<NEXT

Provisioning done. Before the first deployment:
  1. fill /etc/pcr/instance.toml (Discord IDs, public URL, trusted_proxy = $proxy_ip)
  2. fill /etc/pcr/pcr.env (DISCORD_TOKEN, DISCORD_CLIENT_SECRET)
  3. optionally set PCR_OPS_WEBHOOK in /etc/pcr/update.env
  4. systemctl enable --now pcr-update.timer
NEXT
else
  systemctl enable --now pcr-update.timer
  echo "Provisioning done; pcr-update.timer is active."
fi
