#!/bin/bash
# Installs the web version of Dawnshift, plus its account/sync server, on a
# server that already runs Nginx and Certbot for other sites. Safe to run
# again: it only touches Dawnshift's own files, and it never leaves Nginx
# with a broken config.
set -euo pipefail
DOMAIN=${DOMAIN:-dawnshift.dawnlife.online}
SYNC_PORT=3790

# 1. A read-only GitHub token, so the server can download from the private repo.
if [ ! -s /root/.dawnshift-token ]; then
  read -rsp "Paste your GitHub token (starts with github_pat_): " T
  echo
  [ -n "$T" ] || { echo "No token given, stopping."; exit 1; }
  printf '%s' "$T" > /root/.dawnshift-token
  chmod 600 /root/.dawnshift-token
fi

# 2. Node.js for the account server, and a user for it to run as.
apt-get install -y -qq unzip curl >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'parseInt(process.versions.node)')" -lt 18 ]; then
  apt-get install -y -qq nodejs >/dev/null
fi
id dawnshift >/dev/null 2>&1 || useradd --system --home-dir /var/lib/dawnshift-sync --shell /usr/sbin/nologin dawnshift
mkdir -p /opt/dawnshift-sync /var/lib/dawnshift-sync
chown dawnshift: /var/lib/dawnshift-sync
chmod 700 /var/lib/dawnshift-sync

# 3. The dawnshift-update command, then the first download.
cat > /usr/local/bin/dawnshift-update <<'EOF'
#!/bin/sh
# Downloads the latest Dawnshift (web app and account server) from GitHub.
set -e
TOKEN=$(cat /root/.dawnshift-token)
get() {
  curl -fsSL -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github.raw" \
    "https://api.github.com/repos/OliverZS2005/ClaudeCodeIsTuff/contents/dawnshift/release/$1?ref=claude/ai-grok-bot-x5v1dx" \
    -o "/tmp/$1"
}
get dawnshift-web.zip
get dawnshift-sync.zip
mkdir -p /var/www/dawnshift /opt/dawnshift-sync
unzip -oq /tmp/dawnshift-web.zip -d /var/www/dawnshift
unzip -oq /tmp/dawnshift-sync.zip -d /opt/dawnshift-sync
rm -f /tmp/dawnshift-web.zip /tmp/dawnshift-sync.zip
if [ -f /etc/systemd/system/dawnshift-sync.service ]; then systemctl restart dawnshift-sync; fi
echo "Dawnshift is up to date."
EOF
chmod +x /usr/local/bin/dawnshift-update
if ! dawnshift-update; then
  rm -f /root/.dawnshift-token
  echo "Download failed. Check that the token has Contents: Read-only access to ClaudeCodeIsTuff, then run this again."
  exit 1
fi

# 4. Run the account server in the background, restarting it if it stops.
cat > /etc/systemd/system/dawnshift-sync.service <<EOF
[Unit]
Description=Dawnshift account and sync server
After=network.target

[Service]
User=dawnshift
Environment=PORT=$SYNC_PORT HOST=127.0.0.1 DATA_DIR=/var/lib/dawnshift-sync
ExecStart=$(command -v node) /opt/dawnshift-sync/server.js
Restart=on-failure
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable dawnshift-sync >/dev/null 2>&1
systemctl restart dawnshift-sync

# 5. Nginx: the app's files, and /api/ passed on to the account server.
mkdir -p /etc/nginx/snippets
cat > /etc/nginx/snippets/dawnshift-api.conf <<EOF
location /api/ {
    proxy_pass http://127.0.0.1:$SYNC_PORT;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    client_max_body_size 10m;
}
EOF

SITE="/etc/nginx/sites-available/$DOMAIN"
# Only listen on IPv6 if this machine has it, or Nginx refuses the config.
LISTEN6=""
[ -e /proc/net/if_inet6 ] && LISTEN6="listen [::]:80;"
if [ -f "$SITE" ]; then cp "$SITE" "$SITE.bak"; fi
if ! grep -qs "managed by Certbot" "$SITE"; then
cat > "$SITE" <<EOF
server {
    listen 80;
    $LISTEN6
    server_name $DOMAIN;
    root /var/www/dawnshift;
    index index.html;
    include snippets/dawnshift-api.conf;

    location / {
        try_files \$uri \$uri/ =404;
    }

    # Lets phones recognize Dawnshift as an installable app.
    location = /manifest.webmanifest {
        default_type application/manifest+json;
    }

    # Always check for a newer version of the app.
    location = /sw.js {
        add_header Cache-Control "no-cache";
    }
}
EOF
elif ! grep -q "dawnshift-api.conf" "$SITE"; then
  # Certbot already added HTTPS to this site: just add the /api/ part.
  sed -i 's|^\(\s*\)root /var/www/dawnshift;|&\n\1include snippets/dawnshift-api.conf;|' "$SITE"
fi
ln -sf "$SITE" "/etc/nginx/sites-enabled/$DOMAIN"
if ! nginx -t; then
  if [ -f "$SITE.bak" ]; then mv "$SITE.bak" "$SITE"; else rm -f "/etc/nginx/sites-enabled/$DOMAIN"; fi
  echo "Nginx didn't accept the change, so it was undone. Your other sites are untouched."
  exit 1
fi
rm -f "$SITE.bak"
systemctl reload nginx

# 6. HTTPS.
if certbot --nginx -d "$DOMAIN" --redirect --non-interactive; then
  echo
  echo "All done! Open https://$DOMAIN"
else
  echo
  echo "Dawnshift is installed, but HTTPS isn't set up yet. Make sure the DNS record"
  echo "for $DOMAIN exists, wait a few minutes, then run: certbot --nginx -d $DOMAIN"
fi
