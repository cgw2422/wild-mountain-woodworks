/**
 * DEVELOPMENT/QA ONLY: mint an admin session for automated smoke tests.
 * Prints a cookie header value: wm_admin.session_token=<signed token>
 *
 *   npx tsx scripts/dev-session.ts [email]
 *
 * Without an email it uses a dedicated "qa@localhost" owner account (created
 * on demand, with two-factor marked as enrolled and no usable password), so
 * real accounts' two-factor settings are never touched. Refuses to run in
 * production.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { mintAdminSession } from "../src/lib/auth/mint-session";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run in production.");
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error(`Refusing to mint a QA session against a non-local database (${host || "unknown host"}).`);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const email = process.argv[2];
  const user = email
    ? await prisma.adminUser.findUnique({ where: { email } })
    : await prisma.adminUser.upsert({
        where: { email: "qa@localhost" },
        update: {},
        create: {
          email: "qa@localhost",
          name: "QA",
          role: "OWNER",
          twoFactorEnabled: true,
          adminaccounts: { create: { accountId: randomBytes(8).toString("hex"), providerId: "qa-only" } },
        },
      });
  if (!user) throw new Error(`No admin user ${email}.`);
  if (!user.twoFactorEnabled) console.error(`Note: ${user.email} hasn't set up two-factor yet, so admin pages will redirect to enrolment.`);
  const { cookie } = await mintAdminSession(prisma, user.id);
  console.log(cookie);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
