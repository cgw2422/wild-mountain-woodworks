#!/bin/sh
# Railway pre-deploy step (railway.json → deploy.preDeployCommand).
# Runs once per deploy, before the new version starts serving traffic.
# Any failure exits non-zero, which stops the deploy; the previous version
# keeps running.
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[predeploy] FATAL: DATABASE_URL is not set. On Railway, add a variable DATABASE_URL = \${{Postgres.DATABASE_URL}} to this service." >&2
  exit 1
fi

echo "[predeploy] applying database migrations…"
npx prisma migrate deploy

echo "[predeploy] inserting missing required content (production-safe, insert-only)…"
npx tsx scripts/seed-production.ts

echo "[predeploy] done."
