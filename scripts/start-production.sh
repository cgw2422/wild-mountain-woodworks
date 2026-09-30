#!/bin/sh
# Production start (Railway). Migrations and required default content are
# handled once per deploy by the pre-deploy step (scripts/predeploy.sh), so
# a restart never touches the database schema or content.
set -e

if [ -z "$DATABASE_URL" ] && ! grep -q "^DATABASE_URL=" .env 2>/dev/null; then
  echo "[start] FATAL: DATABASE_URL is not set. On Railway, add a variable DATABASE_URL = \${{Postgres.DATABASE_URL}} to this service." >&2
  exit 1
fi

echo "[start] starting Next.js on port ${PORT:-3000}…"
exec npx next start -p "${PORT:-3000}"
