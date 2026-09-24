#!/bin/bash
# Double-click to start Dawnshift on a Mac.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1 || ! node -e "process.exit(parseInt(process.versions.node) < 20 ? 1 : 0)"; then
  echo "Dawnshift needs Node.js version 20 or newer."
  echo "Opening nodejs.org. Install the LTS version, then double-click this file again."
  open "https://nodejs.org"
  read -r -p "Press Enter to close this window."
  exit 1
fi
node server.js --open
