import { SiteChrome } from "@/components/site/SiteChrome";

// Public pages read live CMS data, so they render per request (fast, and
// every admin change is visible immediately without redeploying).
export const dynamic = "force-dynamic";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteChrome>{children}</SiteChrome>;
}
