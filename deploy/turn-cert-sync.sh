#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════════════════
# deploy/turn-cert-sync.sh   (TLS certificate for the TURN relay)
# ══════════════════════════════════════════════════════════════════════════════════════════════════════════
# * What it does: copies the certificate that Caddy already got for your domain into deploy/tls/, where the relay
#   (coturn) reads it, and asks the relay to load the new one. The relay then answers over TLS ("turns:", port 5349).
# * Run by `deploy/turn-setup.sh --tls` the first time. Run it again after every renewal (about every 60 days):
#     bash deploy/turn-cert-sync.sh                 (or let a daily timer do it, see DOCS.md)
# ! The private key is copied with mode 640 and group 65534 (coturn runs as "nobody"): nobody else can read it.
#   deploy/tls/ is in .gitignore. NEVER commit it.
# ? Needs Caddy on the same machine (it keeps its certificates in /var/lib/caddy/.local/share/caddy/certificates).
# ══════════════════════════════════════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."
DOMAIN="${1:-$(grep -E '^DOMAIN=' .env | tail -1 | cut -d= -f2-)}"
RELOAD=1
[ "${2:-}" = "--no-reload" ] && RELOAD=0
[ -n "$DOMAIN" ] || { echo "Write DOMAIN=your.domain in .env first."; exit 1; }
OWNER="$(stat -c %u .)"
CADDY_DIR=/var/lib/caddy/.local/share/caddy/certificates
SRC="$(sudo find "$CADDY_DIR" -type d -name "$DOMAIN" 2>/dev/null | head -1 || true)"
if [ -z "$SRC" ]; then
  echo "Caddy has no certificate for $DOMAIN in $CADDY_DIR."
  echo "Open https://$DOMAIN once (Caddy asks for the certificate on its own) and run this again."
  exit 1
fi

mkdir -p deploy/tls
sudo chown "$OWNER":65534 deploy/tls
sudo chmod 750 deploy/tls
changed=0
for pair in "$DOMAIN.crt:fullchain.pem" "$DOMAIN.key:privkey.pem"; do
  from="${pair%%:*}"
  to="${pair##*:}"
  if ! sudo cmp -s "$SRC/$from" "deploy/tls/$to" 2>/dev/null; then
    sudo cp "$SRC/$from" "deploy/tls/$to"
    changed=1
  fi
  sudo chown "$OWNER":65534 "deploy/tls/$to"
  sudo chmod 640 "deploy/tls/$to"
done

if [ "$changed" = 1 ]; then
  echo "Certificate for $DOMAIN copied to deploy/tls/."
  # * coturn loads the new certificate when it gets SIGUSR2. If this version did not understand the signal it stops, and
  #   docker (restart: unless-stopped) starts it again: in both cases the relay ends up with the new certificate.
  if [ "$RELOAD" = 1 ] && docker compose ps --status running --services 2>/dev/null | grep -qx turn; then
    docker compose kill --signal=USR2 turn >/dev/null 2>&1 || true
    echo "The relay was asked to load it."
  fi
else
  echo "The certificate for $DOMAIN is already up to date."
fi
