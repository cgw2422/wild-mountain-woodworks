import { draftMode } from "next/headers";
import { redirect } from "next/navigation";
import { safePreviewPath } from "@/lib/preview";

export const dynamic = "force-dynamic";

/** Leave preview. Safe for anyone: it only removes the Draft Mode cookie. */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("path") ?? "/";
  // Back to the admin editor, or to a site page.
  const path = raw.startsWith("/admin/") && !raw.startsWith("//") && !raw.includes("\\") ? raw : safePreviewPath(raw);
  (await draftMode()).disable();
  redirect(path);
}
