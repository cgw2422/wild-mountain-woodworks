#!/bin/sh
# Production start (Railway).
#
# Migrations and required default content are normally applied once per
# deploy by the pre-deploy step (npm run deploy:prepare). This script repeats
# both as a safety net, so the site can never run against an unmigrated
# database if the pre-deploy step didn't run:
#   - both are idempotent: when pre-deploy already ran they change nothing;
#   - the seed is the production-safe, insert-only one (never sample content,
#     never overwrites anything);
#   - any failure exits before Next.js starts, so the health check never
#     passes and Railway keeps serving the previous deploy.
set -eu

if [ -z "${DATABASE_URL:-}" ] && ! grep -q "^DATABASE_URL=" .env 2>/dev/null; then
  echo "[start] FATAL: DATABASE_URL is not set. On Railway, add a variable DATABASE_URL = \${{Postgres.DATABASE_URL}} to this service." >&2
  exit 1
fi

echo "[start] ensuring database migrations are applied (normally already done by pre-deploy)…"
npx prisma migrate deploy

echo "[start] ensuring required content exists (production-safe, insert-only)…"
npx tsx scripts/seed-production.ts

echo "[start] starting Next.js on port ${PORT:-3000}…"
exec npx next start -p "${PORT:-3000}"
