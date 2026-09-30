import { guardAdminApi } from "@/lib/admin/api";
import { resolveEditContext } from "@/lib/admin-bar/context";
import { isPreviewing } from "@/lib/preview";

export const dynamic = "force-dynamic";

/**
 * Admin bar context for the public page being viewed: GET ?path=/about.
 * Signed-in staff only (401 otherwise) — anonymous visitors never learn
 * anything about records or editors.
 */
export async function GET(request: Request) {
  const guard = await guardAdminApi(request, "dashboard");
  if ("error" in guard) return guard.error;
  const path = new URL(request.url).searchParams.get("path") ?? "/";
  if (!path.startsWith("/") || path.startsWith("//") || path.length > 500) return Response.json({ error: "Bad path" }, { status: 400 });
  const context = await resolveEditContext(path, guard.admin.role);
  return Response.json({ ...context, previewing: await isPreviewing() }, { headers: { "Cache-Control": "private, no-store" } });
}
