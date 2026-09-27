import bcrypt from "bcryptjs";

const COST = 12;

export const PASSWORD_MIN_LENGTH = 12;

export function validatePasswordStrength(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > 200) return "Password is too long.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9\W_]/.test(password)) {
    return "Include letters and at least one number or symbol.";
  }
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Pre-computed hash used to keep response timing similar when the email
// doesn't exist (mitigates user enumeration via timing).
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string) {
  dummyHash ??= bcrypt.hash("wild-mountain-timing-guard", COST);
  await bcrypt.compare(password, await dummyHash).catch(() => false);
}
