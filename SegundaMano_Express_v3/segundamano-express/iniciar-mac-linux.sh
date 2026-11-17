#!/bin/sh
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Necesitas instalar Node.js desde https://nodejs.org (versión LTS)."; exit 1; }
( sleep 1; (open http://localhost:3000 || xdg-open http://localhost:3000) >/dev/null 2>&1 ) &
node server.js
