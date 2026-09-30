import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SiteChrome } from "@/components/site/SiteChrome";

// Public pages read live CMS data, so they render per request (fast, and
// every admin change is visible immediately without redeploying).
export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // With a separate admin host (ADMIN_URL), the public site isn't served there.
  if (process.env.ADMIN_URL) {
    const h = await headers();
    const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").toLowerCase();
    try {
      if (host === new URL(process.env.ADMIN_URL).host.toLowerCase()) redirect("/admin");
    } catch (err) {
      if ((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw err;
    }
  }
  return <SiteChrome>{children}</SiteChrome>;
}
