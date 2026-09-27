/** Absolute site origin, used for canonical URLs, sitemaps and emails. */
export function getSiteOrigin(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "http://localhost:3000");
  return raw.replace(/\/$/, "");
}

export function siteUrl(path = "/"): string {
  return `${getSiteOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}
