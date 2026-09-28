import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Railway health check. Verifies the database is configured, reachable and
 * migrated, and reports which step is failing (never any secret values).
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
    return Response.json({ status: "ok", database: "ok", latencyMs: Date.now() - started }, { headers });
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
