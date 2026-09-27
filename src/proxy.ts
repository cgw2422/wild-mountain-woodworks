import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "wm_admin_session";

/**
 * Optimistic admin guard: redirects to the login page when no session cookie
 * is present. The session itself is fully validated server-side in the admin
 * layout, every admin server action and every admin API route
 * (`requireAdmin()`), so this is a UX convenience, not the security boundary.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLogin = pathname === "/admin/login";
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (!isLogin && !hasSession) {
    if (pathname.startsWith("/api/admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = pathname === "/admin" ? "" : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
