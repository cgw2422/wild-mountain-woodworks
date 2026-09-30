import "server-only";
import { readdirSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";

let local: string[] | null | undefined;

/** Migration folders shipped with this build (null if they can't be read, e.g. an unusual deploy layout). */
function localMigrations(): string[] | null {
  if (local !== undefined) return local;
  try {
    local = readdirSync(path.join(process.cwd(), "prisma", "migrations"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    local = null;
  }
  return local;
}

/**
 * Migrations this build ships that the database hasn't applied. Empty when up
 * to date. A database that is AHEAD of the code (e.g. after rolling back to an
 * older deploy) counts as up to date, since migrations only add.
 */
export async function pendingMigrations(): Promise<string[]> {
  const names = localMigrations();
  if (!names?.length) return [];
  const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
    SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  const applied = new Set(rows.map((r) => r.migration_name));
  return names.filter((n) => !applied.has(n));
}
