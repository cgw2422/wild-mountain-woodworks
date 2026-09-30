/**
 * PRODUCTION-SAFE seed — runs in Railway's pre-deploy step after migrations
 * (scripts/predeploy.sh), and is safe to run by hand at any time.
 *
 *   npm run db:seed:production
 *
 * Inserts only missing REQUIRED records (settings row, CMS pages/sections,
 * one-time starter content, the first owner while no admin exists). It never
 * updates or deletes anything, never touches products, media or storage, and
 * never adds sample content. See src/lib/seed/defaults.ts.
 *
 * All-or-nothing: everything runs in one transaction under an advisory lock
 * (so overlapping deploys can't race). Any error rolls back every change and
 * exits non-zero, which fails the deploy — the previous version keeps
 * serving instead of a partially initialized one.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { applyRequiredDefaults } from "../src/lib/seed/defaults";

const LOCK_KEY = 72_310_041; // arbitrary constant for pg_advisory_xact_lock
const log = (m: string) => console.log(`[seed:production] ${m}`);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const created = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`;
        return applyRequiredDefaults(tx, log);
      },
      { timeout: 120_000, maxWait: 60_000 },
    );
    log(created ? `done — ${created} missing record(s) created; nothing existing was changed.` : "done — everything required already exists; nothing changed.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[seed:production] FAILED — no changes were saved. The deploy should stop here.");
  console.error(error);
  process.exit(1);
});
