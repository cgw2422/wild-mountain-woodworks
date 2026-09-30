import type { AdminRole, PrismaClient } from "@/generated/prisma/client";
import { hashAdminPassword } from "./password";

type Db = Pick<PrismaClient, "adminUser" | "adminAccount">;

/**
 * Create an admin with an email/password credential in the shape Better Auth
 * expects (providerId "credential", accountId = the user's id). Used by every
 * controlled creation path: the seed, `admin:create`, and owners in
 * Admin → Security. Two-factor enrolment is required at first sign-in.
 */
export async function createPasswordAdmin(db: Db, data: { email: string; name: string; role: AdminRole }, password: string) {
  const hash = await hashAdminPassword(password);
  const user = await db.adminUser.create({ data: { email: data.email, name: data.name, role: data.role, twoFactorEnabled: false } });
  await db.adminAccount.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash } });
  return user;
}

/** Set (or create) an admin's password credential. */
export async function setAdminPassword(db: Db, userId: string, password: string) {
  const hash = await hashAdminPassword(password);
  const account = await db.adminAccount.findFirst({ where: { userId, providerId: "credential" }, select: { id: true } });
  if (account) await db.adminAccount.update({ where: { id: account.id }, data: { password: hash, accountId: userId } });
  else await db.adminAccount.create({ data: { userId, accountId: userId, providerId: "credential", password: hash } });
}
