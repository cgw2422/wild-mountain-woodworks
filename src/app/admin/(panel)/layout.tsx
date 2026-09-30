import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { AdminNav } from "@/components/admin/AdminNav";
import { logoutAction } from "../login/actions";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin · Wild Mountain" },
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Any staff role may see the shell; every page and action checks its own
  // permission (layouts don't re-run on client-side navigation).
  const admin = await requireStaff();
  const [quotes, customRequests, messages] = can(admin.role, "inbox")
    ? await Promise.all([
        prisma.quoteRequest.count({ where: { status: "NEW" } }),
        prisma.customRequest.count({ where: { status: "NEW" } }),
        prisma.contactMessage.count({ where: { status: "UNREAD" } }),
      ])
    : [0, 0, 0];
  return (
    <div className="min-h-dvh bg-neutral-50 font-sans text-neutral-900">
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <AdminNav counts={{ quotes, customRequests, messages }} userName={admin.name} role={admin.role} logout={logoutAction} />
      <main id="admin-main" className="lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
