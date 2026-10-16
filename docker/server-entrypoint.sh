#!/bin/sh
# Applies database migrations (when Postgres is configured) and starts the server.
# The server seeds the Movie table from catalog.json on first boot.
set -e

if [ -n "$DATABASE_URL" ]; then
  echo "[entrypoint] applying database migrations..."
  i=0
  until node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma; do
    i=$((i + 1))
    if [ "$i" -ge 10 ]; then
      echo "[entrypoint] WARN: migrations failed 10 times - starting anyway (durable writes will queue and retry)"
      break
    fi
    echo "[entrypoint] database not ready, retrying in 2s ($i/10)"
    sleep 2
  done
fi

exec node apps/server/dist/index.js
