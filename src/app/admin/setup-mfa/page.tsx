import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSignedIn } from "@/lib/auth/session";
import { AuthShell } from "../login/AuthShell";
import { logoutAction } from "../login/actions";
import { EnrollForm } from "./EnrollForm";

export const metadata: Metadata = { title: "Set up two-factor authentication", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Mandatory for every admin: until an authenticator app is enrolled, this is
 * the only admin page a signed-in account can reach.
 */
export default async function SetupMfaPage() {
  const { admin, mfaEnrolled } = await requireSignedIn();
  if (mfaEnrolled) redirect("/admin");
  return (
    <AuthShell
      wide
      title="Set up two-factor authentication"
      intro={
        <>
          Required for every admin account. You&apos;ll need an authenticator app such as Google Authenticator, Microsoft Authenticator, 1Password or Authy. Signed in as{" "}
          {admin.email}.
        </>
      }
    >
      <EnrollForm />
      <form action={logoutAction} className="mt-4 text-center">
        <button type="submit" className="py-2 text-sm text-muted underline">
          Sign out
        </button>
      </form>
    </AuthShell>
  );
}
