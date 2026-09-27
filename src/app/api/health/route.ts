import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Railway health check: verifies the app is serving and the database is reachable. */
export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", database: "ok", latencyMs: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("Health check failed", { error });
    return Response.json({ status: "error", database: "unreachable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
