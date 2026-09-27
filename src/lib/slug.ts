/** Convert a title into a URL-safe slug. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string) {
  return SLUG_PATTERN.test(slug) && slug.length <= 80;
}

/**
 * Returns `base`, or `base-2`, `base-3`… — the first candidate for which
 * `isTaken` resolves false.
 */
export async function uniqueSlug(base: string, isTaken: (slug: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base) || "item";
  if (!(await isTaken(root))) return root;
  for (let i = 2; i < 500; i++) {
    const candidate = `${root}-${i}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}
