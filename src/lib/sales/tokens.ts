import { randomBytes } from "node:crypto";

/**
 * Customer link tokens for /quote/[token], /invoice/[token] and
 * /order/[token]: 256 random bits, base64url (43 chars). They are the only
 * thing in the URL — never a database id or sequential number.
 */
export function newCustomerToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Cheap shape check before touching the database. */
export function isTokenShape(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
