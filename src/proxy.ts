import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Early routing for admin pages. NOT the security boundary: every admin page,
 * server action and API route validates the session, two-factor enrolment
 * and role on the server (src/lib/auth/session.ts). This only saves a round
 * trip for visitors without a session cookie, and keeps admin traffic on the
 * admin host when ADMIN_URL is set (e.g. https://admin.example.com).
 *
 * Deliberately narrow matcher: Next.js buffers request bodies in proxy (10 MB
 * cap), so public forms with uploads and /api/admin/* uploads must not pass
 * through here. /api/admin/* routes authenticate themselves.
 */
const PUBLIC_ADMIN_PATHS = ["/admin/login", "/admin/login/verify"];

function adminHost() {
  try {
    return process.env.ADMIN_URL ? new URL(process.env.ADMIN_URL).host.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").toLowerCase();
  const adminOnly = adminHost();

  // HTTPS is enforced by Railway (HTTP→HTTPS redirect), HSTS (next.config.ts)
  // and Cloudflare "Always Use HTTPS" — not here: Next.js sets
  // X-Forwarded-Proto itself when no proxy does, so a redirect here can loop.

  if (adminOnly) {
    // The admin host's root goes to the admin; admin paths live only on the admin host.
    if (pathname === "/") return host === adminOnly ? NextResponse.redirect(new URL("/admin", request.url)) : NextResponse.next();
    if (host !== adminOnly) return NextResponse.redirect(`${process.env.ADMIN_URL!.replace(/\/$/, "")}${pathname}${search}`, 308);
  } else if (pathname === "/") {
    return NextResponse.next();
  }

  const isPublic = PUBLIC_ADMIN_PATHS.includes(pathname);
  if (!isPublic && !getSessionCookie(request, { cookiePrefix: "wm_admin" })) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = pathname === "/admin" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/admin/:path*"],
};
