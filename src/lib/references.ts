import { randomInt } from "node:crypto";

// No 0/O/1/I/L to keep references easy to read over the phone.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomChars(n: number) {
  let out = "";
  for (let i = 0; i < n; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** e.g. WM-Q-260927-7KD4 */
export function generateReference(prefix: "Q" | "C" | "O", date = new Date()): string {
  const y = String(date.getUTCFullYear()).slice(2);
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `WM-${prefix}-${y}${m}${d}-${randomChars(4)}`;
}
