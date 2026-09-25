#!/bin/bash
# Installs the web version of Dawnshift on a server that already runs Nginx
# and Certbot for other sites. Safe to run again: it only touches Dawnshift's
# own files, and it never reloads Nginx with a broken config.
set -euo pipefail
DOMAIN=${DOMAIN:-dawnshift.dawnlife.online}

# 1. A read-only GitHub token, so the server can download from the private repo.
if [ ! -s /root/.dawnshift-token ]; then
  read -rsp "Paste your GitHub token (starts with github_pat_): " T
  echo
  [ -n "$T" ] || { echo "No token given, stopping."; exit 1; }
  printf '%s' "$T" > /root/.dawnshift-token
  chmod 600 /root/.dawnshift-token
fi

# 2. The dawnshift-update command, then the first download.
apt-get install -y -qq unzip curl >/dev/null
cat > /usr/local/bin/dawnshift-update <<'EOF'
#!/bin/sh
set -e
TOKEN=$(cat /root/.dawnshift-token)
curl -fsSL -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github.raw" \
  "https://api.github.com/repos/OliverZS2005/ClaudeCodeIsTuff/contents/dawnshift/release/dawnshift-web.zip?ref=claude/ai-grok-bot-x5v1dx" \
  -o /tmp/dawnshift-web.zip
mkdir -p /var/www/dawnshift
unzip -oq /tmp/dawnshift-web.zip -d /var/www/dawnshift
rm /tmp/dawnshift-web.zip
echo "Dawnshift is up to date."
EOF
chmod +x /usr/local/bin/dawnshift-update
if ! dawnshift-update; then
  rm -f /root/.dawnshift-token
  echo "Download failed. Check that the token has Contents: Read-only access to ClaudeCodeIsTuff, then run this again."
  exit 1
fi

# 3. The Nginx site. Once Certbot has added HTTPS to it, leave it alone.
SITE="/etc/nginx/sites-available/$DOMAIN"
# Only listen on IPv6 if this machine has it, or Nginx refuses the config.
LISTEN6=""
[ -e /proc/net/if_inet6 ] && LISTEN6="listen [::]:80;"
if ! grep -qs "managed by Certbot" "$SITE"; then
cat > "$SITE" <<EOF
server {
    listen 80;
    $LISTEN6
    server_name $DOMAIN;
    root /var/www/dawnshift;
    index index.html;

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
fi
ln -sf "$SITE" "/etc/nginx/sites-enabled/$DOMAIN"
if ! nginx -t; then
  rm -f "/etc/nginx/sites-enabled/$DOMAIN"
  echo "Nginx didn't accept the new site, so it was removed again. Your other sites are untouched."
  exit 1
fi
systemctl reload nginx

# 4. HTTPS.
if certbot --nginx -d "$DOMAIN" --redirect --non-interactive; then
  echo
  echo "All done! Open https://$DOMAIN"
else
  echo
  echo "Dawnshift is installed, but HTTPS isn't set up yet. Make sure the DNS record"
  echo "for $DOMAIN exists, wait a few minutes, then run: certbot --nginx -d $DOMAIN"
fi
