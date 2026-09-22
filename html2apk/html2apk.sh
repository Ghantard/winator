#!/bin/sh
# Launcher: installs what is missing, then asks for the site address if none was
# given on the command line.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 ou plus est requis : https://nodejs.org" >&2
  exit 1
fi

[ -d node_modules ] || { echo "Installation des dépendances…"; npm ci --no-audit --no-fund; }
[ -f dist/cli.js ] || { echo "Compilation…"; npm run build; }

if [ "$#" -gt 0 ]; then
  exec node dist/cli.js build "$@"
fi

printf "Adresse du site (https://...) ou chemin d'un dossier : "
read -r site
[ -n "$site" ] || { echo "Aucune source indiquée." >&2; exit 1; }
printf "Nom de l'application (Entrée pour la valeur par défaut) : "
read -r nom

if [ -n "$nom" ]; then
  exec node dist/cli.js build "$site" --app-name "$nom"
fi
exec node dist/cli.js build "$site"
