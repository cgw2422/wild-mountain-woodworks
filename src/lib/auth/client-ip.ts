/**
 * The client's IP address, for rate limiting and audit logs.
 *
 * Clients can send their own X-Forwarded-For header, so its FIRST entry is
 * attacker-controlled and must never be trusted. Order of preference:
 *
 *  1. CF-Connecting-IP — only when TRUST_CLOUDFLARE=true (the site is behind
 *     Cloudflare and the Railway origin only accepts Cloudflare traffic;
 *     otherwise anyone could set this header).
 *  2. X-Real-IP — set by Railway's edge proxy to the connecting address.
 *  3. The LAST X-Forwarded-For entry — appended by the nearest proxy.
 */
export function trustedIpHeaders(): string[] {
  return process.env.TRUST_CLOUDFLARE === "true" ? ["cf-connecting-ip", "x-real-ip"] : ["x-real-ip"];
}

export function clientIpFromHeaders(h: Headers): string {
  for (const name of trustedIpHeaders()) {
    const v = h.get(name)?.trim();
    if (v) return v.slice(0, 64);
  }
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1]!.slice(0, 64);
  }
  return "unknown";
}
