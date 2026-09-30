import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

type Db = Prisma.TransactionClient | typeof prisma;

export const NUMBER_PREFIXES = { quote: "WMQ", invoice: "WMI", order: "WMO" } as const;
export type NumberKind = keyof typeof NUMBER_PREFIXES;

/**
 * Next sequential customer-facing number (WMQ-1001, WMI-1001, WMO-1001).
 * A single atomic upsert, so concurrent requests never get the same number.
 * Numbers are never reused, even if the record is later canceled.
 */
export async function nextNumber(kind: NumberKind, db: Db = prisma): Promise<string> {
  const rows = await db.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "Counter" ("key", "value") VALUES (${kind}, 1001)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  return `${NUMBER_PREFIXES[kind]}-${rows[0]!.value}`;
}
