import { draftMode } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { safePreviewPath } from "@/lib/preview";

export const dynamic = "force-dynamic";

/**
 * Start a secure preview: GET /api/admin/preview?path=/some-page
 *
 * Switches on Next.js Draft Mode only for signed-in, two-factor-enrolled
 * staff allowed to preview content. Draft Mode is not a credential: every previewed render
 * re-checks the session (src/lib/preview.ts). Anonymous visitors are sent to
 * sign in; nothing is revealed.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = safePreviewPath(url.searchParams.get("path"));
  const admin = await getCurrentAdmin();
  if (!admin) redirect(`/admin/login?next=${encodeURIComponent("/admin")}`);
  if (!can(admin.role, "content")) {
    return new Response("Your role can't preview this page.", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  (await draftMode()).enable();
  redirect(path);
}
