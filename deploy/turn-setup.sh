#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# deploy/turn-setup.sh   (TURN relay for the calls)
# ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# * What it does: puts a TURN relay next to the app so the calls (audio, camera, screen) connect between any two
#   networks. It writes the TURN_* variables of .env, opens the ports of the machine and starts the relay and the app.
#
# * Usage (run it on the server, from the repository):
#     bash deploy/turn-setup.sh                  calls try a direct path first and use the relay when they must
#     bash deploy/turn-setup.sh --private        EVERY call goes through the relay (RELAY_ONLY=1): the most private
#     bash deploy/turn-setup.sh --rotate-secret  makes a new TURN_SECRET
#     bash deploy/turn-setup.sh --tls            the relay also (and only) answers over TLS: "turns:" on TCP 5349
#     bash deploy/turn-setup.sh --no-logs        the relay writes no log at all (no address is ever stored)
#   The options can be combined:  bash deploy/turn-setup.sh --private --tls --no-logs   (maximum privacy)
#
# ! --private: if the relay is down, calls FAIL on purpose. They never fall back to a direct connection (that would
#   show the addresses of the people).
# ! --rotate-secret: do it if the secret was ever shown to anybody. The old one stops working at once.
# ! The relay settings (with the secret) go to deploy/turnserver.generated.conf: owner + group 65534 (coturn), mode 640,
#   NEVER in Git.
#
# ? Which ports does Oracle need? In Oracle Cloud (Networking > your VCN > Security List > Ingress rules, 0.0.0.0/0):
#     UDP 3478 + TCP 3478                always
#     UDP 49152-49252                    only WITHOUT --private (both people reach the relay on 3478 and the media is
#                                        passed between their allocations inside the machine)
#   TODO: that part cannot be done from this script: do it by hand in the Oracle console.
# ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."
touch .env
chmod 600 .env
umask 077
ROTATE=0; PRIVATE=0; TLS=0; NOLOGS=0
for arg in "$@"; do
  case "$arg" in
    --private) PRIVATE=1 ;;
    --rotate-secret) ROTATE=1 ;;
    --tls) TLS=1 ;;
    --no-logs) NOLOGS=1 ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# * Helpers: read a variable of .env (empty when absent) and write one.
get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }
put() { if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }

DOMAIN="$(get DOMAIN)"
if [ -z "$DOMAIN" ]; then echo "Write DOMAIN=your.domain in .env first."; exit 1; fi
SECRET="$(get TURN_SECRET)"
[ "$ROTATE" = 1 ] && SECRET=""
[ -n "$SECRET" ] || SECRET="$(openssl rand -hex 32)"
PUBLIC_IP="$(curl -fsS https://api.ipify.org)"
PRIVATE_IP="$(ip -4 route get 1.1.1.1 | grep -oP 'src \K\S+' | head -1)"

put TURN_SECRET "$SECRET"
put TURN_PUBLIC_IP "$PUBLIC_IP"
put TURN_PRIVATE_IP "$PRIVATE_IP"
if [ "$TLS" = 1 ]; then
  # ! Only TLS addresses are announced: nothing is offered in the clear. Needs the certificate that Caddy got for the domain.
  bash deploy/turn-cert-sync.sh "$DOMAIN" --no-reload
  put TURN_URLS "turns:$DOMAIN:5349?transport=tcp"
else
  put TURN_URLS "turn:$DOMAIN:3478?transport=udp,turn:$DOMAIN:3478?transport=tcp"
fi
# * With --private every call goes through the relay: the addresses of the people are never shown to each other.
if [ "$PRIVATE" = 1 ]; then put RELAY_ONLY 1; fi
# ! The secret goes into a file, never into the command line (it would show in "docker inspect" and "ps").
sed -e "s|=CHANGE_ME|=$SECRET|" -e "s|PUBLIC_IP|$PUBLIC_IP|g" -e "s|PRIVATE_IP|$PRIVATE_IP|g" -e "s|DOMAIN_HERE|$DOMAIN|"   deploy/turnserver.conf > deploy/turnserver.generated.conf
# ! coturn runs as "nobody" (uid/gid 65534) inside its container: it must be able to read the file, nobody else may.
#   With mode 600 it cannot read it and silently starts WITHOUT any configuration.
sudo chown "$(id -u)":65534 deploy/turnserver.generated.conf
chmod 640 deploy/turnserver.generated.conf
if [ "$TLS" = 1 ]; then
  sed -i 's|^no-tls$|tls-listening-port=5349
cert=/etc/coturn/tls/fullchain.pem
pkey=/etc/coturn/tls/privkey.pem
cipher-list=ECDHE+AESGCM:ECDHE+CHACHA20|' deploy/turnserver.generated.conf
fi
if [ "$NOLOGS" = 1 ]; then
  sed -i 's|^log-file=stdout$|no-stdout-log|' deploy/turnserver.generated.conf
fi
echo "Public IP $PUBLIC_IP, private IP $PRIVATE_IP, domain $DOMAIN."

# ? The images of Oracle block everything with iptables except what is allowed here.
open_port() {
  sudo iptables -C INPUT -p "$1" --dport "$2" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p "$1" --dport "$2" -j ACCEPT
}
if [ "$TLS" = 1 ]; then
  open_port tcp 5349   # TLS only: 3478 stays closed to the public (it still answers on the private address of the machine)
else
  open_port udp 3478
  open_port tcp 3478
fi
# * The range of the relayed media is public only when calls may also connect without the relay.
if [ "$PRIVATE" != 1 ]; then open_port udp 49152:49252; fi
sudo netfilter-persistent save >/dev/null 2>&1 || true

if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose"; else COMPOSE="docker-compose"; fi
# ! Replaced (removed first, then created): recreating a container with docker-compose 1.x fails with 'ContainerConfig'.
$COMPOSE --profile turn rm -sf turn
$COMPOSE --profile turn up -d turn
# The app reads the TURN variables when it starts.
$COMPOSE rm -sf app
$COMPOSE up -d app
if [ "$PRIVATE" = 1 ]; then
  echo "Done. Do not forget the rules of the VCN in Oracle Cloud (UDP 3478, TCP 3478)."
else
  echo "Done. Do not forget the rules of the VCN in Oracle Cloud (UDP 3478, TCP 3478, UDP 49152-49252)."
fi
