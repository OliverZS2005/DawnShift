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
