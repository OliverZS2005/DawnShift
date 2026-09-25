#!/bin/bash
# Makes an Ollama server usable from the Dawnshift web app, safely:
#   https://<DOMAIN>/ollama/v1  ->  your Ollama server
# Browsers can't call a plain-http Ollama from an https page, and Ollama has
# no password of its own, so Nginx only lets requests through that carry a
# secret access key (generated here, shown at the end).
#
# Usage:  OLLAMA_URL=http://192.168.1.50:11434 bash connect-ollama.sh
# Run it on the server where Dawnshift's Nginx site lives. Safe to run again.
set -euo pipefail
DOMAIN=${DOMAIN:-dawnshift.dawnlife.online}
OLLAMA_URL=${OLLAMA_URL:-http://127.0.0.1:11434}
OLLAMA_URL=${OLLAMA_URL%/}
KEY_FILE=/etc/nginx/dawnshift-ollama.key
SITE="/etc/nginx/sites-available/$DOMAIN"

[ -f "$SITE" ] || { echo "No Nginx site for $DOMAIN. Install Dawnshift first (install-server.sh)."; exit 1; }

# 1. Can this server reach Ollama at all?
if ! curl -fsS --max-time 10 "$OLLAMA_URL/v1/models" >/dev/null; then
  echo "Can't reach Ollama at $OLLAMA_URL from this server."
  echo "Check the address, and that Ollama listens on the network: set"
  echo "OLLAMA_HOST=0.0.0.0 in Ollama's service settings, then restart it."
  exit 1
fi

# 2. The secret access key (kept if it already exists).
if [ ! -s "$KEY_FILE" ]; then
  head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
fi
KEY=$(cat "$KEY_FILE")

# 3. Nginx: check the key, then pass requests on to Ollama.
SNIPPET=/etc/nginx/snippets/dawnshift-ollama.conf
mkdir -p /etc/nginx/snippets
[ -f "$SNIPPET" ] && cp "$SNIPPET" "$SNIPPET.bak"
cp "$SITE" "$SITE.bak"
cat > "$SNIPPET" <<EOF
location /ollama/ {
    # Only requests carrying the access key get through.
    if (\$http_authorization != "Bearer $KEY") {
        return 401;
    }
    proxy_pass $OLLAMA_URL/;
    # Ollama only accepts requests that look local, and rejects browser
    # origins it doesn't know. The access key already guards the door.
    proxy_set_header Host localhost;
    proxy_set_header Origin "";
    proxy_set_header Authorization "";
    # Small models on a CPU can take a while to answer.
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    client_max_body_size 20m;
}
EOF
# The snippet holds the key, so only root may read it.
chmod 600 "$SNIPPET"

if ! grep -q "dawnshift-ollama.conf" "$SITE"; then
  sed -i 's|^\(\s*\)root /var/www/dawnshift;|&\n\1include snippets/dawnshift-ollama.conf;|' "$SITE"
fi
if ! nginx -t; then
  mv "$SITE.bak" "$SITE"
  if [ -f "$SNIPPET.bak" ]; then mv "$SNIPPET.bak" "$SNIPPET"; else rm -f "$SNIPPET"; fi
  echo "Nginx didn't accept the change, so it was undone. Your other sites are untouched."
  exit 1
fi
rm -f "$SITE.bak" "$SNIPPET.bak"
systemctl reload nginx
sleep 1

# 4. Check it through Nginx, the way the app will use it.
check() {
  curl -fsS --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" -H "Authorization: Bearer $1" "https://$DOMAIN/ollama/v1/models" 2>/dev/null ||
    curl -fsS --max-time 15 -H "Host: $DOMAIN" -H "Authorization: Bearer $1" "http://127.0.0.1/ollama/v1/models" 2>/dev/null
}
if ! MODELS=$(check "$KEY"); then
  echo "Nginx is set up, but the test request through it failed. Paste this output to get help."
  exit 1
fi
if check "wrong-key" >/dev/null; then
  echo "Warning: the access key check isn't working. Don't use this until it's fixed."
  exit 1
fi

echo
echo "Ollama is connected. Models found:"
echo "$MODELS" | grep -o '"id":"[^"]*"' | cut -d'"' -f4 | sed 's/^/  - /'
echo
echo "In Dawnshift: Settings -> Add a connection -> Ollama (local), then fill in"
echo "  Server address:  https://$DOMAIN/ollama/v1"
echo "  API key:         $KEY"
echo "and click Load models. Keep the key private: it's the password to your Ollama."
