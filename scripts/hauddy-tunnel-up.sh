#!/usr/bin/env bash
# Wire the Cloudflare Tunnel api.hauddy.com -> the local hub (localhost:8790).
#
# Run these TWO interactive commands YOURSELF first (they open a browser and
# need your Cloudflare account — this script can't do them for you):
#
#   cloudflared tunnel login            # authorize; also adds/selects the hauddy.com zone
#   cloudflared tunnel create hauddy    # creates the tunnel + writes its credentials
#
# PREREQ: hauddy.com must be a zone in your Cloudflare account (nameservers pointed
# to Cloudflare at your registrar) — otherwise `route dns` below fails.
#
# Then run this script. It generates ~/.cloudflared/config.yml, points the DNS
# record at the tunnel, and tells you how to start it as a background service.
set -euo pipefail

TUNNEL="hauddy"
HOSTNAME="api.hauddy.com"
LOCAL="http://localhost:8790"
CF_DIR="$HOME/.cloudflared"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not found. Install it:  brew install cloudflared" >&2
  exit 1
fi

# The newest *.json in ~/.cloudflared is the tunnel's credentials file (its name is the tunnel UUID).
CRED="$(ls -t "$CF_DIR"/*.json 2>/dev/null | head -1 || true)"
if [ -z "$CRED" ]; then
  echo "No tunnel credentials found in $CF_DIR." >&2
  echo "Run first:  cloudflared tunnel login  &&  cloudflared tunnel create $TUNNEL" >&2
  exit 1
fi
ID="$(basename "$CRED" .json)"

cat > "$CF_DIR/config.yml" <<EOF
# Hauddy alpha — Cloudflare Tunnel. Cloudflare terminates TLS and proxies the
# WebSocket to the local hub; the hub's 30s heartbeat keeps idle sockets warm.
tunnel: $ID
credentials-file: $CRED
ingress:
  - hostname: $HOSTNAME
    service: $LOCAL
  - service: http_404
EOF
echo "wrote $CF_DIR/config.yml  (tunnel $ID -> $LOCAL)"

cloudflared tunnel route dns "$TUNNEL" "$HOSTNAME"
echo "routed $HOSTNAME -> tunnel $TUNNEL"

echo
echo "Start the tunnel now (foreground, to sanity-check):"
echo "    cloudflared tunnel run $TUNNEL"
echo "Then, to keep it always-on across reboots (needs sudo):"
echo "    sudo cloudflared service install"
echo
echo "Verify once it's up:  curl -s https://$HOSTNAME/agents   # expect {\"agents\":[]} "
