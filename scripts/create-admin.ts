/**
 * Controlled bootstrap / break-glass recovery for admin accounts. Run it
 * with production credentials only from a trusted machine (e.g. `railway run`).
 *
 *   npm run admin:create -- --email owner@example.com --name "Jane Doe"   create (OWNER by default)
 *   npm run admin:create -- --email owner@example.com --reset             new password
 *   npm run admin:create -- --email owner@example.com --reset-mfa         lost authenticator: clear
 *                                                                          two-factor so it's re-enrolled
 *
 * The password is prompted for (hidden) unless --password is given or
 * ADMIN_PASSWORD is set. Roles: OWNER | ADMIN. Every path signs the account
 * out everywhere; two-factor enrolment is always required at next sign-in.
 */
import "dotenv/config";
import { createInterface } from "node:readline";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { validatePasswordStrength } from "../src/lib/auth/password";
import { createPasswordAdmin, setAdminPassword } from "../src/lib/auth/accounts";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    out._writeToOutput = (s: string) => {
      if (s.includes(question)) out.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  const reset = process.argv.includes("--reset");
  const role = (arg("role") ?? "OWNER").toUpperCase() as "OWNER" | "ADMIN";
  const resetMfa = process.argv.includes("--reset-mfa");
  if (!email) throw new Error("Usage: npm run admin:create -- --email you@example.com --name \"Your Name\" [--reset | --reset-mfa]");
  if (!["OWNER", "ADMIN"].includes(role)) throw new Error("--role must be OWNER or ADMIN");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const existing = await prisma.adminUser.findUnique({ where: { email } });
    if (resetMfa) {
      if (!existing) throw new Error(`No admin with email ${email}.`);
      await prisma.$transaction([
        prisma.adminTwoFactor.deleteMany({ where: { userId: existing.id } }),
        prisma.adminUser.update({ where: { id: existing.id }, data: { twoFactorEnabled: false } }),
        prisma.adminSession.deleteMany({ where: { userId: existing.id } }),
        prisma.activityLog.create({ data: { type: "admin.mfa_reset", message: `Two-factor reset for ${email} from the command line`, entityType: "admin", entityId: existing.id } }),
      ]);
      console.log(`Two-factor cleared for ${email}. They'll set up a new authenticator at next sign-in.`);
      return;
    }

    const password = arg("password") ?? process.env.ADMIN_PASSWORD ?? (await promptHidden("Password: "));
    const problem = validatePasswordStrength(password);
    if (problem) throw new Error(problem);

    if (existing) {
      if (!reset) throw new Error(`An admin with email ${email} already exists. Use --reset to change their password.`);
      await setAdminPassword(prisma, existing.id, password);
      await prisma.$transaction([
        prisma.adminUser.update({ where: { id: existing.id }, data: { active: true } }),
        prisma.adminSession.deleteMany({ where: { userId: existing.id } }),
        prisma.activityLog.create({ data: { type: "admin.password_reset", message: `Password reset for ${email} from the command line`, entityType: "admin", entityId: existing.id } }),
      ]);
      console.log(`Password reset for ${email}. Existing sessions were signed out.`);
    } else {
      const user = await createPasswordAdmin(prisma, { email, name: name || email, role }, password);
      await prisma.activityLog.create({ data: { type: "admin.created", message: `Admin ${email} (${role.toLowerCase()}) created from the command line`, entityType: "admin", entityId: user.id } });
      console.log(`Created ${role.toLowerCase()} account for ${email}. Two-factor setup is required at first sign-in.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
