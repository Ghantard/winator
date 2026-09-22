#!/bin/sh
# Launcher: installs what is missing, then opens the interface in the browser.
# Arguments, if any, go straight to the CLI.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 ou plus est requis : https://nodejs.org" >&2
  exit 1
fi

[ -d node_modules ] || { echo "Installation des dépendances…"; npm ci --no-audit --no-fund; }
[ -f dist/cli.js ] || { echo "Compilation…"; npm run build; }

if [ "$#" -gt 0 ]; then
  exec node dist/cli.js "$@"
fi

# No argument: open the interface in the browser.
exec node dist/cli.js ui
