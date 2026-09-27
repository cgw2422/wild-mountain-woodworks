/**
 * Create an admin user, or reset an existing admin's password.
 *
 *   npm run admin:create -- --email owner@example.com --name "Jane Doe"
 *   npm run admin:create -- --email owner@example.com --reset
 *
 * The password is prompted for (hidden) unless --password is given or
 * ADMIN_PASSWORD is set. Roles: OWNER | ADMIN | EDITOR (default OWNER).
 */
import "dotenv/config";
import { createInterface } from "node:readline";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword, validatePasswordStrength } from "../src/lib/auth/password";

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
  const role = (arg("role") ?? "OWNER").toUpperCase() as "OWNER" | "ADMIN" | "EDITOR";
  if (!email) throw new Error("Usage: npm run admin:create -- --email you@example.com --name \"Your Name\" [--reset]");
  if (!["OWNER", "ADMIN", "EDITOR"].includes(role)) throw new Error("--role must be OWNER, ADMIN or EDITOR");

  const password = arg("password") ?? process.env.ADMIN_PASSWORD ?? (await promptHidden("Password: "));
  const problem = validatePasswordStrength(password);
  if (problem) throw new Error(problem);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const existing = await prisma.adminUser.findUnique({ where: { email } });
    if (existing) {
      if (!reset) throw new Error(`An admin with email ${email} already exists. Use --reset to change their password.`);
      await prisma.adminUser.update({ where: { email }, data: { passwordHash: await hashPassword(password), active: true } });
      await prisma.adminSession.deleteMany({ where: { userId: existing.id } });
      console.log(`Password reset for ${email}. Existing sessions were signed out.`);
    } else {
      await prisma.adminUser.create({ data: { email, name: name || email, role, passwordHash: await hashPassword(password) } });
      console.log(`Created ${role.toLowerCase()} account for ${email}.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
