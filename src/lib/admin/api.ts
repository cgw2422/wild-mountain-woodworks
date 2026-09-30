import { can, type Permission } from "@/lib/auth/permissions";
import "server-only";
import { getCurrentAdmin } from "@/lib/auth/session";

/**
 * Guard for admin JSON/upload route handlers: validates the session and
 * rejects cross-origin requests (CSRF defense in addition to SameSite=Lax
 * cookies). Server actions get equivalent origin checks from Next.js.
 */
export async function guardAdminApi(request: Request, permission: Permission) {
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && origin) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    try {
      if (new URL(origin).host !== host) return { error: Response.json({ error: "Forbidden" }, { status: 403 }) } as const;
    } catch {
      return { error: Response.json({ error: "Forbidden" }, { status: 403 }) } as const;
    }
  }
  const admin = await getCurrentAdmin();
  if (!admin) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  // Default deny: the role must have this route's permission.
  if (!can(admin.role, permission)) return { error: Response.json({ error: "Forbidden" }, { status: 403 }) } as const;
  return { admin } as const;
}
