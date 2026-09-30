import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionState } from "@/lib/auth/session";
import { AuthShell } from "./AuthShell";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const state = await getSessionState();
  if (state) redirect(state.mfaEnrolled ? "/admin" : "/admin/setup-mfa");
  const { next } = await searchParams;
  return (
    <AuthShell title="Admin sign in" intro="Manage the Wild Mountain website.">
      <LoginForm next={next} />
    </AuthShell>
  );
}
