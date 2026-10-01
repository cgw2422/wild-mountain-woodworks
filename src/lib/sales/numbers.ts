import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

type Db = Prisma.TransactionClient | typeof prisma;

/** Prefixes for NEW records. Older records keep their historical WMQ-/WMO-/WMI- numbers forever. */
export const NUMBER_PREFIXES = { quote: "WMWQ", invoice: "WMWI", order: "WMWO" } as const;
export type NumberKind = keyof typeof NUMBER_PREFIXES;

/** The first number issued under the current prefixes (WMWQ-2001, WMWO-2001, WMWI-2001). */
export const FIRST_NUMBER = 2001;

/**
 * Each kind has its own counter row, keyed by its prefix (`WMWQ`, `WMWO`,
 * `WMWI`), separate from the retired `quote`/`order`/`invoice` counters that
 * issued the historical numbers — so the old and new sequences never mix.
 */
export const counterKey = (kind: NumberKind) => NUMBER_PREFIXES[kind];

/**
 * Next customer-facing number: WMWQ-2001, WMWQ-2002… (quotes), WMWO-2001…
 * (orders), WMWI-2001… (invoices) — three independent sequences.
 *
 * A single atomic upsert in the database (row lock on the counter), so
 * concurrent requests can never receive the same number, and the unique
 * index on each `number` column backs that up. A number is consumed even if
 * the surrounding transaction later fails or the record is voided, canceled
 * or superseded — numbers are never reused.
 */
export async function nextNumber(kind: NumberKind, db: Db = prisma): Promise<string> {
  const rows = await db.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "Counter" ("key", "value") VALUES (${counterKey(kind)}, ${FIRST_NUMBER})
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  return `${NUMBER_PREFIXES[kind]}-${rows[0]!.value}`;
}

/** A quote number in the current (WMWQ-2001) or historical (WMQ-1001) format. */
export const QUOTE_NUMBER_PATTERN = /^(WMWQ|WMQ)-\d{4,}$/;
