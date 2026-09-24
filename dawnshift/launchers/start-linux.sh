#!/bin/sh
# Run this to start Dawnshift on Linux: ./start-linux.sh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1 || ! node -e "process.exit(parseInt(process.versions.node) < 20 ? 1 : 0)"; then
  echo "Dawnshift needs Node.js version 20 or newer. Get it from https://nodejs.org"
  exit 1
fi
exec node server.js --open
