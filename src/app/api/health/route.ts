import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { pendingMigrations } from "@/lib/migrations-status";

export const dynamic = "force-dynamic";

/**
 * Railway health check. Verifies the database is configured, reachable and
 * has every migration this build ships, and reports which step is failing
 * (never any secret values).
 */
export async function GET() {
  const started = Date.now();
  const headers = { "Cache-Control": "no-store" };
  if (!process.env.DATABASE_URL) {
    return Response.json(
      { status: "error", database: "not_configured", hint: "Set DATABASE_URL on the web service (Railway: ${{Postgres.DATABASE_URL}})." },
      { status: 503, headers },
    );
  }
  try {
    const rows = await prisma.$queryRaw<Array<{ ok: string | null }>>`SELECT to_regclass('public."SiteSetting"')::text AS ok`;
    if (!rows[0]?.ok) {
      return Response.json(
        { status: "error", database: "migrations_pending", hint: "Run `npx prisma migrate deploy` against this database." },
        { status: 503, headers },
      );
    }
    // Every migration shipped with this build must be applied. Otherwise pages
    // that read newer columns fail while simpler ones work, so report 503 and
    // Railway won't switch traffic to this deploy.
    const pending = await pendingMigrations();
    if (pending.length) {
      logger.error("Database migrations pending", { pending });
      return Response.json(
        {
          status: "error",
          database: "migrations_pending",
          pending,
          hint: "The pre-deploy step (npm run deploy:prepare) or the start script should apply these. Check the deploy logs for [predeploy] / [start] lines.",
        },
        { status: 503, headers },
      );
    }
    // Whether admin sign-in is configured (never the secret itself). The public site works either way.
    const secret = process.env.BETTER_AUTH_SECRET;
    const adminAuth = secret && secret.length >= 32 ? "ok" : process.env.NODE_ENV === "production" ? "missing_secret" : "development_secret";
    return Response.json({ status: "ok", database: "ok", adminAuth, latencyMs: Date.now() - started }, { headers });
  } catch (error) {
    logger.error("Health check failed", { error });
    const code = (error as { code?: string })?.code;
    return Response.json(
      {
        status: "error",
        database: "unreachable",
        code: code ?? null,
        hint: "The database could not be reached. Check that DATABASE_URL references the Postgres service and that it is running.",
      },
      { status: 503, headers },
    );
  }
}
