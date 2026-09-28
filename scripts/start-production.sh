#!/bin/sh
# Production start (Railway): apply migrations, run the idempotent seed, start.
#
# - Migrations must succeed, otherwise the deploy fails loudly (instead of the
#   site starting against missing tables).
# - The seed only creates what's missing (settings, CMS pages, first admin from
#   ADMIN_EMAIL/ADMIN_PASSWORD, sample content in an empty catalog). A seed
#   problem is logged but never blocks the site from starting.
set -e

if [ -z "$DATABASE_URL" ] && ! grep -q "^DATABASE_URL=" .env 2>/dev/null; then
  echo "[start] FATAL: DATABASE_URL is not set. On Railway, add a variable DATABASE_URL = \${{Postgres.DATABASE_URL}} to this service." >&2
  exit 1
fi

echo "[start] applying database migrations…"
npx prisma migrate deploy

echo "[start] seeding (idempotent)…"
npm run db:seed || echo "[start] WARNING: seed failed — the site will still start. Check the log above."

echo "[start] starting Next.js on port ${PORT:-3000}…"
exec npx next start -p "${PORT:-3000}"
