import type { Metadata } from "next";
import { AuthShell } from "../AuthShell";
import { VerifyForm } from "./VerifyForm";

export const metadata: Metadata = { title: "Two-factor verification", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthShell title="Two-factor verification" intro="Enter the 6-digit code from your authenticator app.">
      <VerifyForm next={next} />
    </AuthShell>
  );
}
