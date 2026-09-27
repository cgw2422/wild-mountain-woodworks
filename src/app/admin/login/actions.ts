"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { burnPasswordCheck, verifyPassword } from "@/lib/auth/password";
import { createAdminSession, destroyCurrentSession, getClientIp } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";

export type LoginState = { error?: string } | undefined;

const schema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().min(1).max(200),
  next: z.string().max(500).optional(),
});

function safeNext(next: string | undefined) {
  if (!next || !next.startsWith("/admin") || next.startsWith("//")) return "/admin";
  return next;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter your email and password." };
  const { email, password, next } = parsed.data;

  const ip = await getClientIp();
  const [byIp, byEmail] = await Promise.all([
    rateLimit(`login:ip:${ip}`, 20, 15 * 60),
    rateLimit(`login:email:${email}`, 8, 15 * 60),
  ]);
  if (!byIp.allowed || !byEmail.allowed) {
    return { error: "Too many sign-in attempts. Please wait 15 minutes and try again." };
  }

  const user = await prisma.adminUser.findUnique({ where: { email } });
  if (!user || !user.active) {
    await burnPasswordCheck(password);
    return { error: "That email and password combination isn't correct." };
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    return { error: "That email and password combination isn't correct." };
  }

  await createAdminSession(user.id);
  await logActivity("admin.login", `${user.name} signed in`, { actorId: user.id });
  redirect(safeNext(next));
}

export async function logoutAction() {
  await destroyCurrentSession();
  redirect("/admin/login");
}
