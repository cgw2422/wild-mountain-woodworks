import { isPathPublic } from "@/lib/cms/pages";

/**
 * Renders `children` only while the CMS page at `path` is published, so
 * built-in links (e.g. "All FAQs", "Contact Us") never lead visitors to a
 * page that has been moved to Draft or Archived. Server component.
 */
export async function IfPublic({ path, children, fallback = null }: { path: string; children: React.ReactNode; fallback?: React.ReactNode }) {
  return (await isPathPublic(path)) ? <>{children}</> : <>{fallback}</>;
}
