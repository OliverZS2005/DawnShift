#!/bin/bash
# Installs the hosted Dawnshift server on a VPS that already runs Nginx and
# Certbot for other sites. Safe to run again. On a new box it sets everything
# up; on a box that was running the old sync server it migrates to the new
# layout and keeps existing accounts.
set -euo pipefail
DOMAIN=${DOMAIN:-dawnshift.dawnlife.online}
PORT=3790
APP_DIR=/opt/dawnshift
DATA_DIR=/var/lib/dawnshift
BRANCH=${BRANCH:-claude/ai-grok-bot-x5v1dx}
REPO=OliverZS2005/DawnShift

# 1. A read-only GitHub token so the server can download from the private repo.
if [ ! -s /root/.dawnshift-token ]; then
  read -rsp "Paste your GitHub token (starts with github_pat_): " T
  echo
  [ -n "$T" ] || { echo "No token given, stopping."; exit 1; }
  printf '%s' "$T" > /root/.dawnshift-token
  chmod 600 /root/.dawnshift-token
fi

# 2. Node.js 20+ and a dedicated user for the service.
apt-get install -y -qq curl ca-certificates tar zip >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'parseInt(process.versions.node)')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
id dawnshift >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin dawnshift
mkdir -p "$APP_DIR" "$DATA_DIR"
chown dawnshift: "$DATA_DIR"
chmod 700 "$DATA_DIR"

# The service needs read access to the GitHub token so it can proxy app
# downloads (/api/download/<os> on the site). Mode 640, owned by root with
# group dawnshift, so root keeps write and the service can only read.
install -m 640 -o root -g dawnshift /root/.dawnshift-token /etc/dawnshift-token

# 3. One-shot migration from the old /var/lib/dawnshift-sync layout. Keeps
#    accounts.json (users can still log in); the per-user blobs don't carry
#    over because the new storage shape is different.
if [ -d /var/lib/dawnshift-sync ] && [ ! -f "$DATA_DIR/accounts.json" ]; then
  cp /var/lib/dawnshift-sync/accounts.json "$DATA_DIR/accounts.json" 2>/dev/null || true
  chown dawnshift: "$DATA_DIR/accounts.json" 2>/dev/null || true
fi

# 4. The dawnshift-update command, then the first fetch.
cat > /usr/local/bin/dawnshift-update <<EOF
#!/bin/sh
# Downloads the latest Dawnshift from GitHub and installs it under $APP_DIR.
set -e
TOKEN=\$(cat /root/.dawnshift-token)
tmp=\$(mktemp -d)
trap "rm -rf \$tmp" EXIT
curl -fsSL -H "Authorization: Bearer \$TOKEN" -H "Accept: application/vnd.github+json" \\
  "https://api.github.com/repos/$REPO/tarball/$BRANCH" -o "\$tmp/src.tgz"
mkdir -p "\$tmp/src"
tar -xzf "\$tmp/src.tgz" -C "\$tmp/src"
inner=\$(ls "\$tmp/src" | head -1)
rm -rf "$APP_DIR.new"
mkdir -p "$APP_DIR.new"
cp -a "\$tmp/src/\$inner/dawnshift/." "$APP_DIR.new/"
cd "$APP_DIR.new"
npm ci --omit=dev --no-audit --no-fund >/dev/null
# Builds web-dist/ (static site + versioned service worker), from the shipped
# source. Pure Node + the zip CLI; no extra deps.
npm run build:web >/dev/null
rm -rf "$APP_DIR.old"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$APP_DIR.old"
mv "$APP_DIR.new" "$APP_DIR"
rm -rf "$APP_DIR.old"
if [ -f /etc/systemd/system/dawnshift.service ]; then systemctl restart dawnshift; fi
echo "Dawnshift is up to date."
EOF
chmod +x /usr/local/bin/dawnshift-update
if ! dawnshift-update; then
  # Don't delete the token on every failure (a build or npm hiccup looks the
  # same as a bad token at this point). Only drop it when the download itself
  # couldn't authenticate.
  if ! curl -fsSL -o /dev/null -H "Authorization: Bearer $(cat /root/.dawnshift-token)" "https://api.github.com/repos/$REPO" 2>/dev/null; then
    rm -f /root/.dawnshift-token
    echo "Download failed: the token can't reach $REPO. Make a new one (Contents: Read-only) and run this again."
  else
    echo "Download failed, but the token still works. Scroll up for the real error and run this again."
  fi
  exit 1
fi

# 5. systemd service. The server also serves static files from public/, so
#    nothing else has to.
cat > /etc/systemd/system/dawnshift.service <<EOF
[Unit]
Description=Dawnshift (hosted app)
After=network.target

[Service]
User=dawnshift
WorkingDirectory=$APP_DIR
Environment=PORT=$PORT HOST=127.0.0.1 DATA_DIR=$DATA_DIR STATIC_DIR=$APP_DIR/web-dist NODE_ENV=production DAWNSHIFT_GH_TOKEN_FILE=/etc/dawnshift-token
ExecStart=$(command -v node) $APP_DIR/sync-server/server.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
ReadOnlyPaths=/etc/dawnshift-token

[Install]
WantedBy=multi-user.target
EOF
# Retire the old service if it's around.
if [ -f /etc/systemd/system/dawnshift-sync.service ]; then
  systemctl disable --now dawnshift-sync >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/dawnshift-sync.service
fi
systemctl daemon-reload
systemctl enable dawnshift >/dev/null 2>&1
systemctl restart dawnshift

# 6. Nginx: proxy everything to the server. No more /var/www/dawnshift split.
mkdir -p /etc/nginx/snippets
cat > /etc/nginx/snippets/dawnshift-app.conf <<EOF
# Dawnshift serves both the page and the API, so hand everything to the app.
client_max_body_size 10m;
proxy_http_version 1.1;
proxy_set_header Host \$host;
proxy_set_header X-Real-IP \$remote_addr;
proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto \$scheme;
# AI calls can take a while.
proxy_read_timeout 600s;
proxy_send_timeout 600s;

location / {
    proxy_pass http://127.0.0.1:$PORT;
}
EOF

SITE=/etc/nginx/sites-available/$DOMAIN
LISTEN6=""
[ -e /proc/net/if_inet6 ] && LISTEN6="listen [::]:80;"
[ -f "$SITE" ] && cp "$SITE" "$SITE.bak"
if ! grep -qs "managed by Certbot" "$SITE"; then
cat > "$SITE" <<EOF
server {
    listen 80;
    $LISTEN6
    server_name $DOMAIN;
    include snippets/dawnshift-app.conf;
}
EOF
else
  # Replace the legacy split (root /var/www/dawnshift + /api/ proxy) with one
  # include that hands every path to the app.
  if grep -q "dawnshift-api.conf" "$SITE"; then
    sed -i '/root \/var\/www\/dawnshift/d; /index index.html/d; /include snippets\/dawnshift-api.conf/d; /location \/ {/,/}/d; /location = \/manifest.webmanifest/,/}/d; /location = \/sw.js/,/}/d' "$SITE"
  fi
  if ! grep -q "dawnshift-app.conf" "$SITE"; then
    sed -i "s|server_name $DOMAIN;|&\n    include snippets/dawnshift-app.conf;|" "$SITE"
  fi
fi
ln -sf "$SITE" "/etc/nginx/sites-enabled/$DOMAIN"
if ! nginx -t; then
  [ -f "$SITE.bak" ] && mv "$SITE.bak" "$SITE" || rm -f "/etc/nginx/sites-enabled/$DOMAIN"
  echo "Nginx didn't accept the change, so it was undone. Your other sites are untouched."
  exit 1
fi
rm -f "$SITE.bak"
systemctl reload nginx

# 7. HTTPS.
if certbot --nginx -d "$DOMAIN" --redirect --non-interactive; then
  echo
  echo "All done! Open https://$DOMAIN"
else
  echo
  echo "Dawnshift is installed, but HTTPS isn't set up yet. Make sure the DNS record"
  echo "for $DOMAIN exists, wait a few minutes, then run: certbot --nginx -d $DOMAIN"
fi
