#!/bin/sh
# Downloads the latest web version of Dawnshift from GitHub and puts it in
# /var/www/dawnshift. Needs a read-only GitHub token in /root/.dawnshift-token.
set -e
TOKEN=$(cat /root/.dawnshift-token)
BRANCH=${DAWNSHIFT_BRANCH:-claude/ai-grok-bot-x5v1dx}
curl -fsSL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github.raw" \
  "https://api.github.com/repos/OliverZS2005/ClaudeCodeIsTuff/contents/dawnshift/release/dawnshift-web.zip?ref=$BRANCH" \
  -o /tmp/dawnshift-web.zip
mkdir -p /var/www/dawnshift
unzip -oq /tmp/dawnshift-web.zip -d /var/www/dawnshift
rm /tmp/dawnshift-web.zip
echo "Dawnshift is up to date."
