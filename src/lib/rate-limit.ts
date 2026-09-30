import "server-only";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Fixed-window rate limiter backed by PostgreSQL so limits hold across
 * multiple app instances and restarts. Fails open (allows the request) if the
 * database call itself fails, so a limiter hiccup never blocks customers.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowSeconds * 1000);
  try {
    const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
      VALUES (${key}, 1, ${resetAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."resetAt" < ${now} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" < ${now} THEN ${resetAt} ELSE "RateLimitBucket"."resetAt" END
      RETURNING "count", "resetAt"`;
    const row = rows[0]!;
    const count = Number(row.count);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(0, Math.ceil((new Date(row.resetAt).getTime() - now.getTime()) / 1000)),
    };
  } catch (error) {
    logger.warn("Rate limiter unavailable; allowing request", { error, key });
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
}

/** Occasionally purge expired buckets. */
export async function purgeExpiredRateLimits() {
  await prisma.rateLimitBucket.deleteMany({ where: { resetAt: { lt: new Date() } } });
}

/** Current count in an active window (0 if none), without recording a hit. */
export async function peekRateLimit(key: string): Promise<number> {
  try {
    const row = await prisma.rateLimitBucket.findUnique({ where: { key } });
    return row && row.resetAt > new Date() ? row.count : 0;
  } catch {
    return 0;
  }
}

export async function resetRateLimit(key: string) {
  await prisma.rateLimitBucket.deleteMany({ where: { key } }).catch(() => undefined);
}
