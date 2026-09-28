/**
 * DEVELOPMENT/QA ONLY: mint an admin session for automated smoke tests.
 * Prints a cookie header value: wm_admin_session=<token>
 *
 *   npx tsx scripts/dev-session.ts [email]
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { generateSessionToken, hashSessionToken, SESSION_COOKIE, SESSION_TTL_MS } from "../src/lib/auth/tokens";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run in production.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const email = process.argv[2];
  const user = email ? await prisma.adminUser.findUnique({ where: { email } }) : await prisma.adminUser.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) throw new Error("No admin user found. Run the seed with ADMIN_EMAIL/ADMIN_PASSWORD first.");
  const token = generateSessionToken();
  await prisma.adminSession.create({ data: { tokenHash: hashSessionToken(token), userId: user.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
  console.log(`${SESSION_COOKIE}=${token}`);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
