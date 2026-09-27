import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/auth/session";
import { Logo } from "@/components/brand/Logo";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentAdmin()) redirect("/admin");
  const { next } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-charcoal px-5 py-16">
      <div className="w-full max-w-sm">
        <Logo variant="stacked" className="mx-auto mb-10 w-56 text-ivory" />
        <div className="bg-ivory p-8 shadow-sm">
          <h1 className="font-display text-2xl">Admin sign in</h1>
          <p className="mt-1 text-sm text-muted">Manage the Wild Mountain website.</p>
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
